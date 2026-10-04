// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the message hash chain (minimax-code incremental SHA-256
 * borrowing): chained appends, tamper detection, legacy segments, and
 * verify-after-rewind semantics.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SessionStore, GENESIS_HASH, messageChainHash } from "../src/index.js"

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-hash-chain-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function open(dbPath: string): SessionStore {
  return new SessionStore({ path: dbPath }).migrate()
}

describe("hash chain: chained appends", () => {
  it("assigns increasing seq values and links each row to the previous hash", () => {
    const store = open(path.join(dir, "a.db"))
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "hi" })
    store.appendMessage({ id: "m2", sessionId: "s", role: "assistant", content: "hello" })
    store.appendMessage({ id: "m3", sessionId: "s", role: "user", content: "bye" })

    const rows = store.listMessages("s")
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3])
    expect(rows[0]?.prevHash).toBe(GENESIS_HASH)
    expect(rows[1]?.prevHash).toBe(rows[0]?.hash)
    expect(rows[2]?.prevHash).toBe(rows[1]?.hash)

    // Each hash commits to seq+session+role+content+prev (canonical form).
    expect(rows[1]?.hash).toBe(
      messageChainHash({
        seq: 2,
        sessionId: "s",
        role: "assistant",
        content: "hello",
        prevHash: rows[0]?.hash ?? "",
      }),
    )
    store.close()
  })

  it("keeps separate chains per session", () => {
    const store = open(path.join(dir, "b.db"))
    store.appendMessage({ id: "a1", sessionId: "s-a", role: "user", content: "one" })
    store.appendMessage({ id: "b1", sessionId: "s-b", role: "user", content: "two" })
    const a = store.listMessages("s-a")[0]
    const b = store.listMessages("s-b")[0]
    expect(a?.prevHash).toBe(GENESIS_HASH)
    expect(b?.prevHash).toBe(GENESIS_HASH)
    // Same fields except sessionId → different hashes.
    expect(a?.hash).not.toBe(b?.hash)
    expect(store.verifyHistory("s-a").ok).toBe(true)
    expect(store.verifyHistory("s-b").ok).toBe(true)
    store.close()
  })

  it("re-appending an identical message keeps the chain valid (dual-write retry)", () => {
    const store = open(path.join(dir, "c.db"))
    const msg = { id: "m1", sessionId: "s", role: "user", content: "same", createdAt: "t" }
    store.appendMessage(msg)
    store.appendMessage({ id: "m2", sessionId: "s", role: "assistant", content: "ok" })
    store.appendMessage(msg)
    expect(store.listMessages("s")).toHaveLength(2)
    expect(store.verifyHistory("s").ok).toBe(true)
    store.close()
  })

  it("verifies across close/reopen (chain state is durable)", () => {
    const dbPath = path.join(dir, "d.db")
    const first = open(dbPath)
    first.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "persist me" })
    first.close()
    const second = open(dbPath)
    second.appendMessage({ id: "m2", sessionId: "s", role: "assistant", content: "still linked" })
    expect(second.verifyHistory("s").ok).toBe(true)
    second.close()
  })
})

describe("hash chain: tamper detection", () => {
  it("detects a mutated content field", async () => {
    const dbPath = path.join(dir, "e.db")
    const store = open(dbPath)
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "original" })
    store.appendMessage({ id: "m2", sessionId: "s", role: "assistant", content: "reply" })
    store.close()

    const raw = new (await import("better-sqlite3")).default(dbPath)
    raw.prepare("UPDATE messages SET content = 'forged' WHERE id = 'm1'").run()
    raw.close()

    const verdict = open(dbPath).verifyHistory("s")
    expect(verdict.ok).toBe(false)
    expect(verdict.brokenAt).toBe("m1")
    store.close()
  })

  it("detects a broken prev_hash link (row spliced out of the chain)", async () => {
    const dbPath = path.join(dir, "f.db")
    const store = open(dbPath)
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "one" })
    store.appendMessage({ id: "m2", sessionId: "s", role: "assistant", content: "two" })
    store.appendMessage({ id: "m3", sessionId: "s", role: "user", content: "three" })
    store.close()

    const raw = new (await import("better-sqlite3")).default(dbPath)
    raw.prepare("UPDATE messages SET prev_hash = ? WHERE id = 'm3'").run("f".repeat(64))
    raw.close()

    const verdict = open(dbPath).verifyHistory("s")
    expect(verdict.ok).toBe(false)
    expect(verdict.brokenAt).toBe("m3")
    store.close()
  })

  it("reports the FIRST broken link, not a later one", async () => {
    const dbPath = path.join(dir, "g.db")
    const store = open(dbPath)
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "one" })
    store.appendMessage({ id: "m2", sessionId: "s", role: "assistant", content: "two" })
    store.appendMessage({ id: "m3", sessionId: "s", role: "user", content: "three" })
    store.close()

    const raw = new (await import("better-sqlite3")).default(dbPath)
    raw.prepare("UPDATE messages SET content = 'x' WHERE id = 'm1'").run()
    raw.prepare("UPDATE messages SET content = 'y' WHERE id = 'm3'").run()
    raw.close()

    const verdict = open(dbPath).verifyHistory("s")
    expect(verdict.ok).toBe(false)
    expect(verdict.brokenAt).toBe("m1")
    store.close()
  })

  it("detects a mid-chain content mutation of an already-chained id on re-append", () => {
    const store = open(path.join(dir, "h.db"))
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "one" })
    store.appendMessage({ id: "m2", sessionId: "s", role: "assistant", content: "two" })
    // Rewriting a chained row's content in place must invalidate m2's link.
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "REWRITTEN" })
    const verdict = store.verifyHistory("s")
    expect(verdict.ok).toBe(false)
    expect(verdict.brokenAt).toBe("m2")
    store.close()
  })
})

