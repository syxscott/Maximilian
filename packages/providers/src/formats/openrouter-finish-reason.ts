// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * OpenRouter `native_finish_reason` handling (pi #12407 borrowing:
 * borrowings/pi packages/ai/src/utils/openrouter-finish-reason.ts:44-69).
 *
 * OpenRouter normalizes every upstream finish reason into an OpenAI-style
 * `finish_reason`, so upstream failures such as Gemini's MALFORMED_RESPONSE
 * arrive as a plain `stop`. When reasoning already streamed before the
 * failure, the turn would otherwise end silently with no visible output —
 * the caller sees an empty reply instead of a retryable error. The stream
 * layer reads `native_finish_reason` off each choice and calls
 * {@link isEmptyOpenRouterStop} once the stream completes.
 */

/** Returns OpenRouter's `native_finish_reason` from a streamed choice, when present. */
export function readOpenRouterNativeFinishReason(choice: object): string | undefined {
  // Wire input: an OpenRouter extension the OpenAI SDK types do not declare.
  const native = (choice as { native_finish_reason?: unknown }).native_finish_reason
  return typeof native === "string" && native.length > 0 ? native : undefined
}

/**
 * Native reasons OpenRouter treats as a clean stop. OpenRouter maps any other
 * value to `stop` as well, so a failure that already streamed output (e.g.
 * Gemini reasoning followed by MALFORMED_RESPONSE) arrives as `stop`. Two
 * entries are deliberately excluded because their providers document them as
 * failures: Gemini's "OTHER" ("stopped for a reason not otherwise specified")
 * and DeepSeek's "insufficient_system_resource" ("interrupted due to
 * insufficient resource").
 *
 * OpenRouter does not publish this list, so it can drift — re-check it against
 * the OpenRouter docs/upstream finish-reason lists when touching this module.
 * It is an allowlist on purpose: a missing clean reason costs a few retries of
 * an empty turn, while a missing failure reason would end the turn silently.
 * Lowercase, compared case-insensitively, because upstreams differ in case
 * ("STOP", "stop").
 */
export const CLEAN_STOP_NATIVE_REASONS: ReadonlySet<string> = new Set([
  "stop",
  "end_turn",
  "stop_sequence",
  "eos",
  "complete",
  "completed",
  "pause_turn",
  "compaction",
  "end_of_stream",
])

/** Stream-end state {@link isEmptyOpenRouterStop} needs. */
export interface OpenRouterStopState {
  /** Last OpenAI-style `finish_reason` observed on the stream. */
  readonly finishReason: string | undefined
  /** Last `native_finish_reason` OpenRouter sent, when it sent one. */
  readonly nativeFinishReason: string | undefined
  /**
   * Whether the stream produced visible output: non-whitespace text, a
   * refusal delta, or a tool-call delta. Reasoning alone does NOT count.
   */
  readonly hasVisibleOutput: boolean
}

/**
 * True when a finished `stop` carries no visible output while the upstream
 * reported a failure through `native_finish_reason`.
 *
 * A `stop` without a native reason is left alone: without the upstream signal
 * an empty stop is ambiguous, and pi's reference implementation only flags
 * when OpenRouter actually sent a reason.
 */
export function isEmptyOpenRouterStop(state: OpenRouterStopState): boolean {
  if (state.finishReason !== "stop" || state.nativeFinishReason === undefined) return false
  if (CLEAN_STOP_NATIVE_REASONS.has(state.nativeFinishReason.toLowerCase())) return false
  return !state.hasVisibleOutput
}

/**
 * Error message for the retryable EMPTY_RESPONSE failure. Kept next to the
 * predicate so support/diagnostics see one stable wording.
 */
export function openRouterEmptyStopMessage(nativeFinishReason: string): string {
  return `OpenRouter returned an empty response (native_finish_reason: ${nativeFinishReason})`
}
