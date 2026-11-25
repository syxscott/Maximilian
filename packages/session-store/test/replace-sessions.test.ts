// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Ordering/atomicity proofs for {@link SessionStore.replaceSessions}
 * (minimax-code store.mjs deleteChat borrowing).
 *
 * The reference implementation writes the "forget this chat" state to disk
 * BEFORE truncating the un-rebuildable transcript, so a failure of the second
 * write leaves the chat forgotten-but-listed rather than listed-but-empty.
 * This store has no separate forget path: the whole swap (irreversible
 * DELETEs + replacement INSERTs + tree markers) runs inside ONE
 * `BEGIN IMMEDIATE` transaction. That is strictly stronger than the
 * two-write reference protocol — a failure at ANY point rolls the entire
 * swap back, so the store can never observe a half-replaced state. These
 * tests inject failures at the two dangerous points (the irreversible
 * DELETE itself, and a constraint violation during the replacement
 * INSERTs) and assert the original state survives and the operation can be
 * retried.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SessionStore, treeRootMetaKey } from "../src/index.js"
import type { ReplaceMessageRow, ReplaceSessionRow } from "../src/index.js"

let dir: string
let dbPath: string
let store: SessionStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-replace-"))
  dbPath = path.join(dir, "store.db")
  store = new SessionStore({ path: dbPath })
})

afterEach(() => {
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

function seedOriginal(): void {
  store.appendSession({ id: "s1", workspaceId: "ws-1", title: "original" })
  store.appendMessage({
    id: "m1",
    sessionId: "s1",
    role: "user",
    content: "original body",
    createdAt: "2026-01-01T00:00:00.000Z",
  })
}

function replacementSessions(): ReplaceSessionRow[] {
  return [
    {
      id: "s2",
      workspaceId: "ws-2",
      title: "replacement",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
  ]
}

function replacementMessages(): ReplaceMessageRow[] {
  return [
    {
      id: "m2",
      sessionId: "s2",
      role: "user",
      content: "replacement body",
      createdAt: "2026-02-01T00:00:00.000Z",
      turnOrdinal: 0,
      deletedAt: null,
      parentId: null,
      selectedChildId: null,
    },
  ]
}

describe("SessionStore.replaceSessions atomicity", () => {
  it("rolls the whole swap back when the irreversible DELETE fails, and retries", async () => {
    seedOriginal()
    // Inject a failure exactly at the irreversible cleanup step: the trigger
    // aborts the first message DELETE, before any replacement row is written.

    const Database = (await import("better-sqlite3")).default
    const injector = new Database(dbPath)
    injector.exec(
      "CREATE TRIGGER inject_cleanup_failure BEFORE DELETE ON messages " +
        "WHEN OLD.id = 'm1' BEGIN SELECT RAISE(ABORT, 'injected cleanup failure'); END",
    )
    injector.close()

    expect(() =>
      store.replaceSessions(replacementSessions(), replacementMessages(), new Map()),
    ).toThrow(/injected cleanup failure/)

    // Nothing was committed: the pre-swap sessions AND messages are intact.
    expect(store.listSessions().map((session) => session.id)).toEqual(["s1"])
    expect(store.listMessages("s1").map((message) => message.id)).toEqual(["m1"])

    // Remove the injection and retry the exact same swap: it must succeed.
    const cleaner = new Database(dbPath)
    cleaner.exec("DROP TRIGGER inject_cleanup_failure")
    cleaner.close()

    store.replaceSessions(replacementSessions(), replacementMessages(), new Map())
    expect(store.listSessions().map((session) => session.id)).toEqual(["s2"])
    expect(store.listMessages("s2").map((message) => message.id)).toEqual(["m2"])
  })

  it("restores dropped tree markers when a swap fails after the DELETEs", async () => {
    seedOriginal()
    store.setMeta(treeRootMetaKey("s1"), "m1")

    const Database = (await import("better-sqlite3")).default
    const injector = new Database(dbPath)
    injector.exec(
      "CREATE TRIGGER inject_cleanup_failure BEFORE DELETE ON messages " +
        "WHEN OLD.id = 'm1' BEGIN SELECT RAISE(ABORT, 'injected cleanup failure'); END",
    )
    injector.close()

    expect(() =>
      store.replaceSessions(replacementSessions(), replacementMessages(), new Map()),
    ).toThrow(/injected cleanup failure/)

    // The tree-marker wipe runs first inside the transaction; the rollback
    // must put it back rather than leaving the session marker-less.
    expect(store.getMeta(treeRootMetaKey("s1"))).toBe("m1")

    const cleaner = new Database(dbPath)
    cleaner.exec("DROP TRIGGER inject_cleanup_failure")
    cleaner.close()
  })

  it("rolls back when a replacement row violates a constraint after the DELETEs", () => {
    seedOriginal()
    // Two rows sharing the primary key: the first INSERT succeeds, the second
    // raises — after the irreversible DELETEs have already run.
    const duplicated: ReplaceMessageRow[] = [
      ...replacementMessages(),
      { ...replacementMessages()[0] },
    ]

    expect(() => store.replaceSessions(replacementSessions(), duplicated, new Map())).toThrow()

    expect(store.listSessions().map((session) => session.id)).toEqual(["s1"])
    expect(store.listMessages("s1").map((message) => message.id)).toEqual(["m1"])
  })

  it("keeps writers that commit after the swap (IMMEDIATE serializes them)", async () => {
    seedOriginal()
    store.replaceSessions(replacementSessions(), replacementMessages(), new Map())

    // A second connection committing after the swap must land alongside the
    // replacement — the swap holds BEGIN IMMEDIATE for its whole duration, so
    // there is no window where a concurrent create can be overwritten.
    const Database = (await import("better-sqlite3")).default
    const other = new Database(dbPath)
    const at = "2026-03-01T00:00:00.000Z"
    other
      .prepare(
        "INSERT INTO sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("s3", "ws-3", "concurrent", at, at)
    other.close()

    store.appendSession({ id: "s4", workspaceId: "ws-4", title: "after" })

    expect(
      store
        .listSessions()
        .map((session) => session.id)
        .sort(),
    ).toEqual(["s2", "s3", "s4"])
  })
})