describe("hash chain: legacy segment", () => {
  it("skips NULL-hash rows and starts verification at the first chained row", async () => {
    const dbPath = path.join(dir, "i.db")
    // Simulate pre-chain data: v2-shaped rows with NULL seq/prev_hash/hash.
    const raw = new (await import("better-sqlite3")).default(dbPath)
    raw.exec(
      "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);" +
        "INSERT INTO meta VALUES ('schema_version', '2');",
    )
    raw.exec(
      "CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT," +
        " created_at TEXT, deleted_at TEXT, turn_ordinal INTEGER);",
    )
    const ins = raw.prepare(
      "INSERT INTO messages (id, session_id, role, content) VALUES (?, 's', 'user', ?)",
    )
    ins.run("old-1", "pre-chain one")
    ins.run("old-2", "pre-chain two")
    raw.close()

    const store = open(dbPath)
    store.appendMessage({ id: "new-1", sessionId: "s", role: "assistant", content: "chained now" })
    store.appendMessage({ id: "new-2", sessionId: "s", role: "user", content: "and more" })

    expect(store.verifyHistory("s").ok).toBe(true)
    const rows = store.listMessages("s")
    expect(rows.find((r) => r.id === "old-1")?.hash).toBeNull()
    expect(rows.find((r) => r.id === "new-1")?.prevHash).toBe(GENESIS_HASH)

    // Tampering with a LEGACY row does not break the chain (it is outside it).
    store.close()
    const raw2 = new (await import("better-sqlite3")).default(dbPath)
    raw2.prepare("UPDATE messages SET content = 'legacy edit' WHERE id = 'old-1'").run()
    raw2.close()
    expect(open(dbPath).verifyHistory("s").ok).toBe(true)
  })

  it("flags a legacy row that carries prev_hash without a hash", async () => {
    const dbPath = path.join(dir, "j.db")
    const store = open(dbPath)
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "one" })
    store.close()

    const raw = new (await import("better-sqlite3")).default(dbPath)
    raw.prepare("UPDATE messages SET hash = NULL WHERE id = 'm1'").run()
    raw.prepare("UPDATE messages SET prev_hash = ? WHERE id = 'm1'").run(GENESIS_HASH)
    raw.close()

    const verdict = open(dbPath).verifyHistory("s")
    expect(verdict.ok).toBe(false)
    expect(verdict.brokenAt).toBe("m1")
  })
})

describe("hash chain: rewind interaction", () => {
  it("soft-deleted rows stay in the chain; verify still passes after rewind", () => {
    const store = open(path.join(dir, "k.db"))
    store.appendMessage({
      id: "m1",
      sessionId: "s",
      role: "user",
      content: "turn 1",
      turnOrdinal: 0,
    })
    store.appendMessage({
      id: "m2",
      sessionId: "s",
      role: "assistant",
      content: "done 1",
      turnOrdinal: 0,
    })
    store.appendMessage({
      id: "m3",
      sessionId: "s",
      role: "user",
      content: "turn 2",
      turnOrdinal: 1,
    })

    expect(store.rewindFromTurn("s", 1)).toBe(1)
    // Rewind hides rows from the user but must not rewrite history.
    expect(store.verifyHistory("s").ok).toBe(true)
    // And the chain still extends correctly through soft-deleted rows.
    store.appendMessage({
      id: "m4",
      sessionId: "s",
      role: "assistant",
      content: "fresh after rewind",
    })
    const rows = store.listMessages("s")
    expect(rows[3]?.prevHash).toBe(rows[2]?.hash)
    expect(store.verifyHistory("s").ok).toBe(true)
    store.close()
  })
})

describe("hash chain: edge cases", () => {
  it("verifyHistory on an unknown session is ok (empty chain)", () => {
    const store = open(path.join(dir, "l.db"))
    expect(store.verifyHistory("missing-session")).toEqual({ ok: true })
    store.close()
  })

  it("detects a chained row whose seq was removed", async () => {
    const dbPath = path.join(dir, "m.db")
    const store = open(dbPath)
    store.appendMessage({ id: "m1", sessionId: "s", role: "user", content: "one" })
    store.close()
    const raw = new (await import("better-sqlite3")).default(dbPath)
    raw.prepare("UPDATE messages SET seq = NULL WHERE id = 'm1'").run()
    raw.close()
    const verdict = open(dbPath).verifyHistory("s")
    expect(verdict.ok).toBe(false)
    expect(verdict.brokenAt).toBe("m1")
  })
})
