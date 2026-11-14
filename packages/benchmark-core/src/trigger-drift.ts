// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Baseline trigger-F1 drift detection (borrowing MiniMax-Provider-Verifier
 * `scripts/calculate_toolcall_similarity.py:81-161` +
 * `scripts/compare_with_baseline.py`).
 *
 * The pure F1 arithmetic lives in @max/evolution's flip-matrix
 * (`computeTriggerF1`); this module is the benchmark-core adapter: it
 * maps suite results to per-sample finish reasons, aligns the candidate
 * run against the baseline run BY SAMPLE ORDER, classifies missing
 * responses as `error_*`, and builds the multi-loop comparison report
 * (per-loop detail + averages + token usage) that compare_with_baseline.py
 * emits as comparison_report.json.
 *
 * NOTE: the two copies of the F1 core are kept independent on purpose —
 * @max/benchmark-core does not depend on @max/evolution (no workspace
 * edge, no lockfile churn), and the function is small, pure and tested on
 * both sides.
 */

import type { BenchmarkResult, BenchmarkSuiteResult, TokenUsage } from "./types.js"

/** One per-sample observation the drift comparison aligns on. */
export interface TriggerSample {
  /** Protocol finish_reason ("tool_calls" | "stop" | …). */
  finishReason?: string | null
  /** false = the run produced no response at all (error_no_response). */
  hasResponse?: boolean
}

export interface TriggerF1Result {
  tp: number
  fp: number
  fn: number
  tn: number
  precision: number
  recall: number
  f1: number
  totalSamples: number
  errorCount: number
  errorDetail: Record<string, number>
}

/**
 * Map a benchmark result to its trigger observation. `error_no_response`
 * when the result carries an error (no usable response); otherwise the
 * finish reason recorded by the tool_calls validator, or
 * `error_no_finish_reason` when the provider never surfaced one.
 */
export function sampleFromResult(result: BenchmarkResult): TriggerSample {
  if (result.error !== undefined) return { hasResponse: false }
  const fields = result.validatorFields?.["tool_calls"]
  const finishReason =
    fields && typeof fields === "object" && "toolCallsFinishReason" in fields
      ? (fields as { toolCallsFinishReason?: unknown }).toolCallsFinishReason
      : undefined
  return {
    finishReason: typeof finishReason === "string" ? finishReason : null,
    hasResponse: true,
  }
}

/**
 * finish_reason → comparable string; absent/null becomes
 * `error_no_finish_reason` (calculate_toolcall_similarity.py:81-104).
 */
export function classifyFinishReason(reason: string | null | undefined): string {
  if (reason === null || reason === undefined) return "error_no_finish_reason"
  return reason
}

function toReason(sample: TriggerSample): string {
  if (sample.hasResponse === false) return "error_no_response"
  return classifyFinishReason(sample.finishReason)
}

/**
 * Trigger F1 between two aligned sample arrays. Length mismatch throws
 * (calculate_toolcall_similarity.py:118-119) — a silent zip of misaligned
 * runs would fabricate a similarity score.
 */
export function computeTriggerF1(
  baseline: readonly TriggerSample[],
  candidate: readonly TriggerSample[],
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
    const candidateReason = toReason(candidate[i]!)
    if (candidateReason.startsWith("error_")) {
      errorCount += 1
      errorDetail[candidateReason] = (errorDetail[candidateReason] ?? 0) + 1
    }
    const officialIsToolCall = toReason(baseline[i]!) === "tool_calls"
    const candidateIsToolCall = candidateReason === "tool_calls"
    if (officialIsToolCall && candidateIsToolCall) tp += 1
    else if (!officialIsToolCall && candidateIsToolCall) fp += 1
    else if (officialIsToolCall && !candidateIsToolCall) fn += 1
    else tn += 1
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
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

// ── Multi-loop comparison report (compare_with_baseline.py) ────────────────

export interface LoopComparisonInput {
  /** Loop name (compare_with_baseline matches `loop_*` directories). */
  loop: string
  baseline: readonly TriggerSample[]
  candidate: readonly TriggerSample[]
  baselineTokenUsage?: TokenUsage
  candidateTokenUsage?: TokenUsage
}

export interface LoopComparison {
  loop: string
  f1: number
  precision: number
  recall: number
  tp: number
  fp: number
  fn: number
  tn: number
  totalSamples: number
  errorCount: number
  errorDetail: Record<string, number>
  baselineTokenUsage?: TokenUsage
  candidateTokenUsage?: TokenUsage
}

export interface TriggerComparisonReport {
  loops: LoopComparison[]
  /** Mean over loops that produced an F1 (compare_with_baseline.py:285+). */
  averageMetrics: {
    triggerF1?: number
    precision?: number
    recall?: number
    tokenUsage?: TokenUsage
  }
}

/**
 * Compare every loop against its matched baseline loop and aggregate:
 * per-loop detail plus mean F1/precision/recall and mean token usage.
 */
export function compareWithBaseline(
  loops: readonly LoopComparisonInput[],
): TriggerComparisonReport {
  const comparisons: LoopComparison[] = loops.map((l) => {
    const f1 = computeTriggerF1(l.baseline, l.candidate)
    return {
      loop: l.loop,
      f1: f1.f1,
      precision: f1.precision,
      recall: f1.recall,
      tp: f1.tp,
      fp: f1.fp,
      fn: f1.fn,
      tn: f1.tn,
      totalSamples: f1.totalSamples,
      errorCount: f1.errorCount,
      errorDetail: f1.errorDetail,
      ...(l.baselineTokenUsage ? { baselineTokenUsage: l.baselineTokenUsage } : {}),
      ...(l.candidateTokenUsage ? { candidateTokenUsage: l.candidateTokenUsage } : {}),
    }
  })

  const averageMetrics: TriggerComparisonReport["averageMetrics"] = {}
  const mean = (values: number[]): number | undefined =>
    values.length > 0 ? round4(values.reduce((a, b) => a + b, 0) / values.length) : undefined
  const f1Mean = mean(comparisons.map((c) => c.f1))
  const precisionMean = mean(comparisons.map((c) => c.precision))
  const recallMean = mean(comparisons.map((c) => c.recall))
  if (f1Mean !== undefined) averageMetrics.triggerF1 = f1Mean
  if (precisionMean !== undefined) averageMetrics.precision = precisionMean
  if (recallMean !== undefined) averageMetrics.recall = recallMean

  const usageInputs = comparisons
    .map((c) => c.candidateTokenUsage)
    .filter((u): u is TokenUsage => u !== undefined)
  if (usageInputs.length > 0) {
    averageMetrics.tokenUsage = {
      prompt: Math.round(mean(usageInputs.map((u) => u.prompt)) ?? 0),
      completion: Math.round(mean(usageInputs.map((u) => u.completion)) ?? 0),
      total: Math.round(mean(usageInputs.map((u) => u.total)) ?? 0),
    }
  }

  return { loops: comparisons, averageMetrics }
}

/**
 * Suite-level helper: map two suites' results to aligned trigger samples.
 * Suites from the same task list align BY SAMPLE ORDER (the order the
 * tasks were run in); a mismatch is reported by computeTriggerF1's throw.
 */
export function suitesToTriggerSamples(
  baselineSuite: BenchmarkSuiteResult,
  candidateSuite: BenchmarkSuiteResult,
): { baseline: TriggerSample[]; candidate: TriggerSample[] } {
  return {
    baseline: baselineSuite.results.map(sampleFromResult),
    candidate: candidateSuite.results.map(sampleFromResult),
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
