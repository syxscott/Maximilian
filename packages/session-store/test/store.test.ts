import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SessionStore, SCHEMA_VERSION } from "../src/index.js"

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-test-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("SessionStore.migrate", () => {
  it("creates tables and stamps schema_version", () => {
    const store = new SessionStore({ path: path.join(dir, "store.db") })
    expect(store.schemaVersion).toBe(0)
    store.migrate()
    expect(store.schemaVersion).toBe(SCHEMA_VERSION)
    store.close()
  })

  it("is idempotent when run twice", () => {
    const dbPath = path.join(dir, "store.db")
    const store = new SessionStore({ path: dbPath })
    store.migrate()
    store.appendSession({ id: "s1", workspaceId: "ws1", title: "one" })
    // Second migrate on the same handle must not throw or wipe data.
    store.migrate()
    expect(store.getSession("s1")?.title).toBe("one")
    store.close()

    // And again on a fresh handle (process restart path).
    const reopened = new SessionStore({ path: dbPath })
    reopened.migrate()
    expect(reopened.getSession("s1")?.title).toBe("one")
    expect(reopened.schemaVersion).toBe(SCHEMA_VERSION)
    reopened.close()
  })

  it("refuses to downgrade a newer schema version (forward-only)", () => {
    const store = new SessionStore({ path: path.join(dir, "store.db") })
    store.migrate()
    store.setMeta("schema_version", String(SCHEMA_VERSION + 1))
    expect(() => store.migrate()).toThrow(/forward-only/)
    store.close()
  })

  it("auto-migrates lazily on first use", () => {
    const store = new SessionStore({ path: ":memory:" })
    store.appendSession({ id: "s1", workspaceId: "ws1" })
    expect(store.schemaVersion).toBe(SCHEMA_VERSION)
    store.close()
  })
})

