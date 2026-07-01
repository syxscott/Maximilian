// Error types — plain TypeScript
// Derived from OpenCode packages/llm/src/schema/errors.ts

import type { ModelID, ProviderMetadata, ProviderID, RouteID } from "./types.js"

export type ProviderFailureClassification = "context-overflow"

// ── HTTP Details ──

export interface HttpRequestDetails {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string>
}

export interface HttpResponseDetails {
  readonly status: number
  readonly headers: Record<string, string>
}

export interface HttpRateLimitDetails {
  readonly retryAfterMs?: number
  readonly limit?: Record<string, string>
  readonly remaining?: Record<string, string>
  readonly reset?: Record<string, string>
}

export interface HttpContext {
  readonly request: HttpRequestDetails
  readonly response?: HttpResponseDetails
  readonly body?: string
  readonly bodyTruncated?: boolean
  readonly requestId?: string
  readonly rateLimit?: HttpRateLimitDetails
}

// ── Error Reasons ──

export type LLMErrorReason =
  | InvalidRequestReason
  | NoRouteReason
  | AuthenticationReason
  | RateLimitReason
  | QuotaExceededReason
  | ContentPolicyReason
  | ProviderInternalReason
  | TransportReason
  | InvalidProviderOutputReason
  | UnknownProviderReason

export interface InvalidRequestReason {
  readonly _tag: "InvalidRequest"
  readonly message: string
  readonly retryable: false
  readonly context?: HttpContext
}

export interface NoRouteReason {
  readonly _tag: "NoRoute"
  readonly message: string
  readonly retryable: false
}

export interface AuthenticationReason {
  readonly _tag: "Authentication"
  readonly message: string
  readonly retryable: false
  readonly context?: HttpContext
}

export interface RateLimitReason {
  readonly _tag: "RateLimit"
  readonly message: string
  readonly retryable: true
  readonly retryAfterMs?: number
  readonly context?: HttpContext
}

export interface QuotaExceededReason {
  readonly _tag: "QuotaExceeded"
  readonly message: string
  readonly retryable: false
  readonly context?: HttpContext
}

export interface ContentPolicyReason {
  readonly _tag: "ContentPolicy"
  readonly message: string
  readonly retryable: false
  readonly context?: HttpContext
}

export interface ProviderInternalReason {
  readonly _tag: "ProviderInternal"
  readonly message: string
  readonly retryable: true
  readonly context?: HttpContext
}

export interface TransportReason {
  readonly _tag: "Transport"
  readonly message: string
  readonly retryable: true
  readonly context?: HttpContext
}

export interface InvalidProviderOutputReason {
  readonly _tag: "InvalidProviderOutput"
  readonly message: string
  readonly retryable: false
}

export interface UnknownProviderReason {
  readonly _tag: "UnknownProvider"
  readonly message: string
  readonly retryable: boolean
}

// ── LLM Error ──

export class LLMError extends Error {
  readonly _tag = "LLMError"
  readonly module: string
  readonly method: string
  readonly reason: LLMErrorReason

  constructor(opts: { module: string; method: string; reason: LLMErrorReason }) {
    super(`${opts.module}.${opts.method}: ${opts.reason.message}`)
    this.name = "LLMError"
    this.module = opts.module
    this.method = opts.method
    this.reason = opts.reason
  }

  get retryable(): boolean {
    return this.reason.retryable
  }

  get retryAfterMs(): number | undefined {
    return "retryAfterMs" in this.reason ? (this.reason as RateLimitReason).retryAfterMs : undefined
  }
}

// ── Tool Failure ──

export class ToolFailure extends Error {
  readonly _tag = "ToolFailure"
  readonly metadata?: Record<string, unknown>

  constructor(opts: { message: string; error?: unknown; metadata?: Record<string, unknown> }) {
    super(opts.message)
    this.name = "ToolFailure"
    this.metadata = opts.metadata
    if (opts.error !== undefined) {
      this.cause = opts.error
    }
  }
}

// ── Context Overflow Detection ──

const CONTEXT_OVERFLOW_PATTERNS = [
  /context.{0,20}(length|window|limit|size)/i,
  /max.{0,20}(tokens|length)/i,
  /token.{0,20}limit/i,
  /too.{0,20}long/i,
  /exceeds?.{0,20}maximum/i,
  /request.{0,20}too.{0,20}large/i,
  /prompt.{0,20}is.{0,20}too.{0,20}long/i,
]

export function isContextOverflow(error: unknown): boolean {
  if (error instanceof LLMError && error.reason._tag === "InvalidRequest") {
    const msg = error.reason.message.toLowerCase()
    return CONTEXT_OVERFLOW_PATTERNS.some((p) => p.test(msg))
  }
  return false
}

export function isContextOverflowFailure(error: unknown): boolean {
  if (error instanceof LLMError) {
    return error.reason._tag === "InvalidRequest" && isContextOverflow(error)
  }
  return false
}
