// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * OpencodeExecutor — Maximilian Task → opencode serve 适配器 (Phase 2).
 *
 * 架构:
 *   Maximilian Task ─→ OpencodeExecutor ─→ OpencodeSdk.sendPrompt
 *                                          │
 *                                          ├→ SessionPool (per-workspace)
 *                                          └→ EventBridge (SSE → EventStore)
 *
 * 这是 Phase 2 的最小可行切片:把 Maximilian 的一条 task 走 opencode serve 跑,
 * 拿到响应作为 Result。它不替代 AgentRuntime(并发、stall detection、self-critique
 * 等都还在 AgentRuntime 里),而是在 execute path 上加一个 sidecar 选项。
 *
 * 迁移路径:
 *   Phase 2 (本): 新增 OpencodeExecutor,API 入口 `executeTask(task)`
 *   Phase 3:    AgentRuntime 接受 `executor: "opencode" | "in-process"` 配置
 *   Phase 4:    删掉 in-process LLM call path,只保留 opencode
 */

import { OpencodeHttpClient } from "@max/core-thin-sdk"
import { SessionPool } from "@max/core-thin-sdk"
import * as OpencodeSdk from "@max/core-thin-sdk"
import { opencodeSessionsCreatedTotal } from "@max/telemetry"
import type { Result, Task } from "./types.js"

export interface OpencodeExecutorOptions {
  /** opencode serve 的 base URL(如 "http://127.0.0.1:4096") */
  baseUrl: string
  /** 是否使用 SessionPool 缓存 session per workspace(默认 true) */
  poolSessions?: boolean
  /**
   * 把 task.description + agentRole 映射成 opencode session title 的函数。
   * 默认使用 task.id 的前 8 字符。
   */
  sessionTitle?: (task: Task) => string
}

export interface ExecuteResult {
  result: Result
  sessionId: string
  durationMs: number
}

/**
 * OpencodeExecutor:把 Maximilian Task 提交到 opencode serve 并取回结果。
 *
 * 用法:
 *   const ex = new OpencodeExecutor({ baseUrl: "http://localhost:4096" })
 *   const { result, sessionId } = await ex.executeTask(task, "ws-42")
 */
export class OpencodeExecutor {
  private readonly client: OpencodeHttpClient
  private readonly pool: SessionPool
  private readonly sessionTitle: (task: Task) => string
  private readonly usePool: boolean

  constructor(opts: OpencodeExecutorOptions) {
    this.client = new OpencodeHttpClient({ baseUrl: opts.baseUrl })
    this.usePool = opts.poolSessions ?? true
    this.pool = new SessionPool(this.client)
    this.sessionTitle =
      opts.sessionTitle ?? ((t) => `max-${t.id.slice(0, 8)}`)
  }

