import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SessionStore } from "../src/index.js"
import { migrateLegacyEventLogs } from "../src/migrate-legacy.js"

let dir: string
let eventsDir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-legacy-test-"))
  eventsDir = path.join(dir, "events")
  fs.mkdirSync(eventsDir)
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function writeWorkspaceLog(workspaceId: string, lines: string[]): void {
  fs.writeFileSync(path.join(eventsDir, `${workspaceId}.jsonl`), lines.join("\n") + "\n", "utf-8")
}

describe("migrateLegacyEventLogs", () => {
  it("imports legacy JSONL logs into the events table", () => {
    writeWorkspaceLog("ws1", [
      JSON.stringify({
        seq: 1,
        type: "workspace",
        payload: { id: "ws1" },
        ts: "2026-01-01T00:00:01.000Z",
      }),
      JSON.stringify({
        seq: 2,
        type: "task-start",
        payload: { taskId: "t1" },
        ts: "2026-01-01T00:00:02.000Z",
      }),
    ])
    const store = new SessionStore({ path: path.join(dir, "store.db") })
    const summary = migrateLegacyEventLogs({ store, eventsDir })
    expect(summary).toEqual({ workspaces: 1, imported: 2, skipped: 0 })
    const events = store.listEvents("ws1", { limit: 100 })
    expect(events).toHaveLength(2)
    // listEvents is newest-first: the last imported event comes first.
    expect(events[0]?.type).toBe("task-start")
    expect(events[0]?.payload).toEqual({ taskId: "t1" })
    expect(events[0]?.at).toBe("2026-01-01T00:00:02.000Z")
    expect(events[1]?.type).toBe("workspace")
    expect(events[1]?.payload).toEqual({ id: "ws1" })
    store.close()
  })

  it("is idempotent: running twice yields the same counts", () => {
    writeWorkspaceLog("ws1", [
      JSON.stringify({ seq: 1, type: "a", payload: 1, ts: "2026-01-01T00:00:01.000Z" }),
      '{"seq":2,"type":"b', // corrupt line — skipped, not fatal
      JSON.stringify({ seq: 3, type: "c", payload: 3, ts: "2026-01-01T00:00:03.000Z" }),
    ])
    const store = new SessionStore({ path: path.join(dir, "store.db") })
    const first = migrateLegacyEventLogs({ store, eventsDir })
    expect(first.imported).toBe(2)
    const countAfterFirst = store.listEvents("ws1", { limit: 100 }).length

    const second = migrateLegacyEventLogs({ store, eventsDir })
    expect(second.imported).toBe(0)
    expect(second.skipped).toBe(2)
    const countAfterSecond = store.listEvents("ws1", { limit: 100 }).length
    expect(countAfterSecond).toBe(countAfterFirst)
    expect(countAfterSecond).toBe(2)
    store.close()
  })

  it("imports only the delta when the legacy log grows", () => {
    writeWorkspaceLog("ws1", [
      JSON.stringify({ seq: 1, type: "a", ts: "2026-01-01T00:00:01.000Z" }),
    ])
    const store = new SessionStore({ path: path.join(dir, "store.db") })
    migrateLegacyEventLogs({ store, eventsDir })
    // The legacy JSONL log keeps being appended to during migration.
    writeWorkspaceLog("ws1", [
      JSON.stringify({ seq: 1, type: "a", ts: "2026-01-01T00:00:01.000Z" }),
      JSON.stringify({ seq: 2, type: "b", ts: "2026-01-01T00:00:02.000Z" }),
      JSON.stringify({ seq: 3, type: "c", ts: "2026-01-01T00:00:03.000Z" }),
    ])
    const second = migrateLegacyEventLogs({ store, eventsDir })
    expect(second.imported).toBe(2)
    const events = store.listEvents("ws1", { limit: 100 })
    expect(events).toHaveLength(3)
    expect(events.map((e) => e.type).sort()).toEqual(["a", "b", "c"])
    store.close()
  })

  it("migrates multiple workspaces and honors a workspaceIds filter", () => {
    writeWorkspaceLog("alpha", [
      JSON.stringify({ seq: 1, type: "a", ts: "2026-01-01T00:00:01.000Z" }),
    ])
    writeWorkspaceLog("beta", [
      JSON.stringify({ seq: 1, type: "b", ts: "2026-01-01T00:00:01.000Z" }),
    ])
    const store = new SessionStore({ path: path.join(dir, "store.db") })
    const filtered = migrateLegacyEventLogs({ store, eventsDir, workspaceIds: ["alpha"] })
    expect(filtered.workspaces).toBe(1)
    expect(store.listEvents("beta", { limit: 10 })).toHaveLength(0)
    const all = migrateLegacyEventLogs({ store, eventsDir })
    expect(all.workspaces).toBe(2) // both logs considered; only beta is new
    expect(all.imported).toBe(1)
    expect(all.skipped).toBe(1) // alpha's single event already imported
    expect(store.listEvents("beta", { limit: 10 })).toHaveLength(1)
    store.close()
  })

  it("returns an empty summary for a missing events directory", () => {
    const store = new SessionStore({ path: path.join(dir, "store.db") })
    const summary = migrateLegacyEventLogs({ store, eventsDir: path.join(dir, "absent") })
    expect(summary).toEqual({ workspaces: 0, imported: 0, skipped: 0 })
    store.close()
  })
})
