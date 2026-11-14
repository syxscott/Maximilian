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

// ── ToolCalls-Trigger F1 (MiniMax-Provider-Verifier borrowing) ─────────────

/**
 * finish_reason → comparable string; absent/null becomes
 * `error_no_finish_reason` (calculate_toolcall_similarity.py:81-104 — a
 * missing response is a failure category, never a silent positive).
 */
export function classifyFinishReason(reason: string | null | undefined): string {
  if (reason === null || reason === undefined) return "error_no_finish_reason"
  return reason
}

export interface TriggerF1Result {
  /** Baseline triggered, candidate triggered. */
  tp: number
  /** Baseline did not trigger, candidate did. */
  fp: number
  /** Baseline triggered, candidate did not. */
  fn: number
  /** Neither triggered. */
  tn: number
  precision: number
  recall: number
  f1: number
  totalSamples: number
  /** Candidate samples whose reason classified as `error_*`. */
  errorCount: number
  /** Per error kind (`error_no_response`, `error_no_finish_reason`, …). */
  errorDetail: Record<string, number>
}

/**
 * ToolCalls-Trigger Similarity between two ALIGNED finish-reason arrays
 * (MiniMax-Provider-Verifier `calculate_toolcall_similarity.py:107-161`
 * borrowing; sits beside {@link computeFlipMatrix} as the trigger-level
 * counterpart of the task-level flip matrix): positive class =
 * `finish_reason === "tool_calls"`, error_* reasons on the candidate side
 * are counted into `errorCount`/`errorDetail` without entering the
 * matrix. Length mismatch throws — a silent zip of misaligned runs would
 * fabricate a similarity score.
 */
export function computeTriggerF1(
  baseline: ReadonlyArray<string | null | undefined>,
  candidate: ReadonlyArray<string | null | undefined>,
): TriggerF1Result {
  if (baseline.length !== candidate.length) {
    throw new Error(
      `Sample count mismatch: baseline ${baseline.length}, candidate ${candidate.length}`,
    )
  }

  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0,
    errorCount = 0
  const errorDetail: Record<string, number> = {}

  for (let i = 0; i < baseline.length; i++) {
    const candidateReason = classifyFinishReason(candidate[i])
    if (candidateReason.startsWith("error_")) {
      errorCount += 1
      errorDetail[candidateReason] = (errorDetail[candidateReason] ?? 0) + 1
    }
    const officialIsToolCall = classifyFinishReason(baseline[i]) === "tool_calls"
    const candidateIsToolCall = candidateReason === "tool_calls"
    if (officialIsToolCall && candidateIsToolCall) tp += 1
    else if (!officialIsToolCall && candidateIsToolCall) fp += 1
    else if (officialIsToolCall && !candidateIsToolCall) fn += 1
    else tn += 1
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  const round4 = (n: number): number => Math.round(n * 10000) / 10000
  return {
    tp,
    fp,
    fn,
    tn,
    precision: round4(precision),
    recall: round4(recall),
    f1: round4(f1),
    totalSamples: baseline.length,
    errorCount,
    errorDetail,
  }
}
