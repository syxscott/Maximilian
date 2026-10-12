// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Inbound dead-letter layer (openclaw channel-ingress borrowing,
 * `ingress-retry-policy.ts` / `ingress-monitor.ts`): the terminal state for
 * inbound events that admission alone cannot express.
 *
 * The three-tier admission queue (lib/inbound-queue.ts) dead-letters on
 * OVERFLOW. This layer covers the other half — events that were admitted
 * but whose processing keeps failing:
 *
 *   - `shouldDeadLetter` requires BOTH floors from openclaw: attempts
 *     exhausted AND age >= deadLetterMinAgeMs. The age floor stops an old
 *     event that just got queued from being judged dead on arrival —
 *     over-limit events keep retrying (at the capped delay) until the age
 *     is met.
 *   - `classifyInboundFailure` is the non-retryable classifier: structurally
 *     invalid requests and authentication failures dead-letter immediately
 *     and never consume retry budget.
 *   - `DeadLetterRegistry` keeps a bounded dead-letter log (default 5000
 *     entries) that is pruned on a PERIODIC schedule — not scanned on every
 *     record — plus per-outcome counters for observability.
 *
 * The policy types are pure and unit-testable; the middleware wires the
 * immediate (non-retryable) path around `next()` and
 * `runInboundWithDeadLetter` provides the retry-exhaustion path for
 * pipeline-style inbound consumers.
 */

export const DEFAULT_MAX_ATTEMPTS = 5
export const DEFAULT_DEAD_LETTER_MIN_AGE_MS = 60_000
export const DEFAULT_RETENTION_CAP = 5_000
export const DEFAULT_RETENTION_AGE_MS = 24 * 60 * 60_000

export interface DeadLetterPolicyOptions {
  /** Retry attempts before an event is dead-letter eligible. */
  maxAttempts?: number
  /** Minimum age before a retry-exhausted event may be judged dead. */
  deadLetterMinAgeMs?: number
  /** Maximum dead-letter entries retained. */
  retentionCap?: number
  /** Entries older than this are dropped by the periodic prune. */
  retentionAgeMs?: number
}

export interface DeadLetterPolicy {
  readonly maxAttempts: number
  readonly deadLetterMinAgeMs: number
  readonly retentionCap: number
  readonly retentionAgeMs: number
}

