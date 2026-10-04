// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the write safety coordinator:
 *   - normalizeLockKey collapses path variants onto one key.
 *   - same key: acquirers are serialized (second waits for release).
 *   - different keys: acquired in parallel without waiting.
 *   - timeout: structured failure (ok=false), holder hinted, no partial holds.
 *   - opposing multi-key orders never deadlock (sorted total order).
 *   - audit ledger records acquired/released/timeout.
 */
import { describe, it, expect } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { WriteLeaseCoordinator, normalizeLockKey } from "../src/write-lease.js"
import { AuditLedger } from "../src/audit-ledger.js"

describe("normalizeLockKey", () => {
  it("collapses equivalent path spellings onto one key", () => {
    const base = path.join(tmpdir(), "ws")
    expect(normalizeLockKey(path.join(base, "a", "b.txt"))).toBe(
      normalizeLockKey(path.join(base, "nested", "..", "a", "b.txt")),
    )
    expect(normalizeLockKey("/tmp/x/")).toBe("/tmp/x")
    expect(normalizeLockKey("relative/file")).toBe(path.resolve(process.cwd(), "relative/file"))
  })
})

describe("WriteLeaseCoordinator", () => {
  it("serializes acquirers of the same key", async () => {
    const coord = new WriteLeaseCoordinator()
    const events: string[] = []

    const first = coord.acquire(["/w/file.txt"]).then(async (r) => {
      expect(r.ok).toBe(true)
      events.push("first-start")
      await new Promise((resolve) => setTimeout(resolve, 50))
      events.push("first-end")
      if (r.ok) r.lease.release()
    })

    // Let the first acquirer take the key before the second asks.
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = coord.acquire(["/w/file.txt"]).then((r) => {
      expect(r.ok).toBe(true)
      events.push("second-start")
      if (r.ok) r.lease.release()
    })

    await Promise.all([first, second])
    expect(events).toEqual(["first-start", "first-end", "second-start"])
  })

  it("grants different keys in parallel without waiting", async () => {
    const coord = new WriteLeaseCoordinator()
    const started = Date.now()
    const [a, b] = await Promise.all([coord.acquire(["/w/a.txt"]), coord.acquire(["/w/b.txt"])])
    expect(Date.now() - started).toBeLessThan(100)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok) a.lease.release()
    if (b.ok) b.lease.release()
    expect(coord.heldKeys()).toEqual([])
  })

  it("times out with a structured failure naming the contested key", async () => {
    const coord = new WriteLeaseCoordinator()
    const first = await coord.acquire(["/w/busy.txt"])
    expect(first.ok).toBe(true)

    // Sorted order puts busy first, so the acquisition fails before free
    // is ever touched — the outcome names the contested key only.
    const outcome = await coord.acquire(["/w/busy.txt", "/w/free.txt"], { timeoutMs: 60 })
    expect(outcome).toMatchObject({ ok: false, error: "lease-timeout", key: "/w/busy.txt" })
    if (!outcome.ok) expect(outcome.waitedMs).toBeGreaterThanOrEqual(30)

    if (first.ok) first.lease.release()
    expect(coord.heldKeys()).toEqual([])

    // After release the key is acquirable again.
    const retry = await coord.acquire(["/w/busy.txt"])
    expect(retry.ok).toBe(true)
    if (retry.ok) retry.lease.release()
  })

  it("never deadlocks when opposing multi-key orders contend", async () => {
    const coord = new WriteLeaseCoordinator()
    const completions: string[] = []
    // {a,b} vs {b,a}: with a naive hold-and-wait this deadlocks; sorted
    // acquisition makes both callers wait on the same first key instead.
    const orderA = coord.acquire(["/w/a", "/w/b"], { timeoutMs: 2_000 }).then((r) => {
      expect(r.ok).toBe(true)
      completions.push("ab")
      if (r.ok) r.lease.release()
    })
    const orderB = coord.acquire(["/w/b", "/w/a"], { timeoutMs: 2_000 }).then((r) => {
      expect(r.ok).toBe(true)
      completions.push("ba")
      if (r.ok) r.lease.release()
    })
    await Promise.all([orderA, orderB])
    expect(completions.sort()).toEqual(["ab", "ba"])
    expect(coord.heldKeys()).toEqual([])
  }, 10_000)

  it("deduplicates repeated keys within one acquisition", async () => {
    const coord = new WriteLeaseCoordinator()
    const r = await coord.acquire(["/w/same.txt", "/w/same.txt", "/w/other.txt"])
    expect(r.ok && r.lease.keys).toEqual(["/w/other.txt", "/w/same.txt"])
    if (r.ok) r.lease.release()
  })

  it("release is idempotent", async () => {
    const coord = new WriteLeaseCoordinator()
    const r = await coord.acquire(["/w/x.txt"])
    if (r.ok) {
      r.lease.release()
      r.lease.release()
    }
    expect(coord.heldKeys()).toEqual([])
  })

  it("records acquired/released/timeout in the audit ledger", async () => {
    const scratch = await fs.mkdtemp(path.join(tmpdir(), "max-workspace-lease-"))
    try {
      const ledger = new AuditLedger(path.join(scratch, "audit.jsonl"))
      const coord = new WriteLeaseCoordinator({ audit: ledger })

      const first = await coord.acquire(["/w/f.txt"])
      expect(first.ok).toBe(true)
      const outcome = await coord.acquire(["/w/f.txt"], { timeoutMs: 50 })
      expect(outcome.ok).toBe(false)
      if (first.ok) first.lease.release()
      // release() is sync (finally-block safe) and its audit append is
      // fire-and-forget — give the IO a moment before reading the ledger.
      await new Promise((resolve) => setTimeout(resolve, 20))

      const actions = (await ledger.entries()).map((e) => e.action)
      expect(actions).toEqual([
        "write-lease.acquired",
        "write-lease.timeout",
        "write-lease.released",
      ])
    } finally {
      await fs.rm(scratch, { recursive: true, force: true })
    }
  })
})
