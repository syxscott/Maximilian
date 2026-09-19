// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Per-task flip matrix (C2C borrowing, Fig 7 / §A.2.3): comparing two
 * configurations by MEAN score can hide "half the tasks flipped correct→
 * wrong while the other half flipped the other way". The flip matrix
 * compares the SETS of correct task ids and reports exactly which tasks
 * moved in which direction, plus the transfer rate (of the tasks the
 * enriched configuration got right, how many the baseline could also do —
 * paper: 72.11% for C2C vs 50.7% for T2T under a strong sharer).
 */
export interface FlipMatrix {
  /** Correct in both configurations. */
  bothCorrect: string[]
  /** Correct only under the enriched configuration. */
  newlyCorrect: string[]
  /** Correct only under the baseline — these are regressions. */
  newlyWrong: string[]
  /** Wrong in both. */
  bothWrong: string[]
  /**
   * Transfer rate: |baseline ∩ enriched| / |enriched| — of everything the
   * enriched run got right, how much the baseline already could do. 1.0
   * means no real transfer (same tasks); lower means genuinely new wins.
   */
  transferRate: number
  /** Net flip: newlyCorrect − newlyWrong. */
  net: number
}

export function computeFlipMatrix(
  baselineCorrect: Iterable<string>,
  enrichedCorrect: Iterable<string>,
): FlipMatrix {
  const base = new Set(baselineCorrect)
  const enr = new Set(enrichedCorrect)
  const bothCorrect: string[] = []
  const newlyCorrect: string[] = []
  const newlyWrong: string[] = []
  const bothWrong: string[] = []
  for (const id of new Set([...base, ...enr])) {
    const inBase = base.has(id)
    const inEnr = enr.has(id)
    if (inBase && inEnr) bothCorrect.push(id)
    else if (!inBase && inEnr) newlyCorrect.push(id)
    else if (inBase && !inEnr) newlyWrong.push(id)
    else bothWrong.push(id)
  }
  const transferRate = enr.size === 0 ? 1 : (bothCorrect.length / enr.size) * 1
  return {
    bothCorrect,
    newlyCorrect,
    newlyWrong,
    bothWrong,
    transferRate,
    net: newlyCorrect.length - newlyWrong.length,
  }
}

/** One-line human summary for reports. */
export function summarizeFlipMatrix(m: FlipMatrix): string {
  return (
    `flip matrix: +${m.newlyCorrect.length} new correct / −${m.newlyWrong.length} regressions ` +
    `(net ${m.net >= 0 ? "+" : ""}${m.net}, transfer ${(m.transferRate * 100).toFixed(1)}%)`
  )
}
