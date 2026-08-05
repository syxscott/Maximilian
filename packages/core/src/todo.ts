// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TodoStore (借鉴 opencode - session/todo.ts).
 *
 * 每个 wave / session 维护一组 TodoItem,支持增删改 + 按状态/优先级查询。
 * 原 opencode 的实现是 Drizzle-backed,我们用内存 Map 即可(每个 workspace
 * 一个实例,随 workspace 销毁)。
 */
import type { TodoItem } from "./types.js"

export class TodoStore {
  private items = new Map<string, TodoItem>()

  upsert(item: TodoItem): void {
    this.items.set(item.id, item)
  }

  remove(id: string): void {
    this.items.delete(id)
  }

  /** 按 position 升序返回所有 todo */
  list(): TodoItem[] {
    return [...this.items.values()].sort((a, b) => a.position - b.position)
  }

  /** 按 status 过滤 */
  byStatus(s: TodoItem["status"]): TodoItem[] {
    return this.list().filter((i) => i.status === s)
  }

  /** 改某条 todo 的状态(不改 content/priority) */
  setStatus(id: string, status: TodoItem["status"]): void {
    const it = this.items.get(id)
    if (it) it.status = status
  }

  /** 取下一个 pending todo;按 priority (high > medium > low) 再 position 排序 */
  nextPending(): TodoItem | undefined {
    return this.byStatus("pending").sort(
      (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.position - b.position,
    )[0]
  }

  /** 借鉴 opencode - 批量替换(用于 plan 重新生成时整批替换) */
  replaceAll(items: TodoItem[]): void {
    this.items.clear()
    for (const it of items) this.items.set(it.id, it)
  }

  size(): number {
    return this.items.size
  }
}

function priorityRank(p: TodoItem["priority"]): number {
  return p === "high" ? 0 : p === "medium" ? 1 : 2
}