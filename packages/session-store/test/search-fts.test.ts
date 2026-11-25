// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * FTS5 full-text search tests (opencode search-index.ts / search.ts
 * borrowing): external-content index maintained by triggers, bm25 ranking,
 * snippet highlighting, prefix/phrase syntax, graceful handling of
 * punctuation-only queries, and the idempotent v4 -> v5 migration edge that
 * rebuilds historical rows.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SessionStore, SCHEMA_VERSION } from "../src/index.js"

let dir: string
let dbPath: string
let store: SessionStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-fts-"))
  dbPath = path.join(dir, "store.db")
  store = new SessionStore({ path: dbPath })
})

afterEach(() => {
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

function seed(): void {
  store.appendSession({ id: "s1", workspaceId: "ws-1", title: "alpha" })
  store.appendSession({ id: "s2", workspaceId: "ws-2", title: "beta" })
  store.appendMessage({
    id: "m1",
    sessionId: "s1",
    role: "user",
    content: "The zeppelin crashed over the North Sea",
    createdAt: "2026-01-01T00:00:00.000Z",
  })
  store.appendMessage({
    id: "m2",
    sessionId: "s2",
    role: "assistant",
    content:
      "zeppelin zeppelin zeppelin plus a great many other words to make this document much longer than the first one so bm25 should prefer the term frequency",
    createdAt: "2026-01-02T00:00:00.000Z",
  })
  store.appendMessage({
    id: "m3",
    sessionId: "s1",
    role: "user",
    content: "authentication flow begins here",
    createdAt: "2026-01-03T00:00:00.000Z",
  })
}

describe("SessionStore.searchMessages — FTS5", () => {
  it("indexes appended messages and ranks them with bm25", () => {
    // Ranking must come from bm25, not recency. The older document is the
    // SHORT one-match hit; the newer one repeats the term but is far longer,
    // and bm25's length normalization still prefers the short document.
    // A recency-ordered scan would return the 2026-02-01 row first.
    store.appendSession({ id: "s1", workspaceId: "ws-1" })
    store.appendSession({ id: "s2", workspaceId: "ws-2" })
    store.appendMessage({
      id: "old",
      sessionId: "s1",
      role: "user",
      content: "zeppelin",
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    store.appendMessage({
      id: "new",
      sessionId: "s2",
      role: "user",
      content:
        "zeppelin zeppelin zeppelin zeppelin zeppelin plus a great many other words to pad the length out substantially",
      createdAt: "2026-02-01T00:00:00.000Z",
    })

    const hits = store.searchMessages("zeppelin")
    expect(hits.map((hit) => hit.createdAt)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    ])
    expect(hits[0]?.snippet).toContain("[zeppelin]")
    // Explicit fts mode serves the same result.
    expect(store.searchMessagesFts("zeppelin").map((hit) => hit.createdAt)).toEqual(
      hits.map((hit) => hit.createdAt),
    )
  })

  it("supports prefix stars and quoted phrases", () => {
    seed()
    expect(store.searchMessages("auth*").map((hit) => hit.content)).toEqual([
      "authentication flow begins here",
    ])
    expect(store.searchMessages("auth", { prefix: true }).map((hit) => hit.content)).toEqual([
      "authentication flow begins here",
    ])
    expect(store.searchMessages('"authentication flow"').map((hit) => hit.content)).toEqual([
      "authentication flow begins here",
    ])
    // Phrase order matters: the reversed phrase must not match.
    expect(store.searchMessages('"flow authentication"')).toEqual([])
  })

  it("never throws on punctuation / operator-like queries and falls back to LIKE", () => {
    seed()
    store.appendMessage({
      id: "m4",
      sessionId: "s1",
      role: "user",
      content: "progress 100%",
      createdAt: "2026-01-04T00:00:00.000Z",
    })

    const awkward = [
      "C++",
      "(",
      ")",
      ":",
      "@",
      "#",
      "\\",
      "***",
      '"unterminated',
      "NEAR(",
      "AND",
      "a_b",
    ]
    for (const query of awkward) {
      expect(Array.isArray(store.searchMessages(query))).toBe(true)
      // The explicit FTS entry point also recovers (quoted-token retry).
      expect(Array.isArray(store.searchMessagesFts(query))).toBe(true)
    }
    // A query with no indexable token uses the literal LIKE scan, so "%"
    // matches the literal percent sign rather than every row.
    const percents = store.searchMessages("%")
    expect(percents).toHaveLength(1)
    expect(percents[0]?.content).toBe("progress 100%")
    expect(store.searchMessages("\\")).toEqual([])
  })

  it("excludes soft-deleted rows and honors the workspace filter", () => {
    seed()
    store.appendMessage({
      id: "m4",
      sessionId: "s1",
      role: "user",
      content: "another zeppelin note",
      turnOrdinal: 7,
      createdAt: "2026-01-04T00:00:00.000Z",
    })
    expect(store.searchMessages("zeppelin", { workspaceId: "ws-1" })).toHaveLength(2)

    store.rewindFromTurn("s1", 7)
    const visible = store.searchMessages("zeppelin", { workspaceId: "ws-1" })
    expect(visible).toHaveLength(1)
    expect(visible[0]?.content).toBe("The zeppelin crashed over the North Sea")
  })

  it("updates the index incrementally when a message id is re-appended", () => {
    store.appendSession({ id: "s1", workspaceId: "ws-1" })
    store.appendMessage({
      id: "m1",
      sessionId: "s1",
      role: "user",
      content: "original wombat",
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    expect(store.searchMessages("wombat")).toHaveLength(1)

    // Dual-write retry / content mutation path: the AFTER UPDATE trigger
    // must remove the old text before inserting the new one.
    store.appendMessage({
      id: "m1",
      sessionId: "s1",
      role: "user",
      content: "replacement narwhal",
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    expect(store.searchMessages("wombat")).toEqual([])
    expect(store.searchMessages("narwhal")).toHaveLength(1)
  })

  it("keeps the index consistent across replaceSessions", () => {
    seed()
    store.replaceSessions(
      [
        {
          id: "s9",
          workspaceId: "ws-9",
          title: "restored",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      [
        {
          id: "m9",
          sessionId: "s9",
          role: "user",
          content: "replacement wombat",
          createdAt: "2026-03-01T00:00:00.000Z",
          turnOrdinal: 0,
          deletedAt: null,
          parentId: null,
          selectedChildId: null,
        },
      ],
      new Map(),
    )

    expect(store.searchMessages("wombat").map((hit) => hit.content)).toEqual(["replacement wombat"])
    expect(store.searchMessages("zeppelin")).toEqual([])
  })
})

describe("SessionStore.searchMessages — v4 -> v5 migration", () => {
  it("rebuilds historical rows and is idempotent", async () => {
    store.appendSession({ id: "s1", workspaceId: "ws-1" })
    store.appendMessage({
      id: "m1",
      sessionId: "s1",
      role: "user",
      content: "historical quokka sighting",
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    store.close()

    // Simulate a v4 database: base tables with rows, no FTS objects.

    const Database = (await import("better-sqlite3")).default
    const raw = new Database(dbPath)
    raw.exec("DROP TRIGGER IF EXISTS messages_fts_insert")
    raw.exec("DROP TRIGGER IF EXISTS messages_fts_update")
    raw.exec("DROP TRIGGER IF EXISTS messages_fts_delete")
    raw.exec("DROP TABLE IF EXISTS messages_fts")
    raw.prepare("UPDATE meta SET value = '4' WHERE key = 'schema_version'").run()
    raw.close()

    const reopened = new SessionStore({ path: dbPath }).migrate()
    expect(reopened.schemaVersion).toBe(SCHEMA_VERSION)

    // Historical rows are searchable after the rebuild ...
    const historical = reopened.searchMessages("quokka")
    expect(historical).toHaveLength(1)
    expect(historical[0]?.content).toBe("historical quokka sighting")

    // ... freshly appended rows are indexed incrementally by the triggers ...
    reopened.appendMessage({
      id: "m2",
      sessionId: "s1",
      role: "assistant",
      content: "fresh narwhal update",
      createdAt: "2026-01-02T00:00:00.000Z",
    })
    expect(reopened.searchMessages("narwhal")).toHaveLength(1)

    // ... and re-running the migration neither throws nor duplicates entries.
    const count = (): number => {
      const probe = new Database(dbPath)
      const row = probe.prepare("SELECT COUNT(*) AS n FROM messages_fts").get() as { n: number }
      probe.close()
      return row.n
    }
    const before = count()
    reopened.migrate()
    expect(count()).toBe(before)
    expect(reopened.searchMessages("quokka")).toHaveLength(1)
    reopened.close()
  })

  it("gives a fresh database the current schema and a working index", () => {
    expect(store.schemaVersion).toBe(0)
    store.appendSession({ id: "s1", workspaceId: "ws-1" })
    store.appendMessage({
      id: "m1",
      sessionId: "s1",
      role: "user",
      content: "fresh platypus record",
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    expect(store.schemaVersion).toBe(SCHEMA_VERSION)
    expect(store.searchMessages("platypus")).toHaveLength(1)
  })
})
