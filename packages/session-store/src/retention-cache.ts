// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Bounded-by-use retention cache (pi borrowing: `durable/src/session/
 * session.ts` documentRetentionMs, commit f44707e7f).
 *
 * Long-lived processes must not pin every projected session/timeline they
 * ever touched. Eviction judgement, per entry:
 *
 *   no ACTIVE OBSERVER (retain/release pairs) AND no read or write for
 *   `retentionMs`.
 *
 * Retention semantics (pi's documentRetentionMs):
 *   - default ten minutes
 *   - `0` drops an entry right after its use (suite-guard mode)
 *   - `Infinity` keeps entries for the life of the process
 *   - anything that is not a number >= 0 means the default
 *
 * Hot-path discipline (pi): a hot entry moves in the eviction order at
 * most once per granule (a tenth of the retention, capped at 1 s), so a
 * fan-out workload pays no reorder cost per touch. Sweeps walk from the
 * stale end and stop at the first entry still inside retention — O(evicted).
 * Cache bookkeeping never changes an operation's outcome: a throwing clock
 * counts as `Date.now()`, and sweeps swallow what they cannot drop.
 *
 * No background timers: a side-store library must not hold the event loop.
 * Eviction runs after every mutation (`set`/`release`/`retain`) and on
 * demand via {@link RetentionCache.sweep}.
 */

/** Default retention: ten minutes, as for kept contexts (pi). */
export const DEFAULT_RETENTION_MS = 600_000

/**
 * Suite guard (pi's setDefaultDocumentRetention): force the retention of
 * every cache that keeps the default — the behavioral test suite runs a
 * second time with `0`, proving nothing outlives its use in that mode.
 */
let defaultRetentionMs = DEFAULT_RETENTION_MS

export function setDefaultRetentionMs(ms: number): void {
  defaultRetentionMs = normalizeRetentionMs(ms)
}

/**
 * The retention as given, when it is a number of milliseconds (`0` and
 * `Infinity` included); otherwise the module default (ten minutes, or
 * whatever the suite guard set).
 */
export function normalizeRetentionMs(ms: number | undefined): number {
  return typeof ms === "number" && ms >= 0 ? ms : defaultRetentionMs
}

/** Hot entries remap at most once per granule; the granule caps at 1 s (pi). */
const MAX_GRANULE_MS = 1_000

/** One cached incarnation of a value plus its eviction bookkeeping. */
interface CacheEntry<V> {
  value: V
  /** Monotonic-ish timestamp (ms) of the last read or write. */
  lastUse: number
  /** Timestamp of the last ORDER move — hot entries remap at most once per granule. */
  lastMove: number
  /** Active observers (retains without a matching release) pin the entry. */
  observers: number
}

export interface RetentionCacheOptions {
  /** Retention window in ms. Default 600_000; 0 = evict right after use; Infinity = never. */
  retentionMs?: number
  /** Clock injection for tests. Must return ms. A throwing clock falls back to Date.now(). */
  now?: () => number
  /**
   * Hard capacity bound (entry count). Optional: retention alone bounds a
   * cache whose entries observe a bounded working set; give a capacity when
   * keys are unbounded (per-session ids). Oldest idle entries evict first.
   */
  capacity?: number
}

export interface RetentionCacheStats {
  size: number
  retained: number
  evicted: number
}

export class RetentionCache<K, V> {
  readonly retentionMs: number
  readonly capacity: number
  private readonly entries = new Map<K, CacheEntry<V>>()
  private readonly now: () => number
  private evictedCount = 0

  constructor(options: RetentionCacheOptions = {}) {
    this.retentionMs = normalizeRetentionMs(options.retentionMs)
    this.capacity =
      typeof options.capacity === "number" && options.capacity > 0
        ? options.capacity
        : Number.POSITIVE_INFINITY
    // Cache bookkeeping must never change the operation's outcome (pi):
    // a throwing clock counts as now().
    this.now = () => {
      try {
        return options.now ? options.now() : Date.now()
      } catch {
        return Date.now()
      }
    }
  }

  /** Eviction granule: a tenth of the retention, capped at 1 s (pi). */
  private get granuleMs(): number {
    if (this.retentionMs === Number.POSITIVE_INFINITY) return MAX_GRANULE_MS
    return Math.min(this.retentionMs / 10, MAX_GRANULE_MS)
  }

  /** Number of live entries. */
  get size(): number {
    return this.entries.size
  }

  /** Cumulative entries evicted by retention, capacity, or explicit sweep. */
  get evicted(): number {
    return this.evictedCount
  }

  /**
   * Read a cached entry. A hit refreshes its recency (bounded remap) and
   * returns the value; a miss returns undefined and caches nothing.
   */
  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    this.touch(key, entry)
    return entry.value
  }

  /** Whether a live entry exists (does NOT refresh recency). */
  has(key: K): boolean {
    return this.entries.has(key)
  }

  /** Insert or replace; refreshes recency and runs a sweep from the stale end. */
  set(key: K, value: V): void {
    const now = this.now()
    const existing = this.entries.get(key)
    if (existing !== undefined) {
      existing.value = value
      this.touch(key, existing, now)
    } else {
      this.entries.set(key, { value, lastUse: now, lastMove: now, observers: 0 })
    }
    this.enforceCapacity(key)
    this.sweep(now)
  }

  /**
   * Drop an entry right away (the retention=0 semantic, on demand).
   * Returns true when an entry was removed. A pinned entry is NOT dropped
   * by `delete` — an observer holds its incarnation (use force for tests).
   */
  delete(key: K, opts: { force?: boolean } = {}): boolean {
    const entry = this.entries.get(key)
    if (entry === undefined) return false
    if (entry.observers > 0 && !opts.force) return false
    this.entries.delete(key)
    this.evictedCount += 1
    return true
  }

  /**
   * Pin an entry against retention eviction (an active observer). Creates
   * nothing: pinning a missing key is a no-op. Returns the pinned value or
   * undefined. Every retain needs one release.
   */
  retain(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    entry.observers += 1
    this.touch(key, entry)
    return entry.value
  }

  /** Release a pin taken by {@link retain}. Over-releasing is ignored. */
  release(key: K): void {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    if (entry.observers > 0) entry.observers -= 1
    this.sweep()
  }

  /**
   * Evict every entry that has no active observer and was last used
   * before `now - retentionMs`. Walks from the stale end of the order and
   * stops at the first surviving entry: O(evicted), not O(size). With
   * retention 0, every unpinned entry drops right after use. Returns the
   * number of entries evicted by THIS call.
   *
   * Because hot entries remap only once per granule, an entry refreshed
   * in place within its granule can trail a fresher entry in the order;
   * the early break then leaves it for the next sweep, at most one
   * granule late — bounded staleness for bounded cost.
   */
  sweep(at?: number): number {
    if (this.retentionMs === Number.POSITIVE_INFINITY) return 0
    const now = at ?? this.now()
    let removed = 0
    for (const [key, entry] of this.entries) {
      if (entry.observers > 0) continue
      if (this.retentionMs !== Number.POSITIVE_INFINITY && now - entry.lastUse < this.retentionMs) {
        // Insertion order == lastMove order (we only remap via delete+set),
        // so the first fresh entry ends the sweep.
        break
      }
      this.entries.delete(key)
      this.evictedCount += 1
      removed += 1
    }
    return removed
  }

  /** Entries with at least one active observer (diagnostics/tests). */
  observerCount(key: K): number {
    return this.entries.get(key)?.observers ?? 0
  }

  /** Snapshot for tests/diagnostics. */
  stats(): RetentionCacheStats {
    let retained = 0
    for (const entry of this.entries.values()) if (entry.observers > 0) retained += 1
    return { size: this.entries.size, retained, evicted: this.evictedCount }
  }

  /**
   * Refresh recency, remapping the entry in the eviction order at most
   * once per granule (hot-path discipline from pi).
   */
  private touch(key: K, entry: CacheEntry<V>, at?: number): void {
    const now = at ?? this.now()
    entry.lastUse = now
    if (now - entry.lastMove >= this.granuleMs) {
      // Remap to the fresh end of the iteration order.
      this.entries.delete(key)
      this.entries.set(key, entry)
      entry.lastMove = now
    }
  }

  /**
   * Hard bound: over capacity, evict stale-end entries regardless of
   * retention (pinned entries are skipped — capacity is soft under pins;
   * `justSet` is never evicted by its own insert).
   */
  private enforceCapacity(justSet?: K): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.capacity) break
      if (entry.observers > 0 || key === justSet) continue
      this.entries.delete(key)
      this.evictedCount += 1
    }
  }
}
