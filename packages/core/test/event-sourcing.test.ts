import { describe, it, expect } from "vitest"
import { EventStore, workspaceStatusReducer } from "../src/event-sourcing.js"

describe("EventStore", () => {
  it("appends events with id, seq, and timestamp", () => {
    const store = new EventStore()
    const evt = store.append({ type: "test", aggregateId: "agg-1", data: { value: 42 } })
    // ID should be a valid UUID (using crypto.randomUUID)
    expect(evt.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(evt.seq).toBe(1)
    expect(evt.timestamp).toBeDefined()
    expect(evt.data).toEqual({ value: 42 })
  })

  it("increments seq per aggregate", () => {
    const store = new EventStore()
    store.append({ type: "a", aggregateId: "agg-1", data: null })
    store.append({ type: "b", aggregateId: "agg-1", data: null })
    const e3 = store.append({ type: "c", aggregateId: "agg-1", data: null })
    expect(e3.seq).toBe(3)
  })

  it("separate aggregates have independent seq", () => {
    const store = new EventStore()
    store.append({ type: "a", aggregateId: "agg-1", data: null })
    const e2 = store.append({ type: "b", aggregateId: "agg-2", data: null })
    expect(e2.seq).toBe(1)
  })

  it("getEvents returns all events for an aggregate", () => {
    const store = new EventStore()
    store.append({ type: "a", aggregateId: "agg-1", data: 1 })
    store.append({ type: "b", aggregateId: "agg-1", data: 2 })
    store.append({ type: "c", aggregateId: "agg-2", data: 3 })
    const events = store.getEvents("agg-1")
    expect(events).toHaveLength(2)
    expect(events[0].data).toBe(1)
    expect(events[1].data).toBe(2)
  })

  it("getEvents with fromSeq filters correctly", () => {
    const store = new EventStore()
    store.append({ type: "a", aggregateId: "agg-1", data: 1 })
    store.append({ type: "b", aggregateId: "agg-1", data: 2 })
    store.append({ type: "c", aggregateId: "agg-1", data: 3 })
    const events = store.getEvents("agg-1", 2)
    expect(events).toHaveLength(2)
    expect(events[0].data).toBe(2)
  })

  it("project applies reducer to derive state", () => {
    const store = new EventStore()
    store.append({ type: "workspace-created", aggregateId: "ws-1", data: {} })
    store.append({ type: "task-completed", aggregateId: "ws-1", data: {} })
    store.append({ type: "task-completed", aggregateId: "ws-1", data: {} })

    const state = store.project("ws-1", workspaceStatusReducer, {
      status: "pending",
      completedTasks: 0,
      failedTasks: 0,
    })
    expect(state.status).toBe("executing")
    expect(state.completedTasks).toBe(2)
  })

  it("prunes old events when max is exceeded", () => {
    const store = new EventStore({ maxEventsPerAggregate: 3 })
    for (let i = 0; i < 5; i++) {
      store.append({ type: "e", aggregateId: "agg-1", data: i })
    }
    const events = store.getEvents("agg-1")
    expect(events).toHaveLength(3)
    expect(events[0].data).toBe(2)
  })

  it("getAggregateIds returns all aggregates", () => {
    const store = new EventStore()
    store.append({ type: "a", aggregateId: "agg-1", data: null })
    store.append({ type: "b", aggregateId: "agg-2", data: null })
    expect(store.getAggregateIds()).toEqual(["agg-1", "agg-2"])
  })

  it("clear removes all events", () => {
    const store = new EventStore()
    store.append({ type: "a", aggregateId: "agg-1", data: null })
    store.clear()
    expect(store.size).toBe(0)
  })

  // ── Terminal-outcome retention (borrowing; OAC journal.go:13-19) ──

  it("keeps the terminal event readable after the log exceeds its limit", () => {
    const store = new EventStore({ maxEventsPerAggregate: 3 })
    // Heavy traffic: observations fill and prune the window.
    for (let i = 0; i < 10; i++) {
      store.append({ type: "tool:end", aggregateId: "ws-1", data: { i } })
    }
    // The terminal outcome arrives, then MORE observations push it out of
    // the pruned observation window.
    store.append({ type: "workspace-failed", aggregateId: "ws-1", data: { error: "boom" } })
    for (let i = 0; i < 5; i++) {
      store.append({ type: "tool:end", aggregateId: "ws-1", data: { post: i } })
    }

    const events = store.getEvents("ws-1")
    // Observations are pruned to the limit; the terminal event survives
    // in its reserved entry, at its chronological (seq) position.
    const terminal = events.find((e) => e.type === "workspace-failed")
    expect(terminal).toBeDefined()
    expect(terminal?.data).toEqual({ error: "boom" })
    // Sequence order is preserved for replay consumers.
    const seqs = events.map((e) => e.seq)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
    const state = store.project("ws-1", workspaceStatusReducer, {
      status: "executing",
      completedTasks: 0,
      failedTasks: 0,
    })
    expect(state.status).toBe("failed")
  })

  it("the reserved terminal entry holds the LATEST terminal outcome", () => {
    const store = new EventStore({ maxEventsPerAggregate: 2 })
    store.append({ type: "workspace-completed", aggregateId: "ws-2", data: { at: 1 } })
    store.append({ type: "workspace-failed", aggregateId: "ws-2", data: { at: 2 } })
    const events = store.getEvents("ws-2")
    const terminal = events.filter(
      (e) => e.type === "workspace-failed" || e.type === "workspace-completed",
    )
    // One reserved entry — the newest terminal event replaced the older one.
    expect(terminal).toHaveLength(1)
    expect(terminal[0].type).toBe("workspace-failed")
    expect(store.size).toBe(1)
  })

  it("terminal event types are configurable", () => {
    const store = new EventStore({ maxEventsPerAggregate: 1, terminalEventTypes: ["turn-done"] })
    store.append({ type: "workspace-failed", aggregateId: "ws-3", data: null }) // not terminal here
    store.append({ type: "workspace-failed", aggregateId: "ws-3", data: null }) // prunes the first
    store.append({ type: "turn-done", aggregateId: "ws-3", data: { ok: true } })
    store.append({ type: "workspace-failed", aggregateId: "ws-3", data: null }) // prunes the second observation

    // getEvents restores append order (seq): the observation appended
    // AFTER the terminal event sorts after it, and the terminal event
    // survives regardless of the observation window.
    const types = store.getEvents("ws-3").map((e) => e.type)
    expect(types).toEqual(["turn-done", "workspace-failed"])
  })
})
