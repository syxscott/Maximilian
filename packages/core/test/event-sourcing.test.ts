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
})
