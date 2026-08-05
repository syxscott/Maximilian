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
   */
  async executeTask(task: Task, workspaceId: string): Promise<ExecuteResult> {
    const t0 = Date.now()
    // 1. 取得/创建 opencode session
    const entry = this.usePool
      ? await this.pool.getOrCreate(workspaceId, { title: this.sessionTitle(task) })
      : {
          session: await this.createSessionDirectly(workspaceId),
          touch: () => {},
        }
    const sessionId = entry.session.id

    // 2. 把 task 翻译成 opencode prompt
    const prompt = `${task.description}`
    // 3. 调 opencode SDK
    const res = await OpencodeSdk.sendPrompt(this.client, sessionId, {
      parts: [{ type: "text", text: prompt }],
    })

    // 4. 提取 assistant 文本作为 Maximilian result
    const outputText = (res.parts ?? [])
      .map((p: any) => (typeof p?.text === "string" ? p.text : p?.text?.text ?? ""))
      .filter(Boolean)
      .join("\n")
      .trim()

    const result: Result = {
      id: `r-${task.id}`,
      taskId: task.id,
      agentRole: task.agentRole,
      agentId: "opencode-serve",
      output: outputText || "(empty response from opencode)",
      metadata: { sessionId, executor: "opencode" },
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