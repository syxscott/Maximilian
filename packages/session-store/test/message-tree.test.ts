// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the message tree (deepseek chat-demo branches borrowing):
 * appendBranch / selectMessageVersion on the store, the pure
 * normalization functions, and the v3→v4 migration edge.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  SessionStore,
  GENESIS_HASH,
  messageChainHash,
  buildMessageVersions,
  getVisibleMessages,
  normalizeMessageTree,
  treeBoundaryMetaKey,
  treeRootMetaKey,
  type MessageTreeRow,
} from "../src/index.js"

let dir: string
let dbPath: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "message-tree-"))
  dbPath = path.join(dir, "sessions.db")
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function toTreeRows(store: SessionStore, sessionId: string): MessageTreeRow[] {
  return store.listMessages(sessionId).map((row) => ({
    id: row.id,
    parentId: row.parentId,
    selectedChildId: row.selectedChildId,
    createdAt: row.createdAt,
    deleted: row.deletedAt !== null,
  }))
}

/** Compose the store's rows + stored tree meta into the visible path (how consumers read it). */
function visible(store: SessionStore, sessionId: string): Array<{ id: string; deleted: boolean }> {
  return getVisibleMessages(
    normalizeMessageTree(toTreeRows(store, sessionId), {
      rootId: store.getMeta(treeRootMetaKey(sessionId)) ?? undefined,
      boundaryId: store.getMeta(treeBoundaryMetaKey(sessionId)) ?? undefined,
    }),
  ).map((m) => ({ id: m.id, deleted: m.deleted }))
}

describe("normalizeMessageTree — the normalizeSession port", () => {
  it("links a linear legacy session in memory without rewriting rows", () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "1" })
    store.appendMessage({ id: "m2", sessionId: "s", role: "assistant", content: "2" })
    store.appendMessage({ id: "m3", sessionId: "s", role: "user", content: "3" })

    const tree = normalizeMessageTree(toTreeRows(store, "s"))
    expect(tree.treeMode).toBe(false)
    expect(tree.rootId).toBe("m1")
    expect(tree.messages.map((m) => m.parentId)).toEqual([null, "m1", "m2"])
    expect(tree.messages.map((m) => m.selectedChildId)).toEqual(["m2", "m3", null])
    // The stored rows themselves stay untouched (parentId still null).
    expect(store.listMessages("s").every((row) => row.parentId === null)).toBe(true)
    store.close()
  })
})

describe("SessionStore.appendBranch — the appendBranch port", () => {
  it("attaches a branch to a linear legacy session without rewriting stored rows", () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "q1" })
    store.appendMessage({ id: "m2", sessionId: "s", role: "assistant", content: "a1" })
    store.appendMessage({ id: "m3", sessionId: "s", role: "user", content: "q2" })

    const branch = store.appendBranch("s", "m3", [{ role: "assistant", content: "a2-prime" }])
    expect(branch).toHaveLength(1)
    expect(branch[0].parentId).toBe("m3")

    // The visible path now runs through the new branch; the legacy rows
    // were never rewritten (still parentId null in storage).
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1", "m2", "m3", branch[0].id])
    const m3 = store.listMessages("s").find((row) => row.id === "m3")
    expect(m3?.parentId).toBeNull()
    expect(m3?.selectedChildId).toBe(branch[0].id)
    // New rows follow the same hash-chain rules as any append.
    expect(store.verifyHistory("s")).toEqual({ ok: true })
    store.close()
  })

  it("keeps the previous branch intact and switchable when forking", () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "q" })
    const first = store.appendBranch("s", "m1", [{ role: "assistant", content: "a1" }])
    const second = store.appendBranch("s", "m1", [{ role: "assistant", content: "a2" }])

    // The second append became the selected child; the first stays stored.
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1", second[0].id])
    expect(store.listMessages("s")).toHaveLength(3)

    // Switching back restores the first branch.
    expect(store.selectMessageVersion("s", first[0].id)).toBe(true)
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1", first[0].id])
    store.close()
  })

  it("chains multi-message branches and marks the session tree-mode", () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    const branch = store.appendBranch("s", null, [
      { role: "user", content: "q", turnOrdinal: 0 },
      { role: "assistant", content: "a", turnOrdinal: 0 },
    ])
    expect(branch.map((m) => m.parentId)).toEqual([null, branch[0].id])
    expect(store.getMeta(treeRootMetaKey("s"))).toBe(branch[0].id)
    expect(visible(store, "s").map((m) => m.id)).toEqual([branch[0].id, branch[1].id])
    expect(store.verifyHistory("s")).toEqual({ ok: true })
    store.close()
  })

  it("switches between top-level branches via the stored root marker", () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "q" })
    store.appendMessage({ id: "m2", sessionId: "s", role: "assistant", content: "a" })
    const edited = store.appendBranch("s", null, [{ role: "user", content: "q edited" }])

    // Root moved to the new top-level branch.
    expect(store.getMeta(treeRootMetaKey("s"))).toBe(edited[0].id)
    expect(visible(store, "s").map((m) => m.id)).toEqual([edited[0].id])
    expect(store.selectMessageVersion("s", "m1")).toBe(true)
    // The linear era terminated at m2: switching the root back must NOT
    // leak the new root branch onto the end of the old linear chain.
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1", "m2"])
    expect(store.selectMessageVersion("s", edited[0].id)).toBe(true)
    expect(visible(store, "s").map((m) => m.id)).toEqual([edited[0].id])
    store.close()
  })

  it("rejects unknown and soft-deleted parents (caller bug, not storage)", () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "q", turnOrdinal: 0 })
    expect(() => store.appendBranch("s", "nope", [{ role: "assistant", content: "a" }])).toThrow(
      /unknown message nope/,
    )
    store.rewindFromTurn("s", 0)
    expect(() => store.appendBranch("s", "m1", [{ role: "assistant", content: "a" }])).toThrow(
      /soft-deleted message m1/,
    )
    store.close()
  })
})

