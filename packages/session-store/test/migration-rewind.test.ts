// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the migration-chain (deepseek session-format V2→V3 borrowing)
 * and rewind/timeline (hermes state_rewind borrowing) added to SessionStore.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import { SessionStore } from "../src/index.js"
import { SCHEMA_VERSION } from "../src/schema.js"

describe("SessionStore migration chain + rewind/timeline", () => {
  let dir: string
  let dbPath: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "migrate-"))
    dbPath = path.join(dir, "sessions.db")
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("migrates a v1 database through the edge chain to v2", async () => {
    // Simulate a v1 database: create it with SCHEMA_VERSION=1 by writing the
    // meta directly after bootstrap, then reopen with current code.
    const store = new SessionStore({ path: dbPath })
    store.migrate()
    store.close()

    // Open raw and force version back to 1 (and drop v2 columns) to simulate
    // an old database.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = (await import("better-sqlite3")).default
    const raw = new Database(dbPath)
    raw.exec("DROP TABLE IF EXISTS messages")
    raw.exec(
      "CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at TEXT)",
    )
    raw.prepare("UPDATE meta SET value = '1' WHERE key = 'schema_version'").run()
    raw.close()

    // Reopen: the chain should walk v1 -> v2 without data loss.
    const reopened = new SessionStore({ path: dbPath }).migrate()
    reopened.appendMessage({ id: "m-1", sessionId: "s-1", role: "user", content: "hello" })
    expect(reopened.timeline("s-1")).toHaveLength(1)
    reopened.close()
  })

  it("refuses a database newer than supported (forward-only)", async () => {
    const store = new SessionStore({ path: dbPath })
    store.migrate()
    store.close()
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = (await import("better-sqlite3")).default
    const raw = new Database(dbPath)
    raw
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(String(SCHEMA_VERSION + 1))
    raw.close()

    const reopened = new SessionStore({ path: dbPath })
    expect(() => reopened.migrate()).toThrow(/forward-only/)
    reopened.close()
  })

  it("rewindFromTurn soft-deletes rows; timeline flags them; durable rows survive", async () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    const append = (id: string, role: string, content: string, turnOrdinal: number) =>
      store.appendMessage({ id, sessionId: "s-1", role, content, turnOrdinal })
    append("m-1", "user", "turn 1", 0)
    append("m-2", "assistant", "done 1", 0)
    append("m-3", "user", "turn 2", 1)

    const hidden = store.rewindFromTurn("s-1", 1)
    expect(hidden).toBe(1) // only m-3 belongs to turn 1+

    const timeline = store.timeline("s-1")
    expect(timeline.find((t) => t.id === "m-3")?.deleted).toBe(true)
    expect(timeline.find((t) => t.id === "m-1")?.deleted).toBe(false)
    // Durable rows still exist — nothing physically deleted.
    const raw = new (await import("better-sqlite3")).default(dbPath)
    const count = (raw.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n
    raw.close()
    expect(count).toBe(3)
    store.close()
  })
})
