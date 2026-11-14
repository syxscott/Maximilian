// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Inbound admission queue, three tiers (openclaw channel-ingress borrowing,
 * HTTP form): every admitted request takes one of
 *
 *   immediate    — an in-flight slot was free, request proceeds now
 *   queued       — all slots busy; bounded wait queue, FIFO promotion
 *   dead-letter  — queue full; request is rejected with a structured 503
 *                  and counted, never silently dropped
 *
 * The queue itself is a pure model (no Hono types) so capacity, overflow
 * policy and counters are unit-testable; the middleware in
 * middleware/inbound-queue.ts only wires admit/release around `next()`.
 */

export interface InboundCounters {
  /** Requests admitted straight into a slot. */
  readonly immediate: number
  /** Requests that waited in the queue (may still be promoted later). */
  readonly queued: number
  /** Requests rejected because the queue was full. */
  readonly deadLetter: number
}

export interface InboundSnapshot extends InboundCounters {
  readonly inFlight: number
  readonly queuedDepth: number
  readonly maxInFlight: number
  readonly maxQueued: number
}

export type InboundAdmitVerdict =
  | { tier: "immediate" }
  | {
      tier: "queued"
      /** Resolves when the request is promoted to a slot. */ wait: Promise<"immediate">
    }
  | { tier: "dead-letter" }

/** Thrown by acquire() on overflow; carries the snapshot for the 503 body. */
export class InboundOverflowError extends Error {
  readonly snapshot: InboundSnapshot
  constructor(snapshot: InboundSnapshot) {
    super(
      `inbound queue overflow: ${snapshot.queuedDepth}/${snapshot.maxQueued} queued, ${snapshot.inFlight}/${snapshot.maxInFlight} in flight`,
    )
    this.name = "InboundOverflowError"
    this.snapshot = snapshot
  }
}

export interface InboundGateOptions {
  /** Immediate-tier slot count. */
  maxInFlight: number
  /** Bound of the waiting queue; overflow becomes dead-letter. */
  maxQueued: number
}

interface Waiter {
  resolve: (tier: "immediate") => void
}

export class InboundGate {
  private readonly maxInFlight: number
  private readonly maxQueued: number
  private inFlight = 0
  private readonly queue: Waiter[] = []
  private readonly counts: { immediate: number; queued: number; deadLetter: number } = {
    immediate: 0,
    queued: 0,
    deadLetter: 0,
  }

  constructor(opts: InboundGateOptions) {
    if (opts.maxInFlight < 1 || opts.maxQueued < 1) {
      throw new Error("InboundGate requires maxInFlight >= 1 and maxQueued >= 1")
    }
    this.maxInFlight = opts.maxInFlight
    this.maxQueued = opts.maxQueued
  }

  /** Classify one request into its admission tier without blocking. */
  admit(): InboundAdmitVerdict {
    if (this.inFlight < this.maxInFlight) {
      this.inFlight += 1
      this.counts.immediate += 1
      return { tier: "immediate" }
    }
    if (this.queue.length < this.maxQueued) {
      this.counts.queued += 1
      let resolveWait!: (tier: "immediate") => void
      const wait = new Promise<"immediate">((resolve) => {
        resolveWait = resolve
      })
      this.queue.push({ resolve: resolveWait })
      return { tier: "queued", wait }
    }
    this.counts.deadLetter += 1
    return { tier: "dead-letter" }
  }

  /**
   * Admit and wait until the request occupies a slot. Rejects with
   * InboundOverflowError on dead-letter.
   */
  async acquire(): Promise<"immediate" | "queued"> {
    const verdict = this.admit()
    if (verdict.tier === "dead-letter") throw new InboundOverflowError(this.snapshot())
    if (verdict.tier === "queued") await verdict.wait
    return verdict.tier
  }

  /**
   * Give back a slot and promote the next queued request, if any.
   * Safe to call even when nothing is in flight (clamps at zero).
   */
  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1)
    const next = this.queue.shift()
    if (next !== undefined) {
      this.inFlight += 1
      next.resolve("immediate")
    }
  }

  snapshot(): InboundSnapshot {
    return {
      ...this.counts,
      inFlight: this.inFlight,
      queuedDepth: this.queue.length,
      maxInFlight: this.maxInFlight,
      maxQueued: this.maxQueued,
    }
  }
}