describe("SessionStore sessions and messages", () => {
  it("round-trips a session", () => {
    const store = new SessionStore({ path: ":memory:" })
    const row = store.appendSession({
      id: "sess-1",
      workspaceId: "ws-1",
      title: "Fix login",
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    expect(row.id).toBe("sess-1")
    expect(row.workspaceId).toBe("ws-1")
    expect(row.title).toBe("Fix login")
    expect(row.createdAt).toBe("2026-01-01T00:00:00.000Z")
    expect(store.getSession("sess-1")).toEqual(row)
    expect(store.getSession("missing")).toBeNull()
    store.close()
  })

  it("upserts sessions without duplicating or clobbering created_at", () => {
    const store = new SessionStore({ path: ":memory:" })
    store.appendSession({
      id: "s",
      workspaceId: "ws",
      title: "a",
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    store.appendSession({
      id: "s",
      workspaceId: "ws",
      title: "b",
      createdAt: "2026-02-02T00:00:00.000Z",
    })
    const row = store.getSession("s")
    expect(row?.title).toBe("b")
    expect(row?.createdAt).toBe("2026-01-01T00:00:00.000Z")
    expect(store.listSessions()).toHaveLength(1)
    store.close()
  })

  it("lists sessions newest first, optionally filtered by workspace", () => {
    const store = new SessionStore({ path: ":memory:" })
    store.appendSession({ id: "s1", workspaceId: "ws1", createdAt: "2026-01-01T00:00:00.000Z" })
    store.appendSession({ id: "s2", workspaceId: "ws2", createdAt: "2026-01-02T00:00:00.000Z" })
    store.appendSession({ id: "s3", workspaceId: "ws1", createdAt: "2026-01-03T00:00:00.000Z" })
    expect(store.listSessions().map((s) => s.id)).toEqual(["s3", "s2", "s1"])
    expect(store.listSessions("ws1").map((s) => s.id)).toEqual(["s3", "s1"])
    store.close()
  })

  it("round-trips messages in order and is idempotent per message id", () => {
    const store = new SessionStore({ path: ":memory:" })
    store.appendSession({ id: "s", workspaceId: "ws" })
    store.appendMessage({
      id: "m1",
      sessionId: "s",
      role: "user",
      content: "hi",
      createdAt: "2026-01-01T00:00:01.000Z",
    })
    store.appendMessage({
      id: "m2",
      sessionId: "s",
      role: "assistant",
      content: "hello",
      createdAt: "2026-01-01T00:00:02.000Z",
    })
    // Same id again: update in place, no duplicate row.
    store.appendMessage({
      id: "m2",
      sessionId: "s",
      role: "assistant",
      content: "hello!",
      createdAt: "2026-01-01T00:00:02.000Z",
    })
    const messages = store.listMessages("s")
    expect(messages).toHaveLength(2)
    expect(messages.map((m) => m.content)).toEqual(["hi", "hello!"])
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"])
    store.close()
  })
})

describe("SessionStore events and usage", () => {
  it("round-trips events with JSON payloads", () => {
    const store = new SessionStore({ path: ":memory:" })
    const id = store.appendEvent({
      workspaceId: "ws1",
      type: "task-start",
      payload: { taskId: "t-42", nested: { ok: true } },
      at: "2026-01-01T00:00:00.000Z",
    })
    expect(typeof id).toBe("number")
    const events = store.listEvents("ws1")
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("task-start")
    expect(events[0]?.payload).toEqual({ taskId: "t-42", nested: { ok: true } })
    expect(events[0]?.at).toBe("2026-01-01T00:00:00.000Z")
    store.close()
  })

  it("stores undefined payload as null and filters by type", () => {
    const store = new SessionStore({ path: ":memory:" })
    store.appendEvent({ workspaceId: "ws1", type: "a" })
    store.appendEvent({ workspaceId: "ws1", type: "b", payload: 7 })
    expect(store.listEvents("ws1", { type: "b" })).toHaveLength(1)
    expect(store.listEvents("ws1", { type: "a" })[0]?.payload).toBeNull()
    store.close()
  })

  it("records usage rows", () => {
    const store = new SessionStore({ path: ":memory:" })
    const id = store.recordUsage({
      workspaceId: "ws1",
      role: "assistant",
      provider: "anthropic",
      model: "claude-x",
      tokensIn: 100,
      tokensOut: 42,
      at: "2026-01-01T00:00:00.000Z",
    })
    expect(typeof id).toBe("number")
    store.close()
  })

  it("persists data across close/reopen on a file-backed store", () => {
    const dbPath = path.join(dir, "persist.db")
    const first = new SessionStore({ path: dbPath })
    first.appendSession({ id: "s", workspaceId: "ws", title: "durable" })
    first.appendEvent({ workspaceId: "ws", type: "e", payload: { n: 1 } })
    first.close()

    const second = new SessionStore({ path: dbPath })
    expect(second.getSession("s")?.title).toBe("durable")
    expect(second.listEvents("ws")).toHaveLength(1)
    second.close()
  })
})

describe("SessionStore steering queue", () => {
  it("enqueue is idempotent by receipt id", () => {
    const store = new SessionStore({ path: ":memory:" })
    expect(
      store.enqueueSteering({
        workspaceId: "ws",
        text: "slow down",
        source: "user",
        receiptId: "r1",
      }),
    ).toBe(true)
    expect(
      store.enqueueSteering({
        workspaceId: "ws",
        text: "slow down",
        source: "user",
        receiptId: "r1",
      }),
    ).toBe(false)
    expect(store.enqueueSteering({ workspaceId: "ws", text: "other", receiptId: "r2" })).toBe(true)
    store.close()
  })

  it("consumeSteering is consume-once", () => {
    const store = new SessionStore({ path: ":memory:" })
    store.enqueueSteering({ receiptId: "r1", text: "x" })
    expect(store.consumeSteering("r1")).toBe(true)
    expect(store.consumeSteering("r1")).toBe(false)
    expect(store.consumeSteering("never-enqueued")).toBe(false)
    store.close()
  })
})

describe("SessionStore lesson efficacy", () => {
  it("upserts accumulate per (role, bucket)", () => {
    const store = new SessionStore({ path: ":memory:" })
    store.upsertLessonEfficacy("planner", "sql", 1, 0.5)
    store.upsertLessonEfficacy("planner", "sql", 2, -0.25)
    store.upsertLessonEfficacy("executor", "sql", 1, 1)
    const planner = store.getLessonEfficacy("planner")
    expect(planner).toEqual([{ role: "planner", bucket: "sql", injectedCount: 3, deltaSum: 0.25 }])
    expect(store.getLessonEfficacy("executor")).toEqual([
      { role: "executor", bucket: "sql", injectedCount: 1, deltaSum: 1 },
    ])
    expect(store.getLessonEfficacy("nobody")).toEqual([])
    store.close()
  })
})

describe("SessionStore audit", () => {
  it("appends audit rows with JSON payloads", () => {
    const store = new SessionStore({ path: ":memory:" })
    const id = store.appendAudit("migrate-legacy", { workspaces: 2 })
    expect(typeof id).toBe("number")
    store.close()
  })
})
