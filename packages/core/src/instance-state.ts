// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * InstanceState (借鉴 opencode - effect/instance-state.ts).
 *
 * per-project 实例隔离 + 自动 finalizer 清理。
 * Maximilian 不用 Effect-TS,改用轻量 Map + 显式 close() 实现等效行为。
 *
 * 用法:
 *   const ist = new InstanceState<{ runners: Map<string, AbortController> }>()
 *   const { state, scope } = ist.getOrInit("project-A", () => ({
 *     runners: new Map(),
 *   }))
 *   scope.addFinalizer(() => {
 *     for (const ctrl of state.runners.values()) ctrl.abort()
 *   })
 *   // ... use state ...
 *   await ist.close("project-A")  // runs all finalizers (LIFO) then deletes
 */

export interface Scope {
  /** 注册清理回调;在 close() 时按 LIFO 顺序执行 */
  addFinalizer(fn: () => void | Promise<void>): void
  /** 是否已关闭 */
  isClosed(): boolean
}

interface Entry<T> {
  state: T
  finalizers: Array<() => void | Promise<void>>
  closed: boolean
}

export class InstanceState<T> {
  private readonly map = new Map<string, Entry<T>>()

  /**
   * 借鉴 opencode - getOrInit(key, init)
   * 取 key 对应的 state;若不存在或已 closed,调用 init 创建新实例。
   */
  getOrInit(key: string, init: () => T): { state: T; scope: Scope } {
    const existing = this.map.get(key)
    if (existing && !existing.closed) {
      return { state: existing.state, scope: this.scopeOf(existing) }
    }
    const finalizers: Array<() => void | Promise<void>> = []
    const state = init()
    const entry: Entry<T> = { state, finalizers, closed: false }
    this.map.set(key, entry)
    return { state, scope: this.scopeOf(entry) }
  }

  /**
   * 借鉴 opencode - close(key)
   * 按 LIFO 顺序执行所有 finalizer,然后删除 entry。finalizer 异常被吞掉。
   */
  async close(key: string): Promise<void> {
    const e = this.map.get(key)
    if (!e || e.closed) return
    e.closed = true
    // LIFO order — 最后注册的先执行
    for (const fn of e.finalizers.slice().reverse()) {
      try {
        await fn()
      } catch {
        // 借鉴 opencode - finalizer 失败静默
      }
    }
    this.map.delete(key)
  }

  /** 该 key 是否存在且未关闭 */
  has(key: string): boolean {
    const e = this.map.get(key)
    return !!e && !e.closed
  }

  /** 当前活跃 key 列表(排除 closed) */
  keys(): string[] {
    return [...this.map.entries()]
      .filter(([, e]) => !e.closed)
      .map(([k]) => k)
  }

  size(): number {
    return this.keys().length
  }

  private scopeOf(entry: Entry<T>): Scope {
    return {
      addFinalizer: (fn) => entry.finalizers.push(fn),
      isClosed: () => entry.closed,
    }
  }
}