export function resolveDeadLetterPolicy(opts?: DeadLetterPolicyOptions): DeadLetterPolicy {
  return {
    maxAttempts: Math.max(1, opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    deadLetterMinAgeMs: Math.max(0, opts?.deadLetterMinAgeMs ?? DEFAULT_DEAD_LETTER_MIN_AGE_MS),
    retentionCap: Math.max(1, opts?.retentionCap ?? DEFAULT_RETENTION_CAP),
    retentionAgeMs: Math.max(0, opts?.retentionAgeMs ?? DEFAULT_RETENTION_AGE_MS),
  }
}

/**
 * Dead-letter requires BOTH the attempt floor and the minimum age
 * (openclaw `shouldDeadLetterRetryableIngressEvent`). Retryable events past
 * the attempt floor keep being retried until the age floor is met too.
 */
export function shouldDeadLetter(
  facts: { attempts: number; receivedAt: number },
  policy: DeadLetterPolicy,
  now: number,
): boolean {
  return facts.attempts >= policy.maxAttempts && now - facts.receivedAt >= policy.deadLetterMinAgeMs
}

// ── Non-retryable classifier ────────────────────────────────────────────────

export type InboundFailureKind = "invalid-request" | "auth-failed" | "overload" | "transient"

export interface FailureClassification {
  readonly kind: InboundFailureKind
  /** False → dead-letter immediately without consuming retry budget. */
  readonly retryable: boolean
  readonly reason: string
}

const NON_RETRYABLE_INVALID_STATUSES: ReadonlySet<number> = new Set([
  400, 404, 405, 409, 413, 415, 422,
])

/**
 * Read an HTTP-ish status off an error without assuming a Hono type:
 * `status` / `statusCode` numeric fields cover HTTPException and fetch
 * `Response`-shaped errors.
 */
function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined
  const candidate = err as { status?: unknown; statusCode?: unknown }
  for (const value of [candidate.status, candidate.statusCode]) {
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

/**
 * Classify one failure status. Structurally invalid outcomes
 * (schema/parse violations, unknown routes, bad bodies) and authentication
 * failures are terminal — retrying them only burns budget, so they
 * dead-letter immediately. Everything else is treated as transient.
 */
export function classifyFailureStatus(status: number): FailureClassification {
  if (status === 401 || status === 403) {
    return { kind: "auth-failed", retryable: false, reason: "auth-failed" }
  }
  if (NON_RETRYABLE_INVALID_STATUSES.has(status)) {
    return { kind: "invalid-request", retryable: false, reason: `invalid-request (${status})` }
  }
  if (status === 429 || status === 503) {
    return { kind: "overload", retryable: true, reason: `overload (${status})` }
  }
  return { kind: "transient", retryable: true, reason: "transient-failure" }
}

/**
 * Classify an inbound processing failure. Structurally invalid requests
 * (schema/parse violations, unknown routes, bad bodies) and authentication
 * failures are terminal — retrying them only burns budget, so they
 * dead-letter immediately. Everything else is treated as transient.
 */
export function classifyInboundFailure(err: unknown): FailureClassification {
  const status = statusOf(err)
  if (status !== undefined) return classifyFailureStatus(status)
  if (err instanceof SyntaxError) {
    // Unparseable payloads (JSON.parse) are structural, not transient.
    return { kind: "invalid-request", retryable: false, reason: "unparseable-payload" }
  }
  return { kind: "transient", retryable: true, reason: "transient-failure" }
}

// ── Dead-letter registry ────────────────────────────────────────────────────

/** Why an entry reached the terminal state. */
export type DeadLetterCause = "non-retryable" | "retry-limit-exceeded"

export interface DeadLetterEntry {
  readonly id: string
  readonly cause: DeadLetterCause
  /** Classification reason ("auth-failed", "invalid-request (422)", …). */
  readonly reason: string
  readonly message: string
  /** Completed attempts when the entry was judged dead. */
  readonly attempts: number
  readonly receivedAt: string
  readonly deadLetteredAt: string
}

export interface DeadLetterCounters {
  /** Entries judged dead — non-retryable or retry-exhausted. */
  readonly deadLettered: number
  /** Subset of deadLettered that failed the non-retryable classifier. */
  readonly nonRetryable: number
  /** Oldest entries evicted because the retention cap was exceeded. */
  readonly evicted: number
  /** Entries removed by pruneOlderThan / periodic prune. */
  readonly pruned: number
}

export interface DeadLetterSnapshot extends DeadLetterCounters {
  readonly size: number
  readonly retentionCap: number
}

let deadLetterSeq = 0

export class DeadLetterRegistry {
  readonly policy: DeadLetterPolicy
  private readonly entries: DeadLetterEntry[] = []
  private readonly now: () => number
  private readonly counters = {
    deadLettered: 0,
    nonRetryable: 0,
    evicted: 0,
    pruned: 0,
  }
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  constructor(policyOpts?: DeadLetterPolicyOptions, opts?: { now?: () => number }) {
    this.policy = resolveDeadLetterPolicy(policyOpts)
    this.now = opts?.now ?? Date.now
  }

  /**
   * Record one terminal failure. Entries are capped FIFO: when the
   * retention cap is exceeded the OLDEST entry is evicted (counted, not
   * silently lost). No pruning happens here — that is the periodic
   * prune's job, not a scan per record.
   */
  record(input: {
    cause: DeadLetterCause
    classification?: FailureClassification
    attempts: number
    receivedAt: number
    message?: string
  }): DeadLetterEntry {
    deadLetterSeq += 1
    const at = new Date(this.now()).toISOString()
    const entry: DeadLetterEntry = {
      id: `dl_${deadLetterSeq}`,
      cause: input.cause,
      reason: input.classification?.reason ?? input.cause,
      message: input.message ?? input.classification?.reason ?? input.cause,
      attempts: input.attempts,
      receivedAt: new Date(input.receivedAt).toISOString(),
      deadLetteredAt: at,
    }
    this.entries.push(entry)
    this.counters.deadLettered += 1
    if (input.cause === "non-retryable") this.counters.nonRetryable += 1
    while (this.entries.length > this.policy.retentionCap) {
      this.entries.shift()
      this.counters.evicted += 1
    }
    return entry
  }

  /** Drop entries dead-lettered longer than the retention age ago. */
  pruneOlderThan(now: number = this.now()): number {
    const cutoff = now - this.policy.retentionAgeMs
    let removed = 0
    // Entries are append-ordered by deadLetteredAt, so the oldest sit at
    // the front; drop from the front while they are past the cutoff.
    while (this.entries.length > 0) {
      const oldest = this.entries[0]
      if (oldest === undefined || Date.parse(oldest.deadLetteredAt) >= cutoff) break
      this.entries.shift()
      removed += 1
    }
    this.counters.pruned += removed
    return removed
  }

  /**
   * Start the periodic prune. Returns a stop function; the timer never
   * holds the process open.
   */
  startPeriodicPrune(intervalMs: number): () => void {
    this.stopPeriodicPrune()
    this.pruneTimer = setInterval(() => this.pruneOlderThan(), Math.max(1, intervalMs))
    this.pruneTimer.unref?.()
    return () => this.stopPeriodicPrune()
  }

  stopPeriodicPrune(): void {
    if (this.pruneTimer === null) return
    clearInterval(this.pruneTimer)
    this.pruneTimer = null
  }

  /** Retained entries, oldest first, up to `limit` (default all). */
  list(limit?: number): DeadLetterEntry[] {
    const slice =
      limit !== undefined && limit >= 0 ? this.entries.slice(0, limit) : [...this.entries]
    return slice
  }

  snapshot(): DeadLetterSnapshot {
    return {
      ...this.counters,
      size: this.entries.length,
      retentionCap: this.policy.retentionCap,
    }
  }
}

// ── Retry-exhaustion driver ─────────────────────────────────────────────────

export interface InboundDeadLetterRunOptions<T> {
  /** One processing attempt. Receives the 1-based attempt number. */
  work: (attempt: number) => Promise<T>
  /** Override the default classifier (tests / domain-specific causes). */
  classify?: (err: unknown) => FailureClassification
  /** Inter-attempt sleep. Default: real setTimeout. */
  sleep?: (ms: number) => Promise<void>
  /** Backoff before the next attempt. Default: 1s, 2s, 4s… capped at 30s. */
  backoffMs?: (attempt: number) => number
}

function defaultBackoff(completedAttempts: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, completedAttempts - 1))
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    t.unref?.()
  })
}

