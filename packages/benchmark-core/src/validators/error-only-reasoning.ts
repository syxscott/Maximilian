// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Error-only-reasoning detection (borrowing MiniMax-Provider-Verifier
 * verify.py:105-125,393-395 + calculate_toolcall_similarity.py:241-289).
 *
 * This check runs on EVERY response regardless of any check_type — it is
 * the always-on tripwire for the "model burned its whole budget thinking
 * and then answered nothing" failure mode: reasoning present while
 * content AND tool calls are all empty. None/[]/undefined shapes from
 * different providers are all treated as "empty" (verify.py:118-123).
 */

import type { ValidatorCaseRun, ValidatorFields, ValidatorMessageSlice } from "./types.js"

export interface ErrorOnlyReasoningFields extends ValidatorFields {
  /** Always true — the check ran (verify.py error_only_reasoning_checked). */
  errorOnlyReasoningChecked: true
  /** Reasoning present while content and tool calls are all empty. */
  errorOnlyReasoning: boolean
}

export interface ErrorOnlyReasoningSummary extends ValidatorFields {
  errorOnlyReasoningCheckedCount: number
  errorOnlyReasoningCount: number
  /** count / checked; 0 when nothing was checked. */
  errorOnlyReasoningRate: number
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 0
}

/**
 * The always-on check. Compat with None/[]/undefined tool-call shapes:
 * a non-array truthy value counts as "has tool calls", an array counts
 * when non-empty (verify.py:119-122).
 */
export function isErrorOnlyReasoning(message: ValidatorMessageSlice | undefined): boolean {
  if (!message) return false
  const hasReasoning = hasText(message.reasoningContent)
  const hasContent = hasText(message.content)
  const toolCalls = message.toolCalls
  let hasToolCalls: boolean
  if (Array.isArray(toolCalls)) hasToolCalls = toolCalls.length > 0
  else hasToolCalls = Boolean(toolCalls)
  return hasReasoning && !hasContent && !hasToolCalls
}

/**
 * Per-case run of the always-on check (verify.py:393-395: checked=1 and
 * the boolean land on every result, success or failure).
 */
export function runErrorOnlyReasoningCheck(
  message: ValidatorMessageSlice | undefined,
): ErrorOnlyReasoningFields {
  return { errorOnlyReasoningChecked: true, errorOnlyReasoning: isErrorOnlyReasoning(message) }
}

/**
 * Summary aggregation (verify.py:530-542): rate over ALL checked cases.
 */
export function summarizeErrorOnlyReasoning(
  runs: readonly ValidatorCaseRun[],
): ErrorOnlyReasoningSummary {
  let checked = 0
  let flagged = 0
  for (const run of runs) {
    if (run.fields["errorOnlyReasoningChecked"] !== true) continue
    checked += 1
    if (run.fields["errorOnlyReasoning"] === true) flagged += 1
  }
  return {
    errorOnlyReasoningCheckedCount: checked,
    errorOnlyReasoningCount: flagged,
    errorOnlyReasoningRate: checked > 0 ? round4(flagged / checked) : 0,
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
