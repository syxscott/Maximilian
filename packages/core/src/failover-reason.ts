/**
 * FailoverReason + ClassifiedError (借鉴 hermes-agent error_classifier.py).
 *
 * Hermes-agent centralizes API-failure classification into a single
 * `FailoverReason` enum, paired with a `ClassifiedError` dataclass that
 * carries boolean recovery hints (`retryable`, `should_compress`,
 * `should_rotate_credential`, `should_fallback`). A priority-ordered
 * classification pipeline replaces scattered inline string matching.
 *
 * Maximilian adapts this for task-execution failures: when the runtime
 * encounters a task error, `classifyTaskError` returns a `ClassifiedError`
 * that guides the retry/fallback decision — rather than re-inspecting the
 * error string in every caller.
 */

/**
 * Why a task or API call failed — determines the recovery strategy.
 * Borrowed from hermes-agent's FailoverReason enum (error_classifier.py:24)
 * but adapted for Maximilian's runtime (fewer categories for now — expand
 * as needed).
 */
export const FailoverReason = {
  /** Authentication/authorization failure (rotate creds). */
  Auth: "auth",
  /** Permanent auth failure — don't retry. */
  AuthPermanent: "auth_permanent",
  /** Billing/quota exhaustion. */
  Billing: "billing",
  /** Rate-limited (backoff + retry). */
  RateLimit: "rate_limit",
  /** Provider server overloaded. */
  Overloaded: "overloaded",
  /** Internal server error. */
  ServerError: "server_error",
  /** Request timed out. */
  Timeout: "timeout",
  /** Context window overflow (compress + retry). */
  ContextOverflow: "context_overflow",
  /** Payload too large. */
  PayloadTooLarge: "payload_too_large",
  /** Model not found / deprecated. */
  ModelNotFound: "model_not_found",
  /** Provider policy blocked the request. */
  ProviderPolicyBlocked: "provider_policy_blocked",
  /** Content policy blocked the response. */
  ContentPolicyBlocked: "content_policy_blocked",
  /** Response format was unparseable. */
  FormatError: "format_error",
  /** Tool-level error (tool threw). */
  ToolError: "tool_error",
  /** Unknown/unexpected error. */
  Unknown: "unknown",
} as const

export type FailoverReason = (typeof FailoverReason)[keyof typeof FailoverReason]

/**
 * Classified error with recovery hints (借鉴 hermes-agent ClassifiedError).
 * The runtime retry loop dispatches on these hints rather than re-inspecting
 * the raw error message.
 */
export interface ClassifiedError {
  reason: FailoverReason
  /** Human-readable message (first 200 chars). */
  message: string
  /** Whether this error is retryable (default: true). */
  retryable: boolean
  /** Whether the request should be compressed before retry. */
  shouldCompress: boolean
  /** Whether the credential should be rotated before retry. */
  shouldRotateCredential: boolean
  /** Whether to fallback to a different provider/model. */
  shouldFallback: boolean
}

/** Known rate-limit / overloaded patterns in error messages. */
const RATE_LIMIT_PATTERNS = [
  /rate.limit/i,
  /too many requests/i,
  /429/i,
  /throttl/i,
  /quota.exhaust/i,
]

/** Known auth-failure patterns. */
const AUTH_PATTERNS = [
  /unauthorized/i,
  /unauthorised/i,
  /authentication.failed/i,
  /invalid.api.key/i,
  /api.key.invalid/i,
  /403/i,
]

/** Known permanent auth patterns (don't retry). */
const AUTH_PERMANENT_PATTERNS = [
  /key.revoked/i,
  /credential.revoked/i,
  /account.deleted/i,
  /permission.denied.permanently/i,
]

/** Known billing exhaustion patterns. */
const BILLING_PATTERNS = [
  /billing/i,
  /insufficient.quota/i,
  /payment.required/i,
  /402/i,
  /exceeded.current.quota/i,
]

