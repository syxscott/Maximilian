// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Execution-error taxonomy + batch reset policy (swarms borrowing).
 *
 * Swarms separates *transient* transport failures (connection errors,
 * timeouts — retryable) from everything else at the boundary where the
 * failure is observed, instead of letting each call-site improvise its own
 * retry rules. Maximilian adapts that into a CLOSED category set for
 * execution/crash recovery:
 *
 *   transient | permanent | context_limit | oversized | rate_limit | cancelled | unknown
 *
 * `classifyError` is the coarse, policy-level classifier: it reuses the
 * fine-grained `classifyTaskError` pipeline (failover-reason.ts, hermes
 * borrowing) as its pattern source and folds each FailoverReason into one
 * category, plus a cancellation probe that runs FIRST (cancellation is a
 * control-flow signal, not a failure of the attempt) and a deterministic
 * oversized-request probe (`isLLMRequestOversized`, minimax borrowing) right
 * after it — a request the provider rejects as too large fails identically
 * on every resend, so it must be named before any transient-looking wording
 * inside the same message can misroute it.
 *
 * Each category carries a reset action for crash-recovery sweeps
 * (`ERROR_RESET_ACTIONS`): which stalled tasks may be put back into the
 * retry pool, and which must be left alone. The consumer (@max/queue) is
 * the batch-reset entry point; this module owns the decision table.
 */

import { classifyTaskError, type FailoverReason } from "./failover-reason.js"

/** Closed set of execution-error categories. Never add ad-hoc strings. */
export const ERROR_CATEGORIES = [
  "transient",
  "permanent",
  "context_limit",
  "oversized",
  "rate_limit",
  "cancelled",
  "unknown",
] as const

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number]

/**
 * What a crash-recovery sweep may do with a task stuck in a running state:
 *   - reset_retryable: put back into the retry pool (safe re-run).
 *   - hold: leave untouched, annotate why (a retry would deterministically
 *     re-fail, or the task was deliberately stopped).
 *   - hold_and_count: leave untouched AND count it — an unrecognized
 *     failure shape must be surfaced to operators, not auto-retried.
 */
export type ErrorResetAction = "reset_retryable" | "hold" | "hold_and_count"

/**
 * Category → crash-recovery decision. rate_limit resets like a transient
 * failure (backoff is the queue's job); context_limit holds because a blind
 * re-run without compaction re-hits the same wall; oversized holds for the
 * stronger reason (minimax borrowing): the request is too large to be
 * accepted AS SENT, so resending unchanged fails identically — recovery
 * requires the forced-compaction hook, not a retry; unknown is conservative.
 */
export const ERROR_RESET_ACTIONS: Record<ErrorCategory, ErrorResetAction> = {
  transient: "reset_retryable",
  permanent: "hold",
  context_limit: "hold",
  oversized: "hold",
  rate_limit: "reset_retryable",
  cancelled: "hold",
  unknown: "hold_and_count",
}

/** Result of {@link classifyError}. */
export interface ClassifiedExecutionError {
  category: ErrorCategory
  /** First 500 chars of the error message (same bound as classifyTaskError). */
  message: string
  /**
   * Whether re-running the SAME work can plausibly succeed. False for
   * `unknown` even though classifyTaskError optimistically retries provider
   * calls — a crash-recovery sweep must not auto-reset what it cannot name.
   */
  retryable: boolean
  /** Batch reset policy for this category (mirrors ERROR_RESET_ACTIONS). */
  resetAction: ErrorResetAction
}

/** Cancellation markers: control flow, not attempt failure. Checked first. */
const CANCELLED_PATTERNS = [
  /\bcancel(?:l)?ed\b/i,
  /\baborted\b/i,
  /\buser (?:requested )?(?:stop|abort|cancel)/i,
]

/**
 * Transport-level failure markers (swarms `_NETWORK_ERRORS` borrowing:
 * ConnectionError/Timeout are the canonical retryable class). Node surfaces
 * these as codes (ECONNREFUSED, ETIMEDOUT, EPIPE…) that the hermes message
 * patterns do not cover, so the probe runs before the generic pipeline.
 */
const TRANSPORT_PATTERNS = [
  /\beconn[a-z]*\b/i,
  /\betimedout\b/i,
  /\benotfound\b/i,
  /\beai_again\b/i,
  /\behostunreach\b/i,
  /\benetunreach\b/i,
  /\bepipe\b/i,
  /\bsocket hang up\b/i,
  /\bfetch failed\b/i,
  /\bnetwork error\b/i,
  /\bconnection (?:refused|reset|closed|timed out)\b/i,
]

/** True for AbortError-shaped values (standard DOM cancellation signal). */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError"
}

function messageOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.slice(0, 500)
}

/**
 * Best-effort HTTP status extraction from provider-shaped errors.
 * `ProviderError` carries `statusCode`; fetch-layer errors carry `status`;
 * plain objects crossing a process boundary keep neither — callers then
 * route on the message keywords alone.
 */
function statusOf(err: unknown): number | undefined {
  if (err === null || typeof err !== "object") return undefined
  const candidate = err as { statusCode?: unknown; status?: unknown }
  for (const value of [candidate.statusCode, candidate.status]) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  }
  return undefined
}