  /**
   * 提交 task 到 opencode 并等待响应。
   *
   * 当前实现是同步 sendPrompt(non-streaming);Phase 3 升级为 streaming + 实时事件。
   *
   * @param signal Optional AbortSignal — M2-fix: when the runtime (or
   *               the DAG executor) aborts a task, we propagate the
   *               abort into the opencode session via
   *               `OpencodeSdk.abortSession` so the in-flight LLM call
   *               is cancelled and the session isn't leaked server-side.
   *               Without this, an aborted task would still be running
   *               in opencode until natural completion, burning tokens.
   */
  async executeTask(
    task: Task,
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<ExecuteResult> {
    const t0 = Date.now()
    // 1. 取得/创建 opencode session
    const poolSizeBefore = this.usePool ? this.pool.size() : 0
    const entry = this.usePool
      ? await this.pool.getOrCreate(workspaceId, { title: this.sessionTitle(task) })
      : {
          session: await this.createSessionDirectly(workspaceId),
          touch: () => {},
        }
    const sessionId = entry.session.id
    // Phase 9: count session creation for the SLO-4 leak-rate indicator.
    // SessionPool reuses cached sessions, so we only increment when the
    // pool's size grew (a fresh session was created server-side) or
    // when the pool is disabled entirely. Matches the SLO target:
    //   opencode_sessions_leaked_total / opencode_sessions_created_total < 0.0001
    const wasCreatedThisCall = !this.usePool
      ? true
      : (this.pool.size() > poolSizeBefore)
    if (wasCreatedThisCall) {
      opencodeSessionsCreatedTotal.inc()
    }

    // M2-fix: when the runtime aborts, ask opencode to abort the
    // in-flight session so the LLM call doesn't keep burning tokens
    // server-side. The fire-and-forget pattern is intentional — we
    // don't want abort handling to delay the AbortError surface to
    // the caller.
    let abortHandler: (() => void) | undefined
    if (signal) {
      if (signal.aborted) {
        // Already aborted before we even started — short-circuit
        throw new DOMException("opencode execute aborted", "AbortError")
      }
      abortHandler = () => {
        void OpencodeSdk.abortSession(this.client, sessionId).catch(() => {
          // Swallow: the in-flight LLM call will return its error
          // anyway, and abortSession may fail if the session already
          // settled. Best-effort cleanup.
        })
      }
      signal.addEventListener("abort", abortHandler, { once: true })
    }

    // 2. 把 task 翻译成 opencode prompt
    const prompt = `${task.description}`
    // 3. 调 opencode SDK
    let res: any
    try {
      res = await OpencodeSdk.sendPrompt(this.client, sessionId, {
        parts: [{ type: "text", text: prompt }],
      })
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler)
      }
    }

    // 4. 提取 assistant 文本作为 Maximilian result
    const outputText = (res.parts ?? [])
      .map((p: any) => (typeof p?.text === "string" ? p.text : p?.text?.text ?? ""))
      .filter(Boolean)
      .join("\n")
      .trim()

    // M1-fix: when opencode returns no parts at all, the previous
    // behavior stuffed "(empty response from opencode)" into the
    // output text, which then looks like a real (if useless) answer
    // to downstream consumers (review tasks, commander replan, etc.).
    // A sentinel string in `output` is indistinguishable from a real
    // short response. Move the signal to `metadata.error` instead
    // so callers can detect it structurally without parsing the
    // output. The empty output is preserved verbatim (empty string)
    // so the result shape stays consistent.
    const result: Result = {
      id: `r-${task.id}`,
      taskId: task.id,
      agentRole: task.agentRole,
      agentId: "opencode-serve",
      output: outputText,
      metadata: {
        sessionId,
        executor: "opencode",
        ...(outputText.length === 0
          ? { error: "opencode returned no text parts" }
          : {}),
      },
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    }

    return {
      result,
      sessionId,
      durationMs: Date.now() - t0,
    }
  }

  private async createSessionDirectly(workspaceId: string) {
    return OpencodeSdk.createSession(this.client, {
      title: `max-${workspaceId}-${Date.now()}`,
    })
  }

  /** 关闭所有缓存的 opencode session(测试清理用) */
  async shutdown(): Promise<void> {
    await this.pool.shutdown()
  }

  /**
   * Phase 9 — SLO-4: report how many cached sessions were associated
   * with a given workspace. Called by `Runtime.abort(workspaceId)`
   * right before SIGTERM so the SLO dashboard has visibility into
   * sessions that the abrupt exit will leak server-side.
   *
   * Today we just count cached entries by workspaceId (the pool keys
   * them that way). In the future this should also `deleteSession`
   * best-effort with a short timeout; the metric is a stepping stone
   * toward that.
   */
  leakedSessionsOnAbort(workspaceId: string): number {
    if (!this.usePool) return 0
    // SessionPool keys cached entries by workspaceId. If the pool has
    // an entry for this workspace, it owns a session server-side
    // that won't be DELETEd by the abrupt abort. Return 1 if so;
    // 0 otherwise. Pool invariant: ≤1 cached session per workspace.
    return this.pool.has(workspaceId) ? 1 : 0
  }

  /** 探活:opencode serve 是否响应 */
  async ping(): Promise<boolean> {
    try {
      const r = await OpencodeSdk.health(this.client)
      return r.healthy === true
    } catch {
      return false
    }
  }
}