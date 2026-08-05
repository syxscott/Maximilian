import { describe, it, expect } from "vitest"
import { InstanceState } from "../src/instance-state.js"

describe("InstanceState (借鉴 opencode)", () => {
  it("getOrInit returns same state on second call", () => {
    const s = new InstanceState<{ n: number }>()
    const a = s.getOrInit("p1", () => ({ n: 1 }))
    const b = s.getOrInit("p1", () => ({ n: 999 }))
    expect(a.state.n).toBe(1)
    expect(b.state.n).toBe(1)
  })

  it("scope.addFinalizer runs on close()", async () => {
    const s = new InstanceState<{}>()
    const { scope } = s.getOrInit("p1", () => ({}))
    let ran = false
    scope.addFinalizer(() => {
      ran = true
    })
    await s.close("p1")
    expect(ran).toBe(true)
  })

  it("finalizers run in LIFO order (借鉴 opencode)", async () => {
    const s = new InstanceState<{}>()
    const { scope } = s.getOrInit("p1", () => ({}))
    const order: number[] = []
    scope.addFinalizer(() => {
      order.push(1)
    })
    scope.addFinalizer(() => {
      order.push(2)
    })
    scope.addFinalizer(() => {
      order.push(3)
    })
    await s.close("p1")
    expect(order).toEqual([3, 2, 1])
  })

  it("close() on missing key is noop", async () => {
    const s = new InstanceState<{}>()
    await expect(s.close("nope")).resolves.toBeUndefined()
  })

  it("close() on already-closed key is noop (no double-run)", async () => {
    const s = new InstanceState<{}>()
    const { scope } = s.getOrInit("p1", () => ({}))
    let count = 0
    scope.addFinalizer(() => {
      count++
    })
    await s.close("p1")
    await s.close("p1")
    expect(count).toBe(1)
  })

  it("after close, getOrInit re-initializes (借鉴 opencode)", () => {
    const s = new InstanceState<{ n: number }>()
    const a = s.getOrInit("p1", () => ({ n: 1 }))
    void s.close("p1")
    const b = s.getOrInit("p1", () => ({ n: 2 }))
    expect(a.state.n).toBe(1)
    expect(b.state.n).toBe(2)
  })

  it("scope.isClosed reflects state", async () => {
    const s = new InstanceState<{}>()
    const { scope } = s.getOrInit("p1", () => ({}))
    expect(scope.isClosed()).toBe(false)
    await s.close("p1")
    // close 已删除 entry,但用户保留的 scope 仍能查 closed=true
    expect(scope.isClosed()).toBe(true)
  })

  it("has() returns false after close", async () => {
    const s = new InstanceState<{}>()
    s.getOrInit("p1", () => ({}))
    expect(s.has("p1")).toBe(true)
    await s.close("p1")
    expect(s.has("p1")).toBe(false)
  })

  it("keys() excludes closed entries", async () => {
    const s = new InstanceState<{}>()
    s.getOrInit("a", () => ({}))
    s.getOrInit("b", () => ({}))
    await s.close("a")
    expect(s.keys().sort()).toEqual(["b"])
  })

  it("finalizer throwing does not block subsequent finalizers", async () => {
    const s = new InstanceState<{}>()
    const { scope } = s.getOrInit("p1", () => ({}))
    let ran = false
    scope.addFinalizer(() => {
      throw new Error("first fails")
    })
    scope.addFinalizer(() => {
      ran = true
    })
    await s.close("p1")
    expect(ran).toBe(true)
  })

  it("async finalizer is awaited before next runs", async () => {
    const s = new InstanceState<{}>()
    const { scope } = s.getOrInit("p1", () => ({}))
    const order: string[] = []
    scope.addFinalizer(async () => {
      await new Promise((r) => setTimeout(r, 5))
      order.push("first")
    })
    scope.addFinalizer(() => {
      order.push("second")
    })
    await s.close("p1")
    // LIFO: second first, then first (async)
    expect(order).toEqual(["second", "first"])
  })
})