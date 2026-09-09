/**
 * LLM Error — 借鉴 deepseek-harness LlmError.
 *
 * Carries structured failure metadata (code, status, retry-after, request-id)
 * for programmatic error classification and retry decisions.
 */

import { HarnessError } from "./error-utils.js"

// ── LlmFailure ───────────────────────────────────────────────────────────

/**
 * Structured provider or transport failure facts.
 * Carried by LlmError so callers can inspect and route on structured data.
 */
export interface LlmFailure {
  readonly message: string
  /** HTTP status returned by the provider, when available. */
  readonly status?: number
  /** Provider-requested delay in milliseconds, when available. */
  readonly providerRetryAfterMs?: number
  /** Opaque provider-issued request identifier for diagnostics. */
  readonly requestId?: string
}

// ── LlmError ─────────────────────────────────────────────────────────────

/**
 * LLM-specific error class extending HarnessError with structured failure metadata.
 */
export class LlmError extends HarnessError {
  readonly failure: LlmFailure

  constructor(
    message: string,
    code: string,
    options?: {
      readonly status?: number
      readonly providerRetryAfterMs?: number
      readonly requestId?: string
      readonly cause?: unknown
    },
  ) {
    super(message, code)
    this.name = "LlmError"
    this.failure = Object.freeze({
      message,
      status: options?.status,
      providerRetryAfterMs: options?.providerRetryAfterMs,
      requestId: options?.requestId,
    })
  }

  get status(): number | undefined {
    return this.failure.status
  }

  get providerRetryAfterMs(): number | undefined {
    return this.failure.providerRetryAfterMs
  }

  get requestId(): string | undefined {
    return this.failure.requestId
  }
}