/**
 * Run inbound work with the openclaw retry/dead-letter doctrine: failures
 * classified non-retryable dead-letter immediately; retryable failures
 * retry until BOTH the attempt and age floors are met, then dead-letter.
 * The triggering error always propagates to the caller — the registry is
 * the observability terminal state, not a suppression layer.
 */
export async function runInboundWithDeadLetter<T>(
  registry: DeadLetterRegistry,
  receivedAt: number,
  opts: InboundDeadLetterRunOptions<T>,
  now: () => number = Date.now,
): Promise<T> {
  const classify = opts.classify ?? classifyInboundFailure
  const sleep = opts.sleep ?? defaultSleep
  const backoffMs = opts.backoffMs ?? defaultBackoff
  const policy = registry.policy

  let attempt = 0
  for (;;) {
    attempt += 1
    try {
      return await opts.work(attempt)
    } catch (err) {
      const classification = classify(err)
      if (!classification.retryable) {
        registry.record({
          cause: "non-retryable",
          classification,
          attempts: attempt,
          receivedAt,
          message: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
      if (shouldDeadLetter({ attempts: attempt, receivedAt }, policy, now())) {
        registry.record({
          cause: "retry-limit-exceeded",
          classification,
          attempts: attempt,
          receivedAt,
          message: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
      await sleep(backoffMs(attempt))
    }
  }
}
