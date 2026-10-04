// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Write safety coordinator: per-key write leases (openclaw
 * memory-workspace-lock borrowing, in-process form).
 *
 * Conflicting writes are serialized by handing out a lease per normalized
 * lock key: same key = mutually exclusive, different keys = parallel.
 * Waiters are FIFO per key with a bounded wait; a timeout resolves to a
 * structured failure (never a thrown bare Error) so callers can branch on
 * the outcome.
 *
 * Deadlock prevention: a caller that needs several keys acquires them all
 * in one call, in sorted (total) order — two callers wanting {a,b} and
 * {b,a} can never hold one key each while waiting on the other.
 */

import path from "node:path"
import type { AuditLedger } from "./audit-ledger.js"

/** Normalize an arbitrary write target (path) to a stable lock key. */
export function normalizeLockKey(target: string): string {
  const resolved = path.resolve(target)
  // Strip a trailing separator (except for the filesystem root) so "/a/b/"
  // and "/a/b" contend on the same key.
  const trimmed = resolved.length > 1 ? resolved.replace(/[\\/]+$/, "") : resolved
  return trimmed
}

export interface WriteLease {
  /** Normalized keys held by this lease, in acquisition (sorted) order. */
  readonly keys: string[]
  readonly id: string
  /** Release all keys. Idempotent; safe to call from a finally block. */
  release(): void
}

export type WriteLeaseOutcome =
  | { readonly ok: true; readonly lease: WriteLease }
  | {
      readonly ok: false
      readonly error: "lease-timeout"
      /** The key whose wait exceeded the timeout. */
      readonly key: string
      readonly waitedMs: number
      /** Lock key of the current holder, when observable. */
      readonly holder?: string
    }

export interface WriteLeaseOptions {
  /** Max wait for any single key before a structured timeout. Default 10s. */
  readonly timeoutMs?: number
  /** Audit sink — acquisitions and releases are recorded when set. */
  readonly audit?: AuditLedger
  readonly now?: () => number
}

interface Waiter {
  readonly holder: string
  grant: (holder: string) => void
  timer?: ReturnType<typeof setTimeout>
}

interface KeyState {
  owner: string | null
  waiters: Waiter[]
}

let leaseCounter = 0

export class WriteLeaseCoordinator {
  private readonly keys = new Map<string, KeyState>()
  private readonly defaultTimeoutMs: number
  private readonly audit?: AuditLedger
  private readonly now: () => number

  constructor(opts: WriteLeaseOptions = {}) {
    this.defaultTimeoutMs = opts.timeoutMs ?? 10_000
    this.audit = opts.audit
    this.now = opts.now ?? (() => Date.now())
  }

  /**
   * Acquire leases on all keys (sorted, all-or-nothing). Resolves with a
   * structured timeout failure instead of throwing when a key cannot be
   * obtained in time; already-acquired keys are released first.
   */
  async acquire(
    targets: readonly string[],
    opts: WriteLeaseOptions = {},
  ): Promise<WriteLeaseOutcome> {
    const keys = [...new Set(targets.map(normalizeLockKey))].sort()
    if (keys.length === 0) {
      return { ok: true, lease: { keys: [], id: this.nextLeaseId(), release: () => {} } }
    }
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs
    const audit = opts.audit ?? this.audit
    const leaseId = this.nextLeaseId()

    const acquired: string[] = []
    const releaseAcquired = (): void => {
      for (const key of acquired.reverse()) this.releaseKey(key, leaseId)
      acquired.length = 0
    }

    for (const key of keys) {
      const granted = await this.acquireKey(key, leaseId, timeoutMs)
      if (granted === true) {
        acquired.push(key)
        continue
      }
      // Structured timeout: give back what we hold so a failed multi-key
      // acquisition never leaves partial ownership behind.
      releaseAcquired()
      if (audit) {
        await audit.append("write-lease.timeout", {
          key: granted.key,
          leaseId,
          waitedMs: granted.waitedMs,
        })
      }
      return {
        ok: false,
        error: "lease-timeout",
        key: granted.key,
        waitedMs: granted.waitedMs,
        ...(granted.holder !== undefined ? { holder: granted.holder } : {}),
      }
    }

    if (audit) {
      await audit.append("write-lease.acquired", { keys, leaseId })
    }
    const lease: WriteLease = {
      keys,
      id: leaseId,
      release: () => {
        if (acquired.length === 0) return
        releaseAcquired()
        void audit?.append("write-lease.released", { keys, leaseId })
      },
    }
    return { ok: true, lease }
  }

  /** Acquire, run `fn`, release in all cases. */
  async withLeases<T>(
    targets: readonly string[],
    fn: () => Promise<T>,
    opts: WriteLeaseOptions = {},
  ): Promise<T | Extract<WriteLeaseOutcome, { ok: false }>> {
    const outcome = await this.acquire(targets, opts)
    if (!outcome.ok) return outcome
    try {
      return await fn()
    } finally {
      outcome.lease.release()
    }
  }

  /** Keys currently held (diagnostics / tests). */
  heldKeys(): string[] {
    return [...this.keys.entries()].filter(([, s]) => s.owner !== null).map(([k]) => k)
  }

  // ── internals ───────────────────────────────────────────────────────────

  private nextLeaseId(): string {
    leaseCounter += 1
    return `lease_${leaseCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Grant `leaseId` the key, or wait FIFO up to timeoutMs.
   * Resolves `true` when granted, or the structured timeout fields.
   */
  private acquireKey(
    key: string,
    leaseId: string,
    timeoutMs: number,
  ): Promise<true | { key: string; waitedMs: number; holder?: string }> {
    let state = this.keys.get(key)
    if (state === undefined) {
      state = { owner: null, waiters: [] }
      this.keys.set(key, state)
    }
    if (state.owner === null) {
      state.owner = leaseId
      return Promise.resolve(true)
    }
    const startedAt = this.now()
    const holder = state.owner
    return new Promise((resolve) => {
      const waiter: Waiter = {
        holder: leaseId,
        grant: (grantedTo) => {
          if (waiter.timer !== undefined) clearTimeout(waiter.timer)
          if (grantedTo === leaseId) resolve(true)
        },
      }
      waiter.timer = setTimeout(() => {
        const idx = state?.waiters.indexOf(waiter) ?? -1
        if (idx >= 0) state?.waiters.splice(idx, 1)
        resolve({
          key,
          waitedMs: this.now() - startedAt,
          // Report the holder we observed at enqueue time; it may have
          // changed since, but it is always a diagnostic hint, never a
          // security decision.
          holder,
        })
      }, timeoutMs)
      waiter.timer.unref?.()
      state?.waiters.push(waiter)
    })
  }

  /** Release one key owned by leaseId and grant the next waiter, if any. */
  private releaseKey(key: string, leaseId: string): void {
    const state = this.keys.get(key)
    if (state === undefined || state.owner !== leaseId) return
    const next = state.waiters.shift()
    if (next !== undefined) {
      state.owner = next.holder
      next.grant(next.holder)
      return
    }
    state.owner = null
    // Drop empty key states so the map does not grow without bound.
    if (state.waiters.length === 0) this.keys.delete(key)
  }
}
