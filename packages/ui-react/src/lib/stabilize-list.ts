// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * List reference stabilization (ZCode taskListItemStabilization /
 * taskListMembershipVersion borrowing).
 *
 * Event-driven lists (SSE snapshots, injected store payloads) arrive as
 * freshly parsed JSON: every row is a new object even when its content
 * is byte-identical to the previous snapshot, so every consumer keyed on
 * item identity — memoized rows, zustand subscriptions — re-renders the
 * whole tree on every frame. {@link stabilizeList} folds a new snapshot
 * onto the previous list:
 *
 *   - rows that are structurally equal to their predecessor keep the OLD
 *     object reference (renders keyed on identity skip them);
 *   - when every row is reused the OLD array reference is returned too,
 *     so even array-keyed subscribers bail out entirely.
 *
 * Structural equality deliberately avoids JSON.stringify: producer-side
 * conditional spreads (`...(x ? { a: 1 } : {})`) make key order unstable
 * between otherwise-identical rows, and stringify would also treat an
 * explicit `undefined` differently from an absent key. Key order is
 * ignored and explicit undefined is treated as absent.
 */

/**
 * Deep structural equality: key order ignored, `undefined`-valued keys
 * treated as absent (conditional-spread producers make the two shapes
 * interchangeable), arrays compared element-wise. Never uses
 * JSON.stringify.
 */
export function structuralEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  const aIsArray = Array.isArray(a)
  if (aIsArray !== Array.isArray(b)) return false
  if (aIsArray) {
    const ba = b as unknown[]
    if ((a as unknown[]).length !== ba.length) return false
    for (let i = 0; i < (a as unknown[]).length; i++) {
      if (!structuralEqual((a as unknown[])[i], ba[i])) return false
    }
    return true
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  // undefined-valued keys count as absent on both sides.
  const aKeys = Object.keys(ra).filter((k) => ra[k] !== undefined)
  const bKeys = new Set(Object.keys(rb).filter((k) => rb[k] !== undefined))
  if (aKeys.length !== bKeys.size) return false
  for (const key of aKeys) {
    if (!bKeys.has(key)) return false
    if (!structuralEqual(ra[key], rb[key])) return false
  }
  return true
}

/**
 * Fold `next` onto `prev`: rows with the same {@link keyOf} key that are
 * structurally equal keep the previous object reference; if the whole
 * table is unchanged (same length AND same order AND every slot reused)
 * the previous ARRAY reference comes back, so reference-keyed subscribers
 * see a no-op. Row order always follows `next` — a pure reorder reuses
 * the moved row's objects but produces the reordered array.
 */
export function stabilizeList<T>(
  prev: ReadonlyArray<T> | null | undefined,
  next: ReadonlyArray<T>,
  keyOf: (item: T) => string,
): T[] {
  // Nothing to fold onto (or the caller re-passed the same array): the
  // incoming reference IS the stable one.
  if (prev === null || prev === undefined || prev === next) return next as T[]
  const prevByKey = new Map<string, T>()
  for (const item of prev) prevByKey.set(keyOf(item), item)
  const out: T[] = []
  for (const item of next) {
    const old = prevByKey.get(keyOf(item))
    out.push(old !== undefined && structuralEqual(old, item) ? old : item)
  }
  // Whole table equivalent: the OLD array reference comes back so even
  // array-keyed subscribers bail out.
  if (out.length === prev.length && out.every((item, i) => item === prev[i])) {
    return prev as T[]
  }
  return out
}

/**
 * Companion for mutation-then-echo streams (ZCode taskListMembership
 * borrowing): a local mutation bumps the version, and the server echo of
 * that same mutation arrives as an event moments later. Within the
 * window, event keys already seen at the CURRENT version are reported as
 * duplicates so the echo cannot re-trigger work; the bump lets the next
 * mutation's events through again. Only the first sighting per
 * (version, key) inside the window counts.
 */
export interface EventKeyWindow {
  /** Record a mutation: event keys may fire once more. */
  bump(): void
  /** True when `key` was already seen at the current version inside the window. */
  isDuplicate(key: string): boolean
  /** Drop all recorded sightings (e.g. on reconnect). */
  reset(): void
}

/** Create a mutation-echo dedup window (default 500ms, ZCode borrowing). */
export function createEventKeyWindow(windowMs = 500): EventKeyWindow {
  let version = 0
  /** key → { version, first-seen time }. */
  const seen = new Map<string, { version: number; at: number }>()

  const expired = (record: { version: number; at: number }): boolean =>
    record.version !== version || Date.now() - record.at > windowMs

  return {
    bump: () => {
      version += 1
    },
    isDuplicate: (key: string) => {
      const record = seen.get(key)
      if (record && !expired(record)) return true
      seen.set(key, { version, at: Date.now() })
      return false
    },
    reset: () => {
      seen.clear()
    },
  }
}
