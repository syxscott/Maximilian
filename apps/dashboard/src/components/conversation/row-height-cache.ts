// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Row-height persistence + learning estimator for the virtual turn
 * window — pure data structures, no DOM/React dependency.
 *
 * Two layers (borrowing: ZCode v4 timelineRowHeightCache + pi
 * row-estimate):
 *
 * 1. `TurnRowHeightCache` — REAL measured heights keyed by the turn's
 *    stable id (turnId). The virtualizer's own measurement cache resets
 *    whenever its row list is rebuilt (stream recompile, StrictMode
 *    remount, mode switches); this cache lives OUTSIDE it on the
 *    timeline, so a row that unmounts and remounts keeps its measurement
 *    and the scrollbar does not jump back to estimates. Bounded LRU
 *    (oldest-written evicted — write order ≈ stream order), optionally
 *    backed by an injected storage (localStorage-shaped) for
 *    persistence across sessions; memory-only by default.
 *
 * 2. `RowEstimator` — for rows never measured yet, a least-squares line
 *    of height over text-length/width, learned per row kind from the
 *    measurements that DID land (pi row-estimate: a one-line and a
 *    fifty-line answer differ more than any average could cover). A
 *    row's FIRST estimate is pinned: the same row at the same width
 *    never changes its estimate, because a moving estimate below the
 *    reader shifts what they are looking at.
 *
 * `resolveTurnHeight` composes the three levels the window uses:
 * measured (cache hit) → learned estimate (pinned) → static model
 * estimate (the model layer's per-unit arithmetic).
 */

import type { ConversationUnit, TurnModel } from "./model"
import { turnHeight } from "./model"

/** Unmeasured-row fallback is the caller's static estimate; kept for the raw cache API. */
export const DEFAULT_ROW_HEIGHT_FALLBACK_PX = 72

/** Cache bound: ultra-long streams stay bounded; oldest-written rows evict first. */
export const MAX_ROW_HEIGHT_CACHE_ENTRIES = 4000

/** Pinned first-estimates share the same bound (one entry per row at most). */
export const MAX_ROW_ESTIMATOR_PINNED_ENTRIES = 4000

/**
 * Storage seam — a localStorage-shaped KV. Inject `window.localStorage`
 * (guarded) for cross-session persistence; omit for memory-only.
 */
export interface RowHeightStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Wrap a storage that may throw (private mode, quota) into a silent one. */
export function safeRowHeightStore(
  storage: RowHeightStore | null | undefined,
): RowHeightStore | null {
  if (!storage) return null
  return {
    getItem(key) {
      try {
        return storage.getItem(key)
      } catch {
        return null
      }
    },
    setItem(key, value) {
      try {
        storage.setItem(key, value)
      } catch {
        // Quota / private mode — persistence is best-effort only.
      }
    },
    removeItem(key) {
      try {
        storage.removeItem(key)
      } catch {
        // Same: a failed removal must not break the memory layer.
      }
    },
  }
}

/**
 * Measured row heights keyed by a stable row id (the turnId — stable
 * across recompiles, so the cache outlives every virtualizer reset).
 * Map iteration order = insertion order: delete-then-set moves a key to
 * the newest end, so re-measured (live) rows are never evicted.
 */
export class TurnRowHeightCache {
  private readonly sizes = new Map<string, number>()
  private readonly storage: RowHeightStore | null
  private readonly prefix: string

  constructor(
    opts: { maxEntries?: number; storage?: RowHeightStore | null; namespace?: string } = {},
  ) {
    this.maxEntries =
      typeof opts.maxEntries === "number" && Number.isFinite(opts.maxEntries) && opts.maxEntries > 0
        ? Math.floor(opts.maxEntries)
        : MAX_ROW_HEIGHT_CACHE_ENTRIES
    this.storage = safeRowHeightStore(opts.storage)
    this.prefix =
      typeof opts.namespace === "string" && opts.namespace !== "" ? opts.namespace : "turn-height"
  }

  private readonly maxEntries: number

  get size(): number {
    return this.sizes.size
  }

  private storageKey(key: string): string {
    return `${this.prefix}\u0000${key}`
  }

  /** Record one real measurement. Repeats refresh the eviction order; storage is write-through. */
  set(key: string, heightPx: number): void {
    if (typeof key !== "string" || key === "") return
    if (!Number.isFinite(heightPx) || heightPx <= 0) return
    this.sizes.delete(key)
    this.sizes.set(key, heightPx)
    while (this.sizes.size > this.maxEntries) {
      const oldest = this.sizes.keys().next()
      if (oldest.done) break
      const evicted = oldest.value
      this.sizes.delete(evicted)
      this.storage?.removeItem(this.storageKey(evicted))
    }
    this.storage?.setItem(this.storageKey(key), String(heightPx))
  }

  /** Memory first, then the injected storage (which repopulates memory). */
  get(key: string): number | undefined {
    const memory = this.sizes.get(key)
    if (memory !== undefined) return memory
    if (this.storage === null || typeof key !== "string" || key === "") return undefined
    const raw = this.storage.getItem(this.storageKey(key))
    if (raw === null) return undefined
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined
    // Repopulate memory WITHOUT a storage write (it just came from there).
    this.sizes.set(key, parsed)
    while (this.sizes.size > this.maxEntries) {
      const oldest = this.sizes.keys().next()
      if (oldest.done) break
      this.sizes.delete(oldest.value)
    }
    return parsed
  }

  /** Raw estimate entry point: measurement or the given fallback. */
  estimate(key: string | undefined, fallbackPx: number = DEFAULT_ROW_HEIGHT_FALLBACK_PX): number {
    if (key === undefined) return fallbackPx
    return this.get(key) ?? fallbackPx
  }

  /** Stream switch: measurements are turn-scoped — drop the whole layer. */
  clear(): void {
    if (this.storage !== null) {
      for (const key of this.sizes.keys()) this.storage.removeItem(this.storageKey(key))
    }
    this.sizes.clear()
  }
}

// ── RowEstimator (least-squares fit over text/width, pi row-estimate) ───────

/** What the estimator fits on: rows of one kind share a line. */
export interface RowFeatures {
  /** Rows of one kind share a fit (task turns vs message turns here). */
  kind: string
  /** Text length in characters. */
  text: number
  /** Height known exactly (images), excluded from the fit. */
  fixed: number
}

/** Least-squares line through measured (x, y) points, kept as running sums. */
class Fit {
  count = 0
  private x = 0
  private y = 0
  private xx = 0
  private xy = 0

  add(x: number, y: number): void {
    this.count += 1
    this.x += x
    this.y += y
    this.xx += x * x
    this.xy += x * y
  }

  reset(): void {
    this.count = 0
    this.x = 0
    this.y = 0
    this.xx = 0
    this.xy = 0
  }

  at(x: number): number {
    const n = this.count
    const mean = this.y / n
    const spread = n * this.xx - this.x * this.x
    // Too few or too alike points for a slope: their mean.
    if (n < 3 || spread <= 1e-9) return mean
    const slope = (n * this.xy - this.x * this.y) / spread
    // Longer text is never shorter.
    if (slope < 0) return mean
    return (this.y - slope * this.x) / n + slope * x
  }
}

/**
 * Learning estimator over (kind, text/width) features. `estimate` pins a
 * row's FIRST estimate (same row + same width never re-estimates — a
 * moving estimate below the reader shifts what they look at);
 * `measured` folds a real measurement into the kind's fit and the
 * global fit. A kind with no measurements falls back to the global fit,
 * then to the caller's per-row fallback (the static model estimate).
 */
export class RowEstimator {
  private readonly kinds = new Map<string, Fit>()
  private readonly all = new Fit()
  private readonly pinned = new Map<string, { width: number; height: number }>()
  private readonly maxPinned: number

  constructor(opts: { maxPinned?: number } = {}) {
    this.maxPinned =
      typeof opts.maxPinned === "number" && Number.isFinite(opts.maxPinned) && opts.maxPinned > 0
        ? Math.floor(opts.maxPinned)
        : MAX_ROW_ESTIMATOR_PINNED_ENTRIES
  }

  get pinnedCount(): number {
    return this.pinned.size
  }

  get learnedKindCount(): number {
    return this.kinds.size
  }

  /**
   * The estimated height of the row `key` at `width`. Same key + same
   * width returns the pinned first estimate forever. `fallback` applies
   * while NOTHING has been learned (no kind fit, no global fit) — the
   * caller passes the static model estimate.
   */
  estimate(key: string, features: RowFeatures, width: number, fallback: number): number {
    const kept = this.pinned.get(key)
    if (kept && kept.width === width) return kept.height
    const safeWidth = Number.isFinite(width) && width > 0 ? width : 1
    const safeText = Number.isFinite(features.text) && features.text >= 0 ? features.text : 0
    const x = safeText / safeWidth
    const kindFit = this.kinds.get(features.kind)
    const learned = kindFit?.count
      ? kindFit.at(x)
      : this.all.count
        ? this.all.at(x)
        : Number.isFinite(fallback)
          ? fallback
          : 0
    const height = Math.max(0, learned) + (Number.isFinite(features.fixed) ? features.fixed : 0)
    // Pin (LRU: re-set moves to the newest end).
    this.pinned.delete(key)
    this.pinned.set(key, { width, height })
    while (this.pinned.size > this.maxPinned) {
      const oldest = this.pinned.keys().next()
      if (oldest.done) break
      this.pinned.delete(oldest.value)
    }
    return height
  }

  /** A rendered row's measured height at `width` — folds into the fits. */
  measured(key: string, features: RowFeatures, width: number, heightPx: number): void {
    // The row's own pin stops mattering once a real measurement exists
    // (the cache layer short-circuits before the estimator is reached).
    this.pinned.delete(key)
    const safeWidth = Number.isFinite(width) && width > 0 ? width : 1
    const safeText = Number.isFinite(features.text) && features.text >= 0 ? features.text : 0
    const safeHeight = Number.isFinite(heightPx) && heightPx >= 0 ? heightPx : 0
    const x = safeText / safeWidth
    const y = Math.max(0, safeHeight - (Number.isFinite(features.fixed) ? features.fixed : 0))
    let fit = this.kinds.get(features.kind)
    if (!fit) {
      fit = new Fit()
      this.kinds.set(features.kind, fit)
    }
    fit.add(x, y)
    this.all.add(x, y)
  }

  /** Stream switch: learned fits and pins are turn-scoped — drop them. */
  clear(): void {
    this.kinds.clear()
    this.all.reset()
    this.pinned.clear()
  }
}

// ── Turn-level composition (the three height levels) ────────────────────────

/** Viewport width the length/width fit assumes when none was measured. */
export const DEFAULT_ESTIMATE_WIDTH_PX = 720

/**
 * The features one turn row fits on: rows of one structural kind share a
 * line — task turns carry header + status chrome, message turns are pure
 * text — and the fit variable is the turn's total text length.
 */
export function turnRowFeatures(
  turn: { turnId?: string; units?: ConversationUnit[] } | null | undefined,
): RowFeatures {
  if (turn === null || typeof turn !== "object" || !Array.isArray(turn.units)) {
    return { kind: "message", text: 0, fixed: 0 }
  }
  let text = 0
  for (const unit of turn.units) {
    if (unit === null || typeof unit !== "object") continue
    if (unit.kind === "text" && typeof unit.text === "string") text += unit.text.length
  }
  const kind =
    typeof turn.turnId === "string" && turn.turnId.startsWith("task-") ? "task" : "message"
  return { kind, text, fixed: 0 }
}

/**
 * Cache + estimator pair scoped to one stream (workspace id): turnIds
 * are only unique WITHIN a stream, so a stream switch gets a fresh model
 * (the ZCode cache resets on session switch for the same reason).
 */
export interface TurnHeightModel {
  /** Stream scope the model was built for. */
  scope: string
  cache: TurnRowHeightCache
  estimator: RowEstimator
}

export function createTurnHeightModel(
  scope: string,
  opts: { storage?: RowHeightStore | null; namespace?: string } = {},
): TurnHeightModel {
  return {
    scope,
    cache: new TurnRowHeightCache({
      namespace: opts.namespace ?? `turn-height:${scope}`,
      storage: opts.storage,
    }),
    estimator: new RowEstimator(),
  }
}

/**
 * Level 1 measured → level 2 learned estimate (pinned) → level 3 static
 * model estimate. The cache's real measurement always wins; the
 * estimator never re-estimates a pinned row at the same width; the
 * static per-unit arithmetic (turnHeight) seeds the fit before anything
 * was learned.
 */
export function resolveTurnHeight(
  turn: TurnModel,
  model: TurnHeightModel,
  width: number = DEFAULT_ESTIMATE_WIDTH_PX,
): number {
  const measured = model.cache.get(turn.turnId)
  if (measured !== undefined) return measured
  const features = turnRowFeatures(turn)
  const staticEstimate = turnHeight(turn)
  return model.estimator.estimate(turn.turnId, features, width, staticEstimate)
}

/**
 * Fold one real measurement into both layers. Returns whether the row's
 * known height actually changed — the caller re-derives its height list
 * (and only then) — so ResizeObserver echoes of our own minHeight floor
 * converge instead of looping.
 */
export function recordTurnMeasurement(
  turn: TurnModel,
  model: TurnHeightModel,
  heightPx: number,
  width: number,
): boolean {
  if (!Number.isFinite(heightPx) || heightPx <= 0) return false
  const previous = model.cache.get(turn.turnId)
  model.cache.set(turn.turnId, heightPx)
  model.estimator.measured(turn.turnId, turnRowFeatures(turn), width, heightPx)
  return previous === undefined || Math.abs(previous - heightPx) >= 0.5
}
