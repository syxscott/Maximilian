// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the append-only audit ledger:
 *   - canonicalJson is deterministic regardless of key insertion order.
 *   - appends form a verifiable seq + prevHash + hash chain.
 *   - concurrent appends serialize (no forked seq, no interleaved lines).
 *   - tampering with any historical line is detected by verify().
 *   - a fresh AuditLedger instance resumes the seq from disk.
 *   - a corrupt (malformed) file fails closed on append.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { canonicalJson, verifyChain, AuditLedger } from "../src/audit-ledger.js"

let scratchDir: string
let ledgerPath: string

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(tmpdir(), "max-workspace-audit-"))
  ledgerPath = path.join(scratchDir, "audit", "ledger.jsonl")
})

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true })
})

describe("canonicalJson", () => {
  it("is order-independent for objects", () => {
    const a = canonicalJson({ b: 1, a: { y: 2, x: [3, { k: "v" }] } })
    const b = canonicalJson({ a: { x: [3, { k: "v" }], y: 2 }, b: 1 })
    expect(a).toBe(b)
  })

  it("keeps arrays in order", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })
})

describe("AuditLedger", () => {
  it("appends entries with a verifiable hash chain", async () => {
    const ledger = new AuditLedger(ledgerPath)
    await ledger.append("shadow.commit", { id: "abc" })
    await ledger.append("shadow.rollback", { id: "abc" })
    const entries = await ledger.entries()
    expect(entries).toHaveLength(2)
    expect(entries[0]!.seq).toBe(1)
    expect(entries[0]!.prevHash).toBe("0".repeat(64))
    expect(entries[1]!.prevHash).toBe(entries[0]!.hash)
    expect((await ledger.verify()).ok).toBe(true)
  })

  it("serializes concurrent appends into one ordered chain", async () => {
    const ledger = new AuditLedger(ledgerPath)
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => ledger.append("write-lease.acquired", { i })),
    )
    const entries = await ledger.entries()
    expect(entries.map((e) => e.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
    const result = await ledger.verify()
    expect(result.ok).toBe(true)
  }, 15_000)

  it("detects tampering with a historical payload", async () => {
    const ledger = new AuditLedger(ledgerPath)
    await ledger.append("approval.released", { requestId: "r1" })
    await ledger.append("approval.released", { requestId: "r2" })

    const raw = await fs.readFile(ledgerPath, "utf-8")
    const forged = raw.replace("r1", "EVIL")
    expect(forged).not.toBe(raw)
    await fs.writeFile(ledgerPath, forged, "utf-8")

    const result = await verifyChain(await ledger.entries())
    expect(result.ok).toBe(false)
    expect(result.brokenAt).toBe(1)
  })

  it("detects a deleted middle entry", async () => {
    const ledger = new AuditLedger(ledgerPath)
    await ledger.append("a", null)
    await ledger.append("b", null)
    await ledger.append("c", null)

    const lines = (await fs.readFile(ledgerPath, "utf-8")).trim().split("\n")
    await fs.writeFile(ledgerPath, lines.filter((_, i) => i !== 1).join("\n") + "\n", "utf-8")
    const result = await verifyChain(await ledger.entries())
    expect(result.ok).toBe(false)
  })

  it("resumes the sequence from disk in a new instance", async () => {
    const first = new AuditLedger(ledgerPath)
    const entry = await first.append("shadow.commit", { id: "x" })
    expect(entry.seq).toBe(1)

    const second = new AuditLedger(ledgerPath)
    const next = await second.append("shadow.commit", { id: "y" })
    expect(next.seq).toBe(2)
    expect(next.prevHash).toBe(entry.hash)
    expect((await second.verify()).ok).toBe(true)
  })

  it("fails closed when appending to a file with malformed lines", async () => {
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true })
    await fs.writeFile(ledgerPath, "not json at all\n", "utf-8")
    const ledger = new AuditLedger(ledgerPath)
    await expect(ledger.append("a", null)).rejects.toThrow(/malformed/)
    // Nothing was appended.
    expect((await fs.readFile(ledgerPath, "utf-8")).trim()).toBe("not json at all")
  })

  it("empty ledger file verifies as ok with zero entries", async () => {
    const ledger = new AuditLedger(ledgerPath)
    expect(await ledger.entries()).toEqual([])
    expect(await ledger.verify()).toEqual({ ok: true, entries: 0 })
  })
})
