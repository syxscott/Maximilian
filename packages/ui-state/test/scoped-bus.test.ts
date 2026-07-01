import { describe, expect, it } from "vitest"
import { createScopedBus, type Scope } from "../src/sync"

describe("ScopedBus", () => {
  it("routes events to subscribers of the matching scope+key", () => {
    const bus = createScopedBus()
    const received: number[] = []
    const off = bus.subscribe<number>("workspace", "ws-1", (e) => received.push(e.payload))
    bus.emit("workspace", "ws-1", 1)
    bus.emit("workspace", "ws-1", 2)
    expect(received).toEqual([1, 2])
    off()
    bus.emit("workspace", "ws-1", 3)
    expect(received).toEqual([1, 2])
  })

  it("does not leak events across scope keys", () => {
    const bus = createScopedBus()
    const a: number[] = []
    const b: number[] = []
    bus.subscribe<number>("workspace", "ws-a", (e) => a.push(e.payload))
    bus.subscribe<number>("workspace", "ws-b", (e) => b.push(e.payload))
    bus.emit("workspace", "ws-a", 10)
    bus.emit("workspace", "ws-b", 20)
    expect(a).toEqual([10])
    expect(b).toEqual([20])
  })

  it("replays the last N events to a fresh subscriber", () => {
    const bus = createScopedBus()
    for (let i = 1; i <= 5; i++) bus.emit("session", "sess-1", i)
    const received: number[] = []
    bus.subscribe<number>("session", "sess-1", (e) => received.push(e.payload), { replay: 3 })
    expect(received).toEqual([3, 4, 5])
  })

  it("caps the replay buffer at the limit", () => {
    const bus = createScopedBus()
    for (let i = 1; i <= 100; i++) bus.emit("global", "g", i)
    const recent = bus.recent<number>("global", "g")
    expect(recent.length).toBe(64)
    expect(recent[0]!.payload).toBe(37)
    expect(recent.at(-1)!.payload).toBe(100)
  })

  it("clear() removes handlers and replay buffer for the given key", () => {
    const bus = createScopedBus()
    const calls: number[] = []
    bus.subscribe<number>("workspace", "ws-x", (e) => calls.push(e.payload))
    bus.emit("workspace", "ws-x", 1)
    expect(bus.recent<number>("workspace", "ws-x")).toHaveLength(1)
    bus.clear("workspace", "ws-x")
    // After clear, emit should not deliver to the (now unsubscribed) handler,
    // and the buffer for that key should be empty until a new event is emitted.
    bus.emit("workspace", "ws-x", 2)
    expect(calls).toEqual([1])
    expect(bus.recent<number>("workspace", "ws-x")).toEqual([
      expect.objectContaining({ payload: 2 }),
    ])
  })

  it("scope types are exhaustive", () => {
    const scopes: Scope[] = ["global", "session", "workspace"]
    expect(scopes).toHaveLength(3)
  })
})