// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Degraded state for an unwritable cron/task store (hermes borrowing:
 * `cron/store_health.py`, commit 91fc7badaf and its siblings).
 *
 * A full disk, a read-only mount, or a lost Redis fails EVERY store write
 * on EVERY tick. Instead of one error per failing call site, each store
 * directory gets ONE in-memory record:
 *
 *   - the first failed write sets `degraded`; later failures update it;
 *   - the first write that lands clears it (the just-ended outage is kept
 *     in `recovered` until a due scan's save lands — the save that ends an
 *     outage often precedes the scan that fires what the outage skipped);
 *   - while degraded, the tick skips the advance/claim work that can only
 *     fail, and re-probes the store at most once a minute;
 *   - every run skipped inside the outage window is recorded ONCE (set
 *     keyed by job id + scheduled instant), so the missed count is per
 *     outage, not per tick.
 *
 * Pure TypeScript, no I/O: the probe is injected, clocks are injected.
 * Transition listeners let a gateway surface "unwritable"/"recovered"
 * once per transition; a throwing listener must never break the tick.
 */

/** Re-probe throttle while degraded (hermes: PROBE_INTERVAL_SECONDS). */
export const PROBE_INTERVAL_MS = 60_000

/** The write sites whose failure means "dispatch cannot proceed". */
const DISPATCH_SITES = new Set(["advance", "claim"])

/** A run identity: job id + the exact scheduled instant it was due. */
export interface DueRun {
  id: string
  /** Scheduled instant (epoch ms) — pairs with the id for set-dedup. */
  scheduledAtMs: number
}

/** One store's outage record (hermes StoreDegraded). */
export interface StoreDegradedRecord {
  /** Resolved store key (path / Redis DSN / logical name). */
  store: string
  /** Epoch ms of the FIRST failed write of this outage. */
  since: number
  /** Description of the most recent failure. */
  error: string
  /** Epoch ms of the first write that landed again (recovered records only). */
  recoveredAt?: number
  /** Distinct write sites that failed during the outage. */
  sites: Set<string>
  /** Distinct (job, scheduled instant) pairs skipped inside the outage. */
  skipped: Set<string>
  /**
   * Monotonic ms of the last failed dispatch write or re-probe. Undefined
   * until dispatch was tried — a record entered from load/scan has not
   * tried dispatch yet, so the first dispatch attempt goes through.
   */
  lastProbe?: number
}

/** Distinct-run count of a record (each missed occurrence counted once per outage). */
export function skippedRunCount(record: StoreDegradedRecord): number {
  return record.skipped.size
}

/** `jobId@scheduledAt` — the set key that makes missed counts idempotent. */
function runKey(run: DueRun): string {
  return `${run.id}@${run.scheduledAtMs}`
}

export type StoreHealthEvent = "unwritable" | "recovered"

/** Listener for transitions; `fn(event, record)`. */
export type StoreHealthListener = (event: StoreHealthEvent, record: StoreDegradedRecord) => void

export interface StoreHealthClocks {
  /** Wall clock in epoch ms (default Date.now). */
  now?: () => number
  /** Monotonic clock in ms for probe throttling (default performance.now-ish). */
  monotonic?: () => number
}

function defaultMonotonic(): number {
  return Number(process.hrtime.bigint() / 1_000_000n)
}

export class StoreHealthRegistry {
  private readonly degraded = new Map<string, StoreDegradedRecord>()
  private readonly recovered = new Map<string, StoreDegradedRecord>()
  private readonly clocks: Required<StoreHealthClocks>
  private listener: StoreHealthListener | null = null

  constructor(clocks: StoreHealthClocks = {}) {
    this.clocks = {
      now: clocks.now ?? (() => Date.now()),
      monotonic: clocks.monotonic ?? defaultMonotonic,
    }
  }

  /** Install the single transition listener (a gateway, a notifier). */
  setTransitionListener(fn: StoreHealthListener | null): void {
    this.listener = fn
  }

  private notify(event: StoreHealthEvent, record: StoreDegradedRecord): void {
    // A notice must never break the tick that reported the transition.
    try {
      this.listener?.(event, record)
    } catch {
      // swallowed by contract
    }
  }