/** Known context overflow patterns. */
const CONTEXT_OVERFLOW_PATTERNS = [
  /context.length.exceeded/i,
  /maximum.context.length/i,
  /too many tokens/i,
  /token.limit/i,
  /context.window/i,
]

/** Known timeout patterns. */
const TIMEOUT_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /deadline.exceeded/i,
  /504/i,
]

/** Known server error patterns. */
const SERVER_ERROR_PATTERNS = [
  /internal.server.error/i,
  /500/i,
  /502/i,
  /503/i,
  /service.unavailable/i,
]

/** Known model-not-found patterns. */
const MODEL_NOT_FOUND_PATTERNS = [
  /model.not.found/i,
  /not found/i,
  /model.(unavailable|deprecated|unknown)/i,
  /404/i,
]

/** Known overloaded patterns. */
const OVERLOADED_PATTERNS = [
  /overloaded/i,
  /capacity.exceeded/i,
  /server.busy/i,
  /try.again.later/i,
]

/**
 * Classify a task error into a structured ClassifiedError.
 * Priority-ordered: permanent auth → tool errors → status-code-like patterns
 * → message patterns. Falls through to Unknown.
 *
 * Mirrors hermes-agent's classify_api_error() pipeline but simplified:
 * Maximilian tasks don't have HTTP status codes, so we route entirely on
 * the error message string.
 */
export function classifyTaskError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error)
  const msg = message.slice(0, 500) // bound

  // 1. Permanent auth — these are NEVER retryable.
  if (matchAny(msg, AUTH_PERMANENT_PATTERNS)) {
    return mkClassification("auth_permanent", msg, false, false, true, true)
  }

  // 2. Auth failures — retryable with credential rotation.
  if (matchAny(msg, AUTH_PATTERNS)) {
    return mkClassification("auth", msg, true, false, true, true)
  }

  // 3. Billing — not retryable.
  if (matchAny(msg, BILLING_PATTERNS)) {
    return mkClassification("billing", msg, false, false, false, true)
  }

  // 4. Context overflow — compress + retry, don't fallback.
  if (matchAny(msg, CONTEXT_OVERFLOW_PATTERNS)) {
    return mkClassification("context_overflow", msg, true, true, false, false)
  }

  // 5. Rate limit — retryable, no compress, no credential rotate.
  if (matchAny(msg, RATE_LIMIT_PATTERNS)) {
    return mkClassification("rate_limit", msg, true, false, false, false)
  }

  // 6. Overloaded — retryable, suggest fallback.
  if (matchAny(msg, OVERLOADED_PATTERNS)) {
    return mkClassification("overloaded", msg, true, false, false, true)
  }

  // 7. Tool-specific error prefixes — check BEFORE "not found" patterns
  //    since "ToolError: file not found" should NOT match model_not_found.
  if (msg.startsWith("[Tool Result:") || msg.includes("tool execution failed") || msg.includes("ToolError")) {
    return mkClassification("tool_error", msg, false, false, false, false)
  }

  // 8. Timeout — retryable (might be transient), don't fallback immediately.
  if (matchAny(msg, TIMEOUT_PATTERNS)) {
    return mkClassification("timeout", msg, true, false, false, false)
  }

  // 9. Server error — retryable.
  if (matchAny(msg, SERVER_ERROR_PATTERNS)) {
    return mkClassification("server_error", msg, true, false, false, true)
  }

  // 10. Model not found — suggest fallback.
  if (matchAny(msg, MODEL_NOT_FOUND_PATTERNS)) {
    return mkClassification("model_not_found", msg, false, false, false, true)
  }

  // Fallback: unknown — assume retryable.
  return mkClassification("unknown", msg, true, false, false, false)
}

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

function mkClassification(
  reason: FailoverReason,
  message: string,
  retryable: boolean,
  shouldCompress: boolean,
  shouldRotateCredential: boolean,
  shouldFallback: boolean,
): ClassifiedError {
  return { reason, message, retryable, shouldCompress, shouldRotateCredential, shouldFallback }
}