// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Append-only audit ledger with a per-entry hash chain (openclaw
 * file-transfer audit borrowing, hardened with tamper evidence).
 *
 * Every record carries a monotonically increasing `seq`, an RFC 3339
 * timestamp, the hash of the previous record, and its own hash:
 * `sha256(canonicalJson({ seq, at, action, payload, prevHash }))`. Because
 * each hash covers the previous one, editing or removing any historical
 * line invalidates the whole suffix — `verify()` detects it and reports
 * the first broken position.
 *
 * Storage is one JSONL file, appended via a single `write` on an O_APPEND
 * handle (atomic for line-sized records on POSIX) serialized through an
 * in-process promise chain, so concurrent `append` callers can never
 * interleave partial lines or fork the sequence.
 */

import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"

/** JSON values storable as ledger payloads (must survive round-trips). */
export type LedgerPayload =
  string | number | boolean | null | LedgerPayload[] | { [k: string]: LedgerPayload }

export interface AuditEntry {
  /** 1-based position in the chain. */
  readonly seq: number
  /** RFC 3339 timestamp of the append. */
  readonly at: string
  /** Dotted action name, e.g. "approval.released", "shadow.commit". */
  readonly action: string
  /** Action-specific structured details (never secrets in plaintext). */
  readonly payload: LedgerPayload
  /** Hash of the previous entry; the all-zero hash for seq 1. */
  readonly prevHash: string
  /** sha256 over the canonical form of everything above. */
  readonly hash: string
}

export interface AuditVerifyResult {
  readonly ok: boolean
  readonly entries: number
  /** seq of the first entry whose linkage/hash is broken (ok=false only). */
  readonly brokenAt?: number
  readonly error?: string
}

/** 64 hex zeros — the chain anchor for the very first entry. */
export const GENESIS_HASH = "0".repeat(64)

/**
 * Deterministic JSON: object keys sorted recursively so two structurally
 * equal payloads hash identically regardless of insertion order.
 */
export function canonicalJson(value: LedgerPayload): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k]!)}`).join(",")}}`
}

function hashEntryFields(fields: {
  seq: number
  at: string
  action: string
  payload: LedgerPayload
  prevHash: string
}): string {
  // Pick exactly the hashed fields — a blind spread would leak the entry's
  // own `hash` property into the canonical form and make append-time and
  // verify-time hashes diverge.
  const canonical = canonicalJson({
    seq: fields.seq,
    at: fields.at,
    action: fields.action,
    payload: fields.payload,
    prevHash: fields.prevHash,
  })
  return createHash("sha256").update(canonical).digest("hex")
}

/** Re-verify a parsed sequence of entries; shared by verify() and tests. */
export function verifyChain(entries: AuditEntry[]): AuditVerifyResult {
  let prevHash = GENESIS_HASH
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.seq !== i + 1) {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: entry.seq,
        error: `sequence break at index ${i}`,
      }
    }
    if (entry.prevHash !== prevHash) {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: entry.seq,
        error: `prevHash mismatch at seq ${entry.seq}`,
      }
    }
    const expected = hashEntryFields(entry)
    if (entry.hash !== expected) {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: entry.seq,
        error: `hash mismatch at seq ${entry.seq}`,
      }
    }
    prevHash = entry.hash
  }
  return { ok: true, entries: entries.length }
}

function parseEntryLine(line: string): AuditEntry | undefined {
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== "object" || parsed === null) return undefined
    const e = parsed as Record<string, unknown>
    if (
      typeof e.seq !== "number" ||
      typeof e.at !== "string" ||
      typeof e.action !== "string" ||
      typeof e.prevHash !== "string" ||
      typeof e.hash !== "string"
    ) {
      return undefined
    }
    return {
      seq: e.seq,
      at: e.at,
      action: e.action,
      payload: (e.payload ?? null) as LedgerPayload,
      prevHash: e.prevHash,
      hash: e.hash,
    }
  } catch {
    return undefined
  }
}

interface LedgerTail {
  readonly seq: number
  readonly hash: string
}

export class AuditLedger {
  private readonly filePath: string
  /** Cached tail of the chain (seq + hash of the last entry on disk). */
  private tailCache: LedgerTail | null = null
  /** Serializes appends so lines never interleave and seq never forks. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  /**
   * Read the whole file and return the tail (seq + hash of the last entry).
   * A missing or empty file starts a fresh chain; malformed lines make the
   * ledger fail closed on load — appending after a corrupt suffix would
   * silently legitimize it.
   */
  private async loadTail(): Promise<LedgerTail> {
    let raw: string
    try {
      raw = await fs.readFile(this.filePath, "utf-8")
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { seq: 0, hash: GENESIS_HASH }
      }
      throw err
    }
    const lines = raw.split("\n").filter((l) => l.trim().length > 0)
    if (lines.length === 0) return { seq: 0, hash: GENESIS_HASH }
    const parsed = lines.map(parseEntryLine)
    if (parsed.some((e) => e === undefined)) {
      throw new Error(`audit ledger ${this.filePath} contains malformed lines; refusing to append`)
    }
    const last = parsed[parsed.length - 1]!
    return { seq: last.seq, hash: last.hash }
  }

  async append(action: string, payload: LedgerPayload = null): Promise<AuditEntry> {
    const result = this.chain.then(() => this.doAppend(action, payload))
    // Keep the chain alive regardless of failure; doAppend invalidates the
    // cached tail on error so the next append re-reads the file instead of
    // building on a possibly partial write.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async doAppend(action: string, payload: LedgerPayload): Promise<AuditEntry> {
    const tail = this.tailCache ?? (await this.loadTail())
    const entry: AuditEntry = {
      seq: tail.seq + 1,
      at: new Date().toISOString(),
      action,
      payload,
      prevHash: tail.hash,
      hash: "",
    }
    const withHash: AuditEntry = { ...entry, hash: hashEntryFields(entry) }
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const handle = await fs.open(this.filePath, "a")
    try {
      // Single write on an O_APPEND handle: POSIX appends atomically, so a
      // crash leaves either the whole line or none of it.
      await handle.write(`${JSON.stringify(withHash)}\n`)
    } catch (err) {
      this.tailCache = null
      throw err
    } finally {
      await handle.close()
    }
    this.tailCache = { seq: withHash.seq, hash: withHash.hash }
    return withHash
  }

  /** All entries, oldest first. */
  async entries(): Promise<AuditEntry[]> {
    let raw: string
    try {
      raw = await fs.readFile(this.filePath, "utf-8")
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
      throw err
    }
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map(parseEntryLine)
      .filter((e): e is AuditEntry => e !== undefined)
  }

  /** Full chain integrity check: seq continuity, hash linkage, re-hashing. */
  async verify(): Promise<AuditVerifyResult> {
    return verifyChain(await this.entries())
  }
}