describe("SessionStore.selectMessageVersion — the selectVersion port", () => {
  function buildForked(store: SessionStore): { q1: string; r1: string; q2: string; r2: string } {
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "q" })
    const [q1, r1] = store.appendBranch("s", "m1", [
      { role: "assistant", content: "a1" },
      { role: "user", content: "follow-up", turnOrdinal: 1 },
    ])
    const [q2, r2] = store.appendBranch("s", "m1", [
      { role: "assistant", content: "a2" },
      { role: "user", content: "follow-up 2", turnOrdinal: 1 },
    ])
    return { q1, r1, q2, r2 }
  }

  it("switches only siblings of the visible path; unreachable targets return false", () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    const { q1, r1, q2, r2 } = buildForked(store)

    // Currently on the q2 branch; switching to its sibling q1 is allowed.
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1", q2.id, r2.id])
    expect(store.selectMessageVersion("s", q1.id)).toBe(true)
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1", q1.id, r1.id])

    // Fork under q1 (the now-selected branch) to park a grandchild x,
    // then switch away to q2 again. x's parent q1 is no longer on the
    // visible path → x is unreachable and returns false.
    const [x] = store.appendBranch("s", q1.id, [{ role: "assistant", content: "x" }])
    expect(store.selectMessageVersion("s", q2.id)).toBe(true)
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1", q2.id, r2.id])
    expect(store.selectMessageVersion("s", x.id)).toBe(false)
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1", q2.id, r2.id])
    store.close()
  })

  it("switching back restores the switched-to node's own subtree selection", () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    const { q1, q2, r2 } = buildForked(store)

    // Fork under the UNSELECTED q1: the visible path stays on q2's branch
    // (forking under a hidden branch never moves what the user sees), but
    // q1 now carries its own parked subtree choice (r1b).
    const [r1b] = store.appendBranch("s", q1.id, [{ role: "assistant", content: "a1-v2" }])
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1", q2.id, r2.id])

    // Over to q1: its parked choice comes back intact — the switch only
    // ever moves ONE pointer (the parent row's), never the children's.
    expect(store.selectMessageVersion("s", q1.id)).toBe(true)
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1", q1.id, r1b.id])
    expect(store.selectMessageVersion("s", q2.id)).toBe(true)
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1", q2.id, r2.id])
    expect(visible(store, "s").every((m) => !m.deleted)).toBe(true)
    store.close()
  })

  it("returns false for linear sessions and unknown messages", () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "q" })
    expect(store.selectMessageVersion("s", "m1")).toBe(false)
    expect(store.selectMessageVersion("s", "nope")).toBe(false)
    expect(store.selectMessageVersion("unknown-session", "m1")).toBe(false)
    // Nothing became tree-mode by failing to switch.
    expect(store.getMeta(treeRootMetaKey("s"))).toBeNull()
    store.close()
  })

  it("is compatible with rewindFromTurn: switching never resurrects deleted rows", () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "q", turnOrdinal: 0 })
    // Branch A rows belong to turn 1 (rewind will hide them); branch B
    // rows were written with turnOrdinal 0 and survive the rewind.
    const [q1, r1] = store.appendBranch("s", "m1", [
      { role: "assistant", content: "a1", turnOrdinal: 1 },
      { role: "user", content: "f1", turnOrdinal: 1 },
    ])
    const [q2, r2] = store.appendBranch("s", "m1", [
      { role: "assistant", content: "a2", turnOrdinal: 0 },
      { role: "user", content: "f2", turnOrdinal: 0 },
    ])

    store.rewindFromTurn("s", 1)
    expect(store.listMessages("s").find((row) => row.id === q1.id)?.deletedAt).not.toBeNull()

    // The selected path walks to the surviving branch and STOPS at the
    // first deleted row (rewind hides a suffix).
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1", q2.id, r2.id])

    // Switching to the hidden branch is allowed (its head is a sibling of
    // q2) but the deleted rows stay hidden — the walk stops at q1.
    expect(store.selectMessageVersion("s", q1.id)).toBe(true)
    expect(store.listMessages("s").find((row) => row.id === q1.id)?.deletedAt).not.toBeNull()
    expect(visible(store, "s").map((m) => m.id)).toEqual(["m1"])
    store.close()
  })
})