function looksCancelled(err: unknown, message: string): boolean {
  return isAbortError(err) || CANCELLED_PATTERNS.some((p) => p.test(message))
}

function looksTransportFailure(message: string): boolean {
  return TRANSPORT_PATTERNS.some((p) => p.test(message))
}

// ── Oversized-request gate (minimax isLLMRequestOversized borrowing) ─────────

/**
 * Keywords that name a CONCRETE size rejection: a request-body byte limit
 * (`request_too_large`, `payload too large`) or a context-window overflow at
 * a named limit (OpenAI's `context length` wording,
 * `context_length_exceeded`). Generic budget wording ("token limit",
 * "context window") stays in `context_limit` — the subdivision keeps
 * `oversized` reserved for rejections that repeat identically on resend.
 */
const OVERSIZED_MESSAGE_PATTERNS = [
  /request_too_large/i,
  /\brequest too large\b/i,
  /\bpayload too large\b/i,
  /\bcontext_length_exceeded\b/i,
  /\bcontext length\b/i,
  /\bmaximum context\b/i,
  /\breduce the length\b/i,
]

/**
 * Whatever ALSO looks transient must never be classified as oversized —
 * a timeout or rate-limit error that merely mentions "context" in a usage
 * hint would otherwise be misrouted into the one-shot compaction recovery.
 * Mirrors minimax's exclusion set: explicit abort, timeout, network,
 * rate limiting, and 408/429/5xx statuses.
 */
const TRANSIENT_MESSAGE_PATTERNS = [
  /\btimeout\b/i,
  /\btimed? ?out\b/i,
  /\bdeadline.exceeded\b/i,
  /\brate.limit\b/i,
  /\btoo many requests\b/i,
  /\bthrottl/i,
  /\boverloaded\b/i,
  /\bservice.unavailable\b/i,
]

/** HTTP statuses that always mean "the provider accepted size semantics". */
const OVERSIZED_STATUSES = new Set([400, 413, 422])

/**
 * True when a failed LLM request was rejected AS TOO LARGE to be accepted as
 * sent: HTTP 413 outright, or an HTTP 400/422 (or a message-only rejection
 * with no surviving status) whose message names a request-body or
 * context-window limit. Anything that also looks transient — timeout,
 * network, rate limiting, overload, 408/429/5xx — is excluded, because
 * resending such an error is exactly what retry is for.
 *
 * A `true` answer is DETERMINISTIC: the identical request fails identically
 * on resend, so callers must not retry it unchanged — the only recovery is
 * to shrink the request (the context-overflow-recovery hook) and resend once.
 */
export function isLLMRequestOversized(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  const flattened = message.slice(0, 1000)
  if (isAbortError(err)) return false
  if (CANCELLED_PATTERNS.some((p) => p.test(flattened))) return false
  if (TRANSPORT_PATTERNS.some((p) => p.test(flattened))) return false
  if (TRANSIENT_MESSAGE_PATTERNS.some((p) => p.test(flattened))) return false
  const status = statusOf(err)
  if (status !== undefined && (status === 408 || status === 429 || status >= 500)) return false
  if (status === 413) return true
  if (!OVERSIZED_MESSAGE_PATTERNS.some((p) => p.test(flattened))) return false
  return status === undefined || OVERSIZED_STATUSES.has(status)
}

/** Fold a fine-grained FailoverReason into the coarse closed set. */
function categoryOfReason(reason: FailoverReason): ErrorCategory {
  switch (reason) {
    // Retryable-with-a-change-of-plans failures that a plain re-run can fix.
    case "auth":
    case "overloaded":
    case "server_error":
    case "timeout":
      return "transient"
    // Structurally non-retryable: the outcome is determined by config,
    // billing, policy, or the request itself.
    case "auth_permanent":
    case "billing":
    case "permission_denied":
    case "policy_denied":
    case "tool_error":
    case "model_not_found":
    case "provider_policy_blocked":
    case "content_policy_blocked":
    case "payload_too_large":
    case "format_error":
      return "permanent"
    case "context_overflow":
      return "context_limit"
    case "rate_limit":
      return "rate_limit"
    case "unknown":
      return "unknown"
  }
}

/**
 * Classify an execution error into the closed category set with its
 * crash-recovery reset policy. Priority: cancellation probe → deterministic
 * oversized-request probe (a size rejection fails identically on every
 * resend — it must be named before transient-looking wording in the same
 * message can misroute it) → transport probe (swarms network-error class) →
 * fine-grained task classification (hermes pipeline) → unknown.
 */
export function classifyError(err: unknown): ClassifiedExecutionError {
  const message = messageOf(err)
  if (looksCancelled(err, message)) {
    return { category: "cancelled", message, retryable: false, resetAction: "hold" }
  }
  if (isLLMRequestOversized(err)) {
    return { category: "oversized", message, retryable: false, resetAction: "hold" }
  }
  const category = looksTransportFailure(message)
    ? "transient"
    : categoryOfReason(classifyTaskError(err).reason)
  return {
    category,
    message,
    retryable: category === "transient" || category === "rate_limit",
    resetAction: ERROR_RESET_ACTIONS[category],
  }
}
