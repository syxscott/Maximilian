// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Session Status FSM (借鉴 opencode - session/status.ts).
 *
 * opencode 设计: 有限状态机 (idle | retry | busy) 取代 string event。
 * retry 携带 attempt + next + 可选 action(给前端"重试中"提示用)。
 *
 * 为什么用 FSM 而不是 string event:
 * 1. 编译期就能保证 transition 合法
 * 2. 前端可以基于 type narrowing 渲染不同 UI(busy 隐藏 prompt,retry 显示倒计时)
 * 3. 测试时不需要 mock string event 总线
 */

/** 借鉴 opencode - idle / retry / busy 三态 */
export type SessionStatusState = "idle" | "retry" | "busy"

/** 借鉴 opencode - retry 子结构(用于前端展示"还剩 N 秒重试") */
export interface RetryAction {
  reason: string
  provider: string
  title: string
  message: string
  label: string
  link?: string
}

/** 借鉴 opencode - SessionStatus.Info union */
export type SessionStatus =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; action?: RetryAction; next: number }
  | { type: "busy" }

/** 借鉴 opencode - 状态转移合法性表 */
const ALLOWED: Record<SessionStatusState, ReadonlyArray<SessionStatusState>> = {
  idle: ["busy"],
  busy: ["retry", "idle"],
  retry: ["retry", "idle"],
}

/** 借鉴 opencode - 状态转移是否合法 */
export function canTransition(from: SessionStatusState, to: SessionStatusState): boolean {
  return ALLOWED[from].includes(to)
}

/** 借鉴 opencode - SessionStatusTracker,管理一个 session 的状态机 */
export class SessionStatusTracker {
  private state: SessionStatusState = "idle"

  /** 当前状态(只读) */
  get current(): SessionStatusState {
    return this.state
  }

  /**
   * 借鉴 opencode - 执行转移。
   * @param to 目标状态
   * @param info 仅 retry/busy 需要;idle 不需要 info
   * @returns 完整的 SessionStatus(供前端使用)
   * @throws 非法转移
   */
  transition(to: SessionStatusState, info?: Omit<SessionStatus, "type">): SessionStatus {
    if (!canTransition(this.state, to)) {
      throw new Error(
        `Invalid transition ${this.state} -> ${to} (借鉴 opencode FSM)`,
      )
    }
    this.state = to
    if (to === "idle") return { type: "idle" }
    return { type: to, ...(info ?? {}) } as SessionStatus
  }

  /** 重置到 idle(用于失败后重新尝试) */
  reset(): void {
    this.state = "idle"
  }

  /** 序列化当前状态(便于持久化到 EventStore) */
  snapshot(): SessionStatus {
    if (this.state === "idle") return { type: "idle" }
    // busy/retry 没有携带额外信息时返回最简形式
    return { type: this.state } as SessionStatus
  }
}