// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Text-safety helpers for bounded writes (cross-agent deliverable).
 *
 * Consumers (tools/session-store) truncate strings to a byte/char budget
 * before persisting them. A naive `String.slice(0, n)` can split a UTF-16
 * surrogate pair: the first half of an emoji (or any astral character) is a
 * lone high surrogate that renders as U+FFFD garbage and corrupts downstream
 * string comparisons. This module owns the surrogate-pair semantics so every
 * call site truncates identically:
 *
 *   a truncation that lands between the two halves of a surrogate pair
 *   DROPS the unpaired high surrogate — it never emits half a character.
 */

/** High surrogate code unit range (U+D800–U+DBFF). */
function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff
}

/** Low surrogate code unit range (U+DC00–U+DFFF). */
function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff
}

/**
 * Truncate `text` to at most `maxCodeUnits` UTF-16 code units without
 * splitting a surrogate pair at the cut point.
 *
 * Semantics:
 *   - `maxCodeUnits >= text.length` → the input, unchanged.
 *   - `maxCodeUnits <= 0` → "".
 *   - Otherwise the result is `text.slice(0, maxCodeUnits)`, except when the
 *     cut would separate a high surrogate (last kept unit) from its low
 *     surrogate (first dropped unit): the unpaired high surrogate is dropped
 *     too, so the result is one code unit shorter and contains no half pair.
 *
 * Lone surrogates that were ALREADY in the input away from the boundary are
 * preserved verbatim — this function only owns the cut it makes.
 */
export function truncateWithoutSplittingSurrogatePair(text: string, maxCodeUnits: number): string {
  if (!Number.isFinite(maxCodeUnits) || maxCodeUnits <= 0) return ""
  if (maxCodeUnits >= text.length) return text
  const cut = Math.floor(maxCodeUnits)
  const lastKept = text.charCodeAt(cut - 1)
  const firstDropped = text.charCodeAt(cut)
  if (isHighSurrogate(lastKept) && isLowSurrogate(firstDropped)) {
    // The boundary lands inside a surrogate pair: drop the unpaired high
    // half instead of emitting it (it is not a character on its own).
    return text.slice(0, cut - 1)
  }
  return text.slice(0, cut)
}

/**
 * True when `text` ends with a lone high surrogate (the first half of a
 * surrogate pair whose second half has not arrived yet). Streaming writers
 * use this to hold back the trailing half until the next chunk arrives
 * instead of emitting it prematurely.
 */
export function endsWithLoneHighSurrogate(text: string): boolean {
  if (text.length === 0) return false
  return isHighSurrogate(text.charCodeAt(text.length - 1))
}