  /**
   * Record a failed write to `store` at `site`. The first failure enters
   * the degraded state (one warning via the listener); later failures
   * update the record silently. `skippedRuns` are the due runs the caller
   * is NOT dispatching because the write failed — recorded once each.
   * Returns true when this call ENTERED the degraded state.
   */
  noteUnwritable(
    store: string,
    error: string,
    site: string,
    skippedRuns: readonly DueRun[] = [],
  ): boolean {
    let record = this.degraded.get(store)
    const entered = record === undefined
    if (entered) {
      // An ended outage not yet seen by a saved scan carries its start.
      const ended = this.recovered.get(store)
      const since = ended !== undefined ? ended.since : this.clocks.now()
      if (ended !== undefined) this.recovered.delete(store)
      record = {
        store,
        since,
        error,
        sites: new Set(),
        skipped: new Set(),
      }
      this.degraded.set(store, record)
    }
    record!.sites.add(site)
    // A failed dispatch write throttles the next attempt; once dispatch has
    // been tried, a failed scan save is this tick's write attempt too.
    if (DISPATCH_SITES.has(site) || record!.lastProbe !== undefined) {
      record!.lastProbe = this.clocks.monotonic()
    }
    record!.error = error
    for (const run of skippedRuns) record!.skipped.add(runKey(run))
    if (entered) this.notify("unwritable", record!)
    return entered
  }

  /**
   * A write to `store` landed: clear the degraded state, keep the record
   * as the store's just-ended outage (for {@link outageCovers} and the
   * `since` carry-over), and notify once. Returns the archived record.
   */
  noteWritable(store: string): StoreDegradedRecord | null {
    const record = this.degraded.get(store)
    if (record === undefined) return null
    this.degraded.delete(store)
    record.recoveredAt = this.clocks.now()
    this.recovered.set(store, record)
    this.notify("recovered", record)
    return record
  }

  /** The live degraded record for a store, if any. */
  degradedRecord(store: string): StoreDegradedRecord | null {
    return this.degraded.get(store) ?? null
  }

  /** The just-ended outage for a store, if any. */
  recoveredRecord(store: string): StoreDegradedRecord | null {
    return this.recovered.get(store) ?? null
  }

  /**
   * Whether a run due at `dueAtMs` fell inside the store's current or
   * just-ended outage (grace covers the save-before-scan boundary).
   */
  outageCovers(store: string, dueAtMs: number, graceMs: number): boolean {
    for (const record of [this.degraded.get(store), this.recovered.get(store)]) {
      if (record === undefined) continue
      const startedBeforeDueWithGrace = record.since <= dueAtMs + graceMs
      const endedAfterDue = record.recoveredAt === undefined || dueAtMs <= record.recoveredAt
      if (startedBeforeDueWithGrace && endedAfterDue) return true
    }
    return false
  }

  /**
   * Whether this tick must skip advance/claim for `dueRuns`: the store is
   * known-unwritable and the throttled re-probe has not seen it accept a
   * write. Skipped runs are recorded once each; when the probe passes, the
   * dispatch's own save confirms recovery (or re-degrades).
   *
   * `probe` performs the actual I/O (create a temp file, PING, …) OUTSIDE
   * the registry's bookkeeping; undefined result means the probe passed.
   */
  dispatchBlocked(
    store: string,
    dueRuns: readonly DueRun[],
    probe?: () => string | undefined,
  ): boolean {
    const record = this.degraded.get(store)
    // Entered by load/scan with no dispatch tried yet: let dispatch try.
    if (record === undefined || record.lastProbe === undefined) return false
    const now = this.clocks.monotonic()
    const throttled = now - record.lastProbe < PROBE_INTERVAL_MS
    let error: string | undefined
    if (!throttled && probe !== undefined) error = probe()
    if (!throttled) record.lastProbe = now
    if (error !== undefined) record.error = error
    const blocked = throttled || error !== undefined
    if (blocked) {
      for (const run of dueRuns) record.skipped.add(runKey(run))
    }
    return blocked
  }

  /**
   * A due scan's save landed after the outage ended: normal grace applies
   * again (the recovered record stops covering new dues).
   */
  endRecoveryWindow(store: string): void {
    this.recovered.delete(store)
  }

  /**
   * Drop state for stores this process no longer ticks, so a departed
   * profile cannot hold gauges at unwritable=0 forever.
   */
  forgetStores(stores: readonly string[]): void {
    const set = new Set(stores)
    for (const map of [this.degraded, this.recovered]) {
      for (const store of [...map.keys()]) {
        if (set.has(store)) map.delete(store)
      }
    }
  }
}
