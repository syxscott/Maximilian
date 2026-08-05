import { describe, it, expect } from "vitest"
import { TodoStore } from "../src/todo.js"

describe("TodoStore (借鉴 opencode - SessionTodo)", () => {
  it("upsert + list ordered by position", () => {
    const s = new TodoStore()
    s.upsert({ id: "1", content: "a", status: "pending", priority: "low", position: 2 })
    s.upsert({ id: "2", content: "b", status: "pending", priority: "high", position: 1 })
    expect(s.list().map((i) => i.id)).toEqual(["2", "1"])
  })

  it("nextPending picks highest priority pending", () => {
    const s = new TodoStore()
    s.upsert({ id: "1", content: "low", status: "pending", priority: "low", position: 0 })
    s.upsert({ id: "2", content: "high", status: "pending", priority: "high", position: 1 })
    expect(s.nextPending()?.id).toBe("2")
  })

  it("nextPending skips completed/cancelled items", () => {
    const s = new TodoStore()
    s.upsert({ id: "1", content: "high but done", status: "completed", priority: "high", position: 0 })
    s.upsert({ id: "2", content: "low todo", status: "pending", priority: "low", position: 1 })
    expect(s.nextPending()?.id).toBe("2")
  })

  it("setStatus updates in place", () => {
    const s = new TodoStore()
    s.upsert({ id: "1", content: "x", status: "pending", priority: "high", position: 0 })
    s.setStatus("1", "completed")
    expect(s.byStatus("completed")).toHaveLength(1)
    expect(s.byStatus("pending")).toHaveLength(0)
  })

  it("remove clears item", () => {
    const s = new TodoStore()
    s.upsert({ id: "1", content: "x", status: "pending", priority: "high", position: 0 })
    s.remove("1")
    expect(s.list()).toHaveLength(0)
  })

  it("byStatus returns all matching items", () => {
    const s = new TodoStore()
    s.upsert({ id: "1", content: "a", status: "pending", priority: "high", position: 0 })
    s.upsert({ id: "2", content: "b", status: "pending", priority: "low", position: 1 })
    s.upsert({ id: "3", content: "c", status: "in_progress", priority: "high", position: 2 })
    expect(s.byStatus("pending")).toHaveLength(2)
    expect(s.byStatus("in_progress")).toHaveLength(1)
  })

  it("replaceAll atomically swaps contents", () => {
    const s = new TodoStore()
    s.upsert({ id: "old", content: "x", status: "pending", priority: "high", position: 0 })
    s.replaceAll([
      { id: "n1", content: "a", status: "pending", priority: "high", position: 0 },
      { id: "n2", content: "b", status: "pending", priority: "medium", position: 1 },
    ])
    expect(s.list().map((i) => i.id)).toEqual(["n1", "n2"])
    expect(s.size()).toBe(2)
  })

  it("nextPending returns undefined when no pending", () => {
    const s = new TodoStore()
    s.upsert({ id: "1", content: "x", status: "completed", priority: "high", position: 0 })
    expect(s.nextPending()).toBeUndefined()
  })
})