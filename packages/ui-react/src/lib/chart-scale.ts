// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure scale helpers shared by the time-series chart.
 *
 * (borrowing) Ported verbatim from the OpenAgentCore console
 * `components/charts/chart-scale.ts` (the `niceTicks`/`tickIndices`/
 * `formatBucketTime` trio plus the CJK-aware label width); the entity-slot
 * color bookkeeping upstream also carries is not needed here.
 */

/**
 * Round a positive maximum up to a clean axis limit and return evenly spaced
 * ticks from zero. With `integer`, the step is a whole number (1, 2, 5, 10,
 * …), so counts never get fractional ticks.
 */
export function niceTicks(maximum: number, targetCount = 4, integer = false): number[] {
  if (!Number.isFinite(maximum) || maximum <= 0) return [0, 1]
  const rough = maximum / targetCount
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const residual = rough / magnitude
  const nice =
    (residual <= 1
      ? 1
      : residual <= 2
        ? 2
        : residual <= 2.5 && !integer
          ? 2.5
          : residual <= 5
            ? 5
            : 10) * magnitude
  const step = integer ? Math.max(1, Math.ceil(nice)) : nice
  const count = Math.max(1, Math.ceil(maximum / step - 1e-9))
  return Array.from({ length: count + 1 }, (_, index) => Number((index * step).toPrecision(12)))
}

/** Pick at most `maximum` evenly spaced indices, always including the first and last. */
export function tickIndices(length: number, maximum = 6): number[] {
  if (length <= 0) return []
  if (length <= maximum) return Array.from({ length }, (_, index) => index)
  const stride = Math.ceil((length - 1) / (maximum - 1))
  const indices: number[] = []
  for (let index = 0; index < length - 1; index += stride) indices.push(index)
  if (length - 1 - (indices[indices.length - 1] ?? 0) < stride / 2) indices.pop()
  indices.push(length - 1)
  return indices
}

/** Format one bucket start according to the range span and bucket granularity. */
export function formatBucketTime(
  seconds: number,
  bucketSeconds: number,
  spanSeconds: number,
  locale?: string,
): string {
  const date = new Date(seconds * 1000)
  if (spanSeconds > 36 * 3600) {
    return new Intl.DateTimeFormat(
      locale,
      bucketSeconds >= 86_400
        ? { month: "numeric", day: "numeric" }
        : {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          },
    ).format(date)
  }
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)
}

/**
 * Approximate width of an 11px tick label: tabular digits and Latin glyphs
 * (6.4px), narrow spaces, full-width CJK ideographs and kana (11px). The
 * axis gutter grows to the widest label this predicts, so every chart lines
 * up its plot the same way without measuring the DOM.
 */
export function axisLabelWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char) ? 11 : char === " " ? 3 : 6.4
  }
  return width
}
