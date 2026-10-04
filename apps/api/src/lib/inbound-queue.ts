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
