/**
 * Retry policy types and resolution — 借鉴 deepseek-harness llm/src/retry-policy.ts.
 *
 * Provides typed backoff configuration and two policy modes:
 *   - 'normal': retry up to maxRetries, backing off exponentially
 *   - 'always': retry until success/cancellation/timeout
 */

// ── Default Constants ─────────────────────────────────────────────────────

/** Well-known retryable error codes (借鉴 deepseek-harness DEFAULT_RETRYABLE_CODES). */
export const DEFAULT_RETRYABLE_CODES = Object.freeze([
  "EMPTY_RESPONSE",
  "RATE_LIMIT",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT",
] as const)

const DEFAULT_RETRYABLE_STATUSES = Object.freeze([429, 500, 501, 502, 503, 504] as const)

const DEFAULT_NORMAL_BACKOFF = Object.freeze({
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitterRatio: 0.1,
} as const)

const DEFAULT_ALWAYS_BACKOFF = Object.freeze({
  initialDelayMs: 500,
  maxDelayMs: 60_000,
  jitterRatio: 0.1,
} as const)

// ── Backoff Config ─────────────────────────────────────────────────────

/**
 * Bounded exponential backoff configuration.
 * All fields are optional — defaults are applied by resolveRetryPolicy.
 */
export interface BackoffConfig {
  /** Initial delay in milliseconds (default: 1000 for normal, 500 for always). */
  readonly initialDelayMs?: number
  /** Maximum delay in milliseconds (default: 30000 for normal, 60000 for always). */
  readonly maxDelayMs?: number
  /** Symmetric random multiplier range around one (default: 0.1). */
  readonly jitterRatio?: number
}

// ── Policy Config ──────────────────────────────────────────────────────

/**
 * Normal retry policy: retry up to maxRetries on transient failures.
 */
export interface NormalRetryPolicyConfig {
  readonly kind: "normal"
  /** Maximum retry attempts after the initial call (default: 2). */
  readonly maxRetries?: number
  readonly backoff?: BackoffConfig
  /** HTTP status codes considered retryable (default: 429, 500-504). */
  readonly retryableStatuses?: ReadonlyArray<number>
  /** Error codes considered retryable (default: DEFAULT_RETRYABLE_CODES). */
  readonly retryableCodes?: ReadonlyArray<string>
}

/**
 * Always-retry policy: keep retrying until success, cancellation, or hard timeout.
 */
export interface AlwaysRetryPolicyConfig {
  readonly kind: "always"
  /** Hard timeout in milliseconds (required). */
  readonly timeoutMs: number
  readonly backoff?: BackoffConfig
  readonly retryableStatuses?: ReadonlyArray<number>
  readonly retryableCodes?: ReadonlyArray<string>
}

export type RetryPolicyConfig = NormalRetryPolicyConfig | AlwaysRetryPolicyConfig

// ── Resolved Policy ────────────────────────────────────────────────────

export interface ResolvedRetryBackoff {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly jitterRatio: number
}

export interface ResolvedNormalRetryPolicy extends ResolvedRetryBackoff {
  readonly kind: "normal"
  readonly maxRetries: number
  readonly retryableStatuses: readonly number[]
  readonly retryableCodes: readonly string[]
}

export interface ResolvedAlwaysRetryPolicy extends ResolvedRetryBackoff {
  readonly kind: "always"
  readonly timeoutMs: number
  readonly retryableStatuses: readonly number[]
  readonly retryableCodes: readonly string[]
}

export type ResolvedRetryPolicy = ResolvedNormalRetryPolicy | ResolvedAlwaysRetryPolicy

// ── Validation ─────────────────────────────────────────────────────────

const NORMAL_POLICY_KEYS = Object.freeze(
  new Set(["kind", "maxRetries", "retryableStatuses", "retryableCodes", "backoff"]),
)
const ALWAYS_POLICY_KEYS = Object.freeze(
  new Set(["kind", "timeoutMs", "retryableStatuses", "retryableCodes", "backoff"]),
)
const BACKOFF_KEYS = Object.freeze(new Set(["initialDelayMs", "maxDelayMs", "jitterRatio"]))

function validateKeys(value: object, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${path}: unknown key "${key}"`)
    }
  }
}

// ── Resolution ────────────────────────────────────────────────────────

function resolveBackoff(
  raw?: BackoffConfig,
  defaults?: Readonly<{ initialDelayMs: number; maxDelayMs: number; jitterRatio: number }>,
): ResolvedRetryBackoff {
  return Object.freeze({
    initialDelayMs: raw?.initialDelayMs ?? defaults?.initialDelayMs ?? 1_000,
    maxDelayMs: raw?.maxDelayMs ?? defaults?.maxDelayMs ?? 30_000,
    jitterRatio: raw?.jitterRatio ?? defaults?.jitterRatio ?? 0.1,
  })
}

/**
 * Validate and default a RetryPolicyConfig to a fully-resolved ResolvedRetryPolicy.
 *
 * @param config - the raw policy config (omit optional fields for defaults). Pass undefined to get defaults.
 * @param _path - dot-notation path for error context (unused, for future diagnostics)
 */
export function resolveRetryPolicy(
  config: RetryPolicyConfig | undefined,
  _path?: string,
): ResolvedRetryPolicy {
  if (config === undefined) {
    return Object.freeze({
      kind: "normal",
      maxRetries: 2,
      retryableStatuses: DEFAULT_RETRYABLE_STATUSES,
      retryableCodes: DEFAULT_RETRYABLE_CODES,
      ...resolveBackoff(undefined, DEFAULT_NORMAL_BACKOFF),
    })
  }

  switch (config.kind) {
    case "normal": {
      validateKeys(config, NORMAL_POLICY_KEYS, "RetryPolicy")
      const maxRetries = config.maxRetries ?? 2
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
        throw new Error(
          `RetryPolicy: maxRetries must be a non-negative safe integer, got ${maxRetries}`,
        )
      }
      const backoff = resolveBackoff(config.backoff, DEFAULT_NORMAL_BACKOFF)
      return Object.freeze({
        kind: "normal",
        maxRetries,
        retryableStatuses: config.retryableStatuses
          ? Object.freeze([...config.retryableStatuses])
          : DEFAULT_RETRYABLE_STATUSES,
        retryableCodes: config.retryableCodes
          ? Object.freeze([...config.retryableCodes])
          : DEFAULT_RETRYABLE_CODES,
        initialDelayMs: backoff.initialDelayMs,
        maxDelayMs: backoff.maxDelayMs,
        jitterRatio: backoff.jitterRatio,
      })
    }
    case "always": {
      validateKeys(config, ALWAYS_POLICY_KEYS, "RetryPolicy")
      if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
        throw new Error(`RetryPolicy: timeoutMs must be a positive number, got ${config.timeoutMs}`)
      }
      const backoff = resolveBackoff(config.backoff, DEFAULT_ALWAYS_BACKOFF)
      return Object.freeze({
        kind: "always",
        timeoutMs: config.timeoutMs,
        retryableStatuses: config.retryableStatuses
          ? Object.freeze([...config.retryableStatuses])
          : DEFAULT_RETRYABLE_STATUSES,
        retryableCodes: config.retryableCodes
          ? Object.freeze([...config.retryableCodes])
          : DEFAULT_RETRYABLE_CODES,
        initialDelayMs: backoff.initialDelayMs,
        maxDelayMs: backoff.maxDelayMs,
        jitterRatio: backoff.jitterRatio,
      })
    }
  }
}
