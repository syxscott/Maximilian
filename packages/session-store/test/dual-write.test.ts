import { describe, expect, it } from "vitest"
import { SessionStore } from "../src/index.js"
import { SessionRecorder } from "../src/dual-write.js"

describe("SessionRecorder (dual-write adapter)", () => {
  it("maps runtime events into the events table with the recorder's workspace", () => {
    const store = new SessionStore({ path: ":memory:" })
    const recorder = new SessionRecorder(store, "ws-1")
    const id = recorder.recordRuntimeEvent({
      type: "task-start",
      payload: { taskId: "t-1" },
      at: "2026-01-01T00:00:00.000Z",
    })
    expect(typeof id).toBe("number")
    const events = store.listEvents("ws-1")
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("task-start")
    expect(events[0]?.payload).toEqual({ taskId: "t-1" })
    // A different recorder never leaks into another workspace.
    const other = new SessionRecorder(store, "ws-2")
    other.recordRuntimeEvent({ type: "task-end" })
    expect(store.listEvents("ws-1")).toHaveLength(1)
    expect(store.listEvents("ws-2")).toHaveLength(1)
    store.close()
  })

  it("records usage from a nested @max/llm-style usage object", () => {
    const store = new SessionStore({ path: ":memory:" })
    const recorder = new SessionRecorder(store, "ws-1")
    const id = recorder.recordUsageFromResult({
      provider: "anthropic",
      model: "claude-x",
      role: "assistant",
      usage: { inputTokens: 100, outputTokens: 25 },
    })
    expect(typeof id).toBe("number")
    store.close()
  })

  it("accepts flat token fields as a fallback", () => {
    const store = new SessionStore({ path: ":memory:" })
    const recorder = new SessionRecorder(store, "ws-1")
    expect(recorder.recordUsageFromResult({ inputTokens: 10, outputTokens: 5 })).not.toBeNull()
    store.close()
  })

  it("returns null when the result carries no usage at all", () => {
    const store = new SessionStore({ path: ":memory:" })
    const recorder = new SessionRecorder(store, "ws-1")
    expect(recorder.recordUsageFromResult({ provider: "anthropic" })).toBeNull()
    expect(recorder.recordUsageFromResult({ usage: {} })).toBeNull()
    store.close()
  })
})
