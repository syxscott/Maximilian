/**
 * Circuit-breaker for streaming LLM calls (borrowed from Shannon
 * `internal/circuitbreaker/` + agentos `src/api/generateText.ts:73-81`).
 *
 * Background:
 *   - Shannon wraps Redis / gRPC / HTTP calls with a circuit breaker that
 *     tracks failures, opens after N consecutive failures, and only
 *     re-probes after a cool-down.
 *   - agentos ships `LLMProviderCircuitOpenError extends Error` carrying
 *     `httpStatus: 503` so a custom error masquerades as a real one and
 *     routes through existing `isRetryableError` checks.
 *
 * Maximilian's adaptation: a generic state-machine circuit breaker
 *   closed → open (after `failureThreshold` failures) → half-open
 *   (after `coolDownMs`) → closed (on first success).
 *
 * Pure state machine + counters. No I/O. Callers wrap their call in
 * `breaker.execute(fn)`; the breaker observes throws + success and
 * updates state accordingly. `getStats()` returns Prometheus-friendly
 * counters so the Dashboard's existing `circuit-breaker-stats` query
 * key can render the state.
 */

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Failures required to open. Default: 5. */
  failureThreshold?: number;
  /** Ms before half-open probe. Default: 30_000. */
  coolDownMs?: number;
  /** Window (ms) over which failures decay. Default: 60_000. */
  windowMs?: number;
  /** Label for stats. Default: "default". */
  label?: string;
}

export interface CircuitBreakerStats {
  label: string;
  state: CircuitState;
  totalCalls: number;
  totalSuccesses: number;
  totalFailures: number;
  totalShortCircuited: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
  failureRate: number;
}

export class CircuitOpenError extends Error {
  readonly label: string;
  readonly openedAt: number;
  readonly coolDownMs: number;
  /** Mirror agentos' LLMProviderCircuitOpenError: carries httpStatus 503. */
  readonly httpStatus = 503;
  constructor(label: string, openedAt: number, coolDownMs: number) {
    super(`Circuit "${label}" is open (opened at ${openedAt}, retry after ${coolDownMs}ms)`);
    this.name = "CircuitOpenError";
    this.label = label;
    this.openedAt = openedAt;
    this.coolDownMs = coolDownMs;
  }
}

interface FailureRecord {
  at: number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures: FailureRecord[] = [];
  private totalCalls = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private totalShortCircuited = 0;
  private lastFailureAt?: number;
  private lastSuccessAt?: number;
  private openedAt?: number;

  private readonly failureThreshold: number;
  private readonly coolDownMs: number;
  private readonly windowMs: number;
  readonly label: string;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.coolDownMs = opts.coolDownMs ?? 30_000;
    this.windowMs = opts.windowMs ?? 60_000;
    this.label = opts.label ?? "default";
  }

  getState(): CircuitState {
    this.maybeHalfOpen();
    return this.state;
  }

  /**
   * Run `fn` under the breaker. If the breaker is open, throws
   * `CircuitOpenError` immediately without calling `fn`.
   */
  async execute<T>(fn: () => Promise<T> | T): Promise<T> {
    this.maybeHalfOpen();

    if (this.state === "open") {
      this.totalShortCircuited += 1;
      throw new CircuitOpenError(this.label, this.openedAt ?? Date.now(), this.coolDownMs);
    }

    this.totalCalls += 1;
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  recordSuccess(): void {
    this.totalSuccesses += 1;
    this.lastSuccessAt = Date.now();
    // A success in half-open closes the circuit; in closed it just
    // refreshes the failure window.
    if (this.state === "half-open") {
      this.state = "closed";
      this.openedAt = undefined;
      this.failures = [];
    } else {
      this.pruneFailures();
    }
  }

  recordFailure(): void {
    this.totalFailures += 1;
    const at = Date.now();
    this.lastFailureAt = at;
    this.failures.push({ at });
    this.pruneFailures();

    if (this.state === "half-open") {
      // Probe failed — go straight back to open with a fresh cool-down.
      this.state = "open";
      this.openedAt = at;
    } else if (this.failures.length >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = at;
    }
  }

  /**
   * Force-open (e.g. for testing) or force-close (e.g. after manual
   * operator intervention).
   */
  force(state: CircuitState): void {
    this.state = state;
    if (state === "closed") {
      this.openedAt = undefined;
      this.failures = [];
    } else if (state === "open") {
      this.openedAt = Date.now();
    }
  }

  reset(): void {
    this.state = "closed";
    this.failures = [];
    this.totalCalls = 0;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
    this.totalShortCircuited = 0;
    this.lastFailureAt = undefined;
    this.lastSuccessAt = undefined;
    this.openedAt = undefined;
  }

  getStats(): CircuitBreakerStats {
    this.pruneFailures();
    const denom = this.totalSuccesses + this.totalFailures;
    return {
      label: this.label,
      state: this.getState(),
      totalCalls: this.totalCalls,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      totalShortCircuited: this.totalShortCircuited,
      ...(this.lastFailureAt !== undefined ? { lastFailureAt: this.lastFailureAt } : {}),
      ...(this.lastSuccessAt !== undefined ? { lastSuccessAt: this.lastSuccessAt } : {}),
      ...(this.openedAt !== undefined ? { openedAt: this.openedAt } : {}),
      failureRate: denom > 0 ? this.totalFailures / denom : 0,
    };
  }

  private maybeHalfOpen(): void {
    if (this.state === "open" && this.openedAt !== undefined) {
      if (Date.now() - this.openedAt >= this.coolDownMs) {
        this.state = "half-open";
      }
    }
  }

  private pruneFailures(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.failures.length > 0 && this.failures[0]!.at < cutoff) {
      this.failures.shift();
    }
  }
}