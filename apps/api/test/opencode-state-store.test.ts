/**
 * Tests for `OpencodeStateStore` — the in-memory projection that the
 * /api/opencode/* routes read from.
 *
 * These tests are pure (no Hono, no HTTP) — they drive the store with
 * synthetic `StoredEvent` rows so we can assert on the read model without
 * a live EventBridge.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { EventStore, type StoredEvent } from "@max/core"
import {
  OpencodeStateStore,
  __setOpencodeStateStoreForTests,
  getOpencodeStateStore,
  type OpencodeSessionState,
} from "../src/opencode-state-store.js"

function ev(overrides: Partial<StoredEvent> & { id?: string; type: string }): StoredEvent {
  return {
    id: overrides.id ?? `evt-${Math.random().toString(36).slice(2, 8)}`,
    type: overrides.type,
    aggregateId: overrides.aggregateId ?? "ws-1",
    data: overrides.data ?? { sessionID: "ws-1" },
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    seq: overrides.seq ?? 1,
  }
}

describe("OpencodeStateStore", () => {
  let store: OpencodeStateStore

  beforeEach(() => {
    store = new OpencodeStateStore({ sweepIntervalMs: 0 })
    __setOpencodeStateStoreForTests(store)
  })

  it("starts empty", () => {
    expect(store.size()).toBe(0)
    expect(store.listSessions()).toEqual([])
  })

  it("creates a new session on first event", () => {
    const event = ev({ type: "message:part", data: { sessionID: "ws-1" } })
    const result = store.applyEvent(event)
    expect(result).toBeDefined()
    expect(result?.sessionId).toBe("ws-1")
    expect(result?.status).toBe("unknown")
    expect(result?.messageCount).toBe(1)
    expect(result?.lastEventType).toBe("message:part")
  })

  it("counts message:* and tool:* events independently", () => {
    store.applyEvent(ev({ type: "message:part", data: { sessionID: "ws-1" }, seq: 1 }))
    store.applyEvent(ev({ type: "message:delta", data: { sessionID: "ws-1" }, seq: 2 }))
    store.applyEvent(ev({ type: "tool:called", data: { sessionID: "ws-1" }, seq: 3 }))
    store.applyEvent(ev({ type: "tool:success", data: { sessionID: "ws-1" }, seq: 4 }))
    const s = store.getSession("ws-1")
    expect(s?.messageCount).toBe(2)
    expect(s?.toolCallCount).toBe(2)
  })

  it("derives status from session:* and compaction:* events", () => {
    store.applyEvent(ev({ type: "message:part", data: { sessionID: "ws-1" } }))
    expect(store.getSession("ws-1")?.status).toBe("unknown")

    store.applyEvent(ev({ type: "session:status", data: { sessionID: "ws-1", statusType: "busy" } }))
    expect(store.getSession("ws-1")?.status).toBe("busy")

    store.applyEvent(ev({ type: "session:idle", data: { sessionID: "ws-1" } }))
    expect(store.getSession("ws-1")?.status).toBe("idle")

    store.applyEvent(ev({ type: "compaction:start", data: { sessionID: "ws-1" } }))
    expect(store.getSession("ws-1")?.status).toBe("compacting")

    store.applyEvent(ev({ type: "compaction:done", data: { sessionID: "ws-1" } }))
    expect(store.getSession("ws-1")?.status).toBe("idle")
  })

  it("captures session:error message and status", () => {
    store.applyEvent(
      ev({ type: "session:error", data: { sessionID: "ws-1", error: { message: "boom" } } }),
    )
    const s = store.getSession("ws-1")
    expect(s?.status).toBe("error")
    expect(s?.lastError).toBe("boom")
  })

  it("trims `recent` to the configured cap (default 25)", () => {
    const tight = new OpencodeStateStore({ sweepIntervalMs: 0, maxRecent: 3 })
    for (let i = 0; i < 5; i++) {
      tight.applyEvent(ev({ type: "message:part", data: { sessionID: "ws-1" }, seq: i + 1 }))
    }
    expect(tight.getSession("ws-1")?.recent.length).toBe(3)
    // Newest stays at the tail.
    const seqs = tight.getSession("ws-1")?.recent.map((e) => e.seq) ?? []
    expect(seqs).toEqual([3, 4, 5])
  })

  it("buckets events without a sessionID under the aggregateId", () => {
    store.applyEvent(ev({ type: "workspace:ready", data: { name: "ws-1" }, aggregateId: "ws-1" }))
    const s = store.getSession("ws-1")
    expect(s).toBeDefined()
    expect(s?.sessionId).toBe("ws-1")
  })

  it("ignores events without a sessionable key (e.g. pty.*)", () => {
    const result = store.applyEvent(
      ev({ type: "pty:created", data: {}, aggregateId: "global" }),
    )
    expect(result).toBeUndefined()
    expect(store.size()).toBe(0)
  })

  it("snapshots are sorted by lastEventAt descending", () => {
    const older = "2026-06-01T00:00:00.000Z"
    const newer = "2026-06-02T00:00:00.000Z"
    store.applyEvent(
      ev({ type: "message:part", data: { sessionID: "old" }, timestamp: older }),
    )
    store.applyEvent(
      ev({ type: "message:part", data: { sessionID: "new" }, timestamp: newer }),
    )
    const list = store.listSessions()
    expect(list[0]?.sessionId).toBe("new")
    expect(list[1]?.sessionId).toBe("old")
  })

  it("emits 'change' on every update with the full snapshot", () => {
    const spy = vi.fn()
    store.on("change", spy)
    store.applyEvent(ev({ type: "message:part", data: { sessionID: "ws-1" } }))
    store.applyEvent(ev({ type: "message:part", data: { sessionID: "ws-2" } }))
    expect(spy).toHaveBeenCalledTimes(2)
    const lastArg = spy.mock.calls.at(-1)?.[0]
    expect(lastArg?.sessions).toHaveLength(2)
  })

  it("rebuilds from a persistent EventStore on boot", () => {
    const eventStore = new EventStore()
    eventStore.append({ type: "message:part", aggregateId: "ws-1", data: { sessionID: "ws-1" } })
    eventStore.append({ type: "tool:called", aggregateId: "ws-1", data: { sessionID: "ws-1" } })
    eventStore.append({ type: "session:idle", aggregateId: "ws-1", data: { sessionID: "ws-1" } })

    const fresh = new OpencodeStateStore({ sweepIntervalMs: 0 })
    const snap = fresh.rebuildFrom(eventStore)
    expect(snap.sessions).toHaveLength(1)
    expect(snap.sessions[0]?.sessionId).toBe("ws-1")
    expect(snap.sessions[0]?.messageCount).toBe(1)
    expect(snap.sessions[0]?.toolCallCount).toBe(1)
    expect(snap.sessions[0]?.status).toBe("idle")
  })

  it("prunes sessions that have been idle past the TTL", () => {
    const tight = new OpencodeStateStore({ sweepIntervalMs: 0, idleTtlMs: 1000 })
    tight.applyEvent(
      ev({
        type: "message:part",
        data: { sessionID: "stale" },
        timestamp: new Date(Date.now() - 5000).toISOString(),
      }),
    )
    tight.applyEvent(ev({ type: "message:part", data: { sessionID: "fresh" } }))
    const removed = tight.pruneIdle()
    expect(removed).toBe(1)
    expect(tight.getSession("stale")).toBeUndefined()
    expect(tight.getSession("fresh")).toBeDefined()
  })

  it("keeps busy sessions even past the TTL", () => {
    const tight = new OpencodeStateStore({ sweepIntervalMs: 0, idleTtlMs: 1000 })
    tight.applyEvent(
      ev({
        type: "session:status",
        data: { sessionID: "stale", statusType: "busy" },
        timestamp: new Date(Date.now() - 5000).toISOString(),
      }),
    )
    const removed = tight.pruneIdle()
    expect(removed).toBe(0)
    expect(tight.getSession("stale")).toBeDefined()
  })

  it("singleton accessor returns the same instance", () => {
    const a = getOpencodeStateStore()
    const b = getOpencodeStateStore()
    expect(a).toBe(b)
  })

  it("snapshot helper returns generatedAt and a copy", () => {
    store.applyEvent(ev({ type: "message:part", data: { sessionID: "ws-1" } }))
    const snap = store.snapshot()
    expect(snap.generatedAt).toMatch(/T/)
    expect(snap.sessions).toHaveLength(1)
    // mutate the returned array — internal state must not change
    ;(snap.sessions as OpencodeSessionState[]).length = 0
    expect(store.size()).toBe(1)
  })
})