describe("buildMessageVersions — the version-list port", () => {
  it("groups siblings per parent and reuses unchanged objects for streaming stability", () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "q" })
    const [q1] = store.appendBranch("s", "m1", [{ role: "assistant", content: "a1" }])
    const [q2] = store.appendBranch("s", "m1", [{ role: "assistant", content: "a2" }])

    const tree = normalizeMessageTree(toTreeRows(store, "s"), {
      rootId: store.getMeta(treeRootMetaKey("s")) ?? undefined,
      boundaryId: store.getMeta(treeBoundaryMetaKey("s")) ?? undefined,
    })
    const first = buildMessageVersions(tree, new Map())

    // m1 is the parent of both branch heads: one group of two, m1 at
    // index 0, the two heads as versions 0/1 of the same group.
    expect(first.get("m1")).toEqual({ ids: ["m1"], index: 0 })
    expect(first.get(q1.id)).toEqual({ ids: [q1.id, q2.id], index: 0 })
    expect(first.get(q2.id)).toEqual({ ids: [q1.id, q2.id], index: 1 })

    // Unchanged tree: the exact same Map instance (and object identities)
    // come back — this is what keeps streaming re-renders off the history.
    expect(buildMessageVersions(tree, first)).toBe(first)
    store.close()
  })
})

describe("v3→v4 migration edge — the tree columns", () => {
  it("upgrades a v3 database: legacy rows stay readable with null tree fields", async () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "q" })
    store.close()

    // Downgrade to a v3-shaped database: v2+v3 columns present, no tree
    // columns, version stamped 3.
    const Database = (await import("better-sqlite3")).default
    const raw = new Database(dbPath)
    raw.exec("DROP TABLE messages")
    raw.exec(
      "CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at TEXT, " +
        "deleted_at TEXT, turn_ordinal INTEGER, seq INTEGER, prev_hash TEXT, hash TEXT)",
    )
    raw
      .prepare(
        "INSERT INTO messages (id, session_id, role, content, created_at, seq, prev_hash, hash) VALUES ('m1', 's', 'user', 'q', '2026-01-01T00:00:00.000Z', 1, ?, ?)",
      )
      .run(
        GENESIS_HASH,
        messageChainHash({
          seq: 1,
          sessionId: "s",
          role: "user",
          content: "q",
          prevHash: GENESIS_HASH,
        }),
      )
    raw.prepare("UPDATE meta SET value = '3' WHERE key = 'schema_version'").run()
    raw.close()

    const reopened = new SessionStore({ path: dbPath }).migrate()
    expect(reopened.schemaVersion).toBe(4)
    const row = reopened.listMessages("s")[0]
    expect(row.content).toBe("q")
    expect(row.seq).toBe(1) // v3 hash-chain data survived
    expect(row.parentId).toBeNull()
    expect(row.selectedChildId).toBeNull()
    // The old row verifies like a chain (it carries v3 chain columns).
    expect(reopened.verifyHistory("s")).toEqual({ ok: true })
    // And the session behaves as a linear legacy segment.
    expect(reopened.selectMessageVersion("s", "m1")).toBe(false)
    reopened.close()
  })

  it("creates the (session_id, parent_id) index and re-running migrate is idempotent", async () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    store.migrate() // second run on the same handle
    store.appendBranch("s", null, [{ role: "user", content: "q" }])
    store.close()

    const Database = (await import("better-sqlite3")).default
    const raw = new Database(dbPath)
    const indexes = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_messages_session_parent'",
      )
      .all()
    expect(indexes).toHaveLength(1)
    raw.close()

    // And once more through a fresh handle (process restart path).
    const reopened = new SessionStore({ path: dbPath }).migrate()
    expect(reopened.schemaVersion).toBe(4)
    expect(reopened.listMessages("s")).toHaveLength(1)
    reopened.close()
  })
})
