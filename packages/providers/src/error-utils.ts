/**
 * Error utilities — 借鉴 deepseek-harness LLM error classification.
 *
 * Provides structured error codes for retryable vs. non-retryable failures,
 * plus predicates for common provider error patterns.
 */

// ── Error Code Constants ────────────────────────────────────────────────────

/** Canonical code for context-window exceeded errors. */
export const CONTEXT_WINDOW_EXCEEDED_CODE = "CONTEXT_WINDOW_EXCEEDED"

/** Canonical code for quota/balance exhausted errors. */
export const QUOTA_EXCEEDED_CODE = "QUOTA"

/**
 * Canonical code for a response that completed normally but carried no content.
 * Distinct from an error — this is retryable as it may succeed on retry.
 */
export const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE"

/** Canonical code for a malformed API key (not absent, but unusable). */
export const INVALID_CREDENTIAL_CODE = "INVALID_CREDENTIAL"

/** Canonical code for transport/network failures. */
export const TRANSPORT_ERROR_CODE = "TRANSPORT"

// ── HarnessError Base ─────────────────────────────────────────────────────

/**
 * Base error class for all harness-derived errors.
 * Extends Error with a structured `code` field for programmatic classification.
 * Subclasses must set `this.name = SubclassName` in their constructors.
 */
export class HarnessError extends Error {
  /** Stable machine-routable error code (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

// ── Error Predicates ─────────────────────────────────────────────────────

/** Structured context-overflow wording patterns. */
const STRUCTURED_CONTEXT_OVERFLOW =
  /\bcontext[\s_-]?(?:length|window|limit)[\s_-]?(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]?exceeded)\b/i

/** Request-size wording that ties "too large" directly to model context capacity. */
const TOO_LARGE_FOR_CONTEXT =
  /\b(?:request|prompt|input|messages?)\s+(?:is\s+)?too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?(?:model(?:'s)?\s+)?context(?:\s+window)?\b/i

const EXCEEDS_MODEL_CONTEXT = new RegExp(
  String.raw`\b(?:input|prompt|messages?)\b.{0,40}` +
    String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` +
    String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`,
  "i",
)

/**
 * Recognize context-window overflow wording from provider error messages.
 * @param detail - joined provider error code/type/message text
 */
export function isContextWindowExceededError(detail: string): boolean {
  if (STRUCTURED_CONTEXT_OVERFLOW.test(detail)) return true
  if (/\bmaximum(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b/i.test(detail))
    return true
  if (TOO_LARGE_FOR_CONTEXT.test(detail)) return true
  if (EXCEEDS_MODEL_CONTEXT.test(detail)) return true
  return false
}

/**
 * Recognize quota/rate-limit exhaustion wording.
 * Distinct from a transient rate limit — this signals a billing or allocation problem.
 */
export function isQuotaExceededError(detail: string): boolean {
  if (/\binsufficient[\s_-]+(?:quota|balance|credits?)\b/i.test(detail)) return true
  if (/\b(?:quota|usage[\s_-]+limit)[\s_-]+(?:exceeded|exhausted|reached)\b/i.test(detail))
    return true
  if (/\bexceed(?:ed|s)?[\s_-]+(?:(?:your|the)[\s_-]+)?(?:current[\s_-]+)?quota\b/i.test(detail))
    return true
  if (/\b(?:balance|credits?)[\s_-]+(?:exhausted|depleted)\b/i.test(detail)) return true
  if (/\bout[\s_-]+of[\s_-]+(?:credits?|budget)\b/i.test(detail)) return true
  return false
}

/**
 * Type guard: narrow an unknown value to HarnessError.
 */
export function isHarnessError(value: unknown): value is HarnessError {
  return value instanceof HarnessError
}

// ── Error Chain Renderer ─────────────────────────────────────────────────

/**
 * Render a thrown value's full `cause` chain as a human-readable string.
 * Diagnostic use only — never parse the result; route on `HarnessError.code`.
 *
 * @param value - the caught `unknown` value
 * @returns the outermost message first, each cause appended with ` → `
 */
export function errorChain(value: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()

  let current: unknown = value
  while (current != null && !seen.has(current)) {
    seen.add(current)
    if (current instanceof Error) {
      parts.push(current.message || current.name)
      current = current.cause
    } else if (typeof current === "string") {
      parts.push(current)
      break
    } else {
      break
    }
  }

  return parts.join(" → ")
}