// ── Idempotency receipts (OpenAgentCore wire-semantics.md borrowing) ────────

/**
 * One recorded attempt under an `Idempotency-Key`. The receipt stores the
 * hash of the PARSED request body (not the raw bytes — key order and
 * whitespace differences must not create phantom conflicts) plus the
 * original response, so a retry with the same key and body replays the
 * original result without re-executing.
 */
export interface IdempotencyReceipt {
  /** SHA-256 over the canonicalized parsed body (raw text fallback). */
  readonly bodyHash: string
  /** Status of the original (stored) response. */
  readonly status: number
  /** JSON body of the original response (undefined for empty bodies). */
  readonly body: unknown
  readonly recordedAt: number
}

export interface IdempotencyReceiptStoreOptions {
  /** Bounded retention: oldest receipts are evicted beyond this. Default 5_000. */
  maxEntries?: number
  /** Receipts older than this are pruned on write. Default 24h. */
  ttlMs?: number
  /** Wall clock (injectable for tests). Default Date.now. */
  now?: () => number
}

/**
 * Bounded in-memory receipt store backing the idempotency-key middleware.
 * Insertion-ordered; prune (expired) and evict (overflow) happen on
 * record() so the store never grows without bound, and stale receipts can
 * never answer a retry.
 */
export class IdempotencyReceiptStore {
  private readonly receipts = new Map<string, IdempotencyReceipt>()
  private readonly maxEntries: number
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(opts?: IdempotencyReceiptStoreOptions) {
    this.maxEntries = Math.max(1, opts?.maxEntries ?? 5_000)
    this.ttlMs = Math.max(1, opts?.ttlMs ?? 24 * 60 * 60 * 1_000)
    this.now = opts?.now ?? Date.now
  }

  /** Current live receipt count (expired entries are not counted). */
  get size(): number {
    const nowMs = this.now()
    let n = 0
    for (const receipt of this.receipts.values()) {
      if (nowMs - receipt.recordedAt <= this.ttlMs) n += 1
    }
    return n
  }

  /**
   * Record (or overwrite) the receipt for one scoped key. Overwriting is
   * deliberate: the middleware only records after a fresh execution, and
   * a conflict/replay path never records.
   */
  record(key: string, receipt: Omit<IdempotencyReceipt, "recordedAt">): void {
    this.prune()
    // Map preserves insertion order — deleting first makes this entry the
    // newest for eviction purposes.
    this.receipts.delete(key)
    this.receipts.set(key, { ...receipt, recordedAt: this.now() })
    while (this.receipts.size > this.maxEntries) {
      const oldest = this.receipts.keys().next().value
      if (oldest === undefined) break
      this.receipts.delete(oldest)
    }
  }

  /** The receipt for `key`, or undefined when absent or expired. */
  get(key: string): IdempotencyReceipt | undefined {
    const receipt = this.receipts.get(key)
    if (!receipt) return undefined
    if (this.now() - receipt.recordedAt > this.ttlMs) return undefined
    return receipt
  }

  /** Drop expired entries (called on record; safe to call manually). */
  private prune(): void {
    const nowMs = this.now()
    for (const [key, receipt] of this.receipts) {
      if (nowMs - receipt.recordedAt > this.ttlMs) this.receipts.delete(key)
    }
  }
}

/** Keys longer than this are rejected with 400 (wire-semantics.md). */
export const IDEMPOTENCY_KEY_MAX_BYTES = 256

/**
 * Canonical JSON: object keys sorted recursively, arrays in order. The
 * hash input for receipts, so semantically identical bodies hash equal
 * regardless of serialization whitespace or key order.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map((v) => canonicalizeJson(v)).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`).join(",")}}`
}

/**
 * Hash a request body for receipt comparison. The receipt stores the hash
 * of the PARSED body (wire contract: same request = same semantic body);
 * bodies that are not valid JSON fall back to a hash of the raw text.
 */
export async function hashRequestBody(text: string): Promise<string> {
  let canonical = text
  try {
    canonical = canonicalizeJson(JSON.parse(text))
  } catch {
    // Not JSON — hash the raw bytes.
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
