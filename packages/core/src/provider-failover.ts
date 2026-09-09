/**
 * ProviderFailoverOrchestrator — resilient multi-provider failover engine
 * (borrowed from kyegomez/swarms + VRSEN/agency-swarm failover pattern).
 *
 * Background:
 *   - kyegomez/swarms implements a priority-ordered provider list with
 *     automatic failover: when the primary provider returns 5xx / timeout /
 *     auth error, the orchestrator seamlessly retries the request against the
 *     next-healthy provider using exponential backoff with decorrelated jitter.
 *     Circuit breakers guard each provider independently so a degraded
 *     endpoint doesn't get hammered while a healthy backup sits idle.
 *   - VRSEN/agency-swarm ships a similar `after_llm` hook that rotates the
 *     active provider whenever the current one throws, combined with a small
 *     event bus emitting /failover/* telemetry so monitoring dashboards can
 *     visualize cross-provider handoffs.
 *
 * Maximilian's adaptation: a generic, event-driven orchestrator that
 *   1. wraps each provider with the existing {@link CircuitBreaker} (from
 *      `./circuit-breaker.js`) so we never re-implement CB state,
 *   2. iterates the priority queue on failures, recording last-error per
 *      provider and emitting typed {@link FailoverEvent} events on an
 *      optional {@link EventBus},
 *   3. supports per-provider retry with exponential backoff + jitter before
 *      switching to the next provider,
 *   4. stubs a health-check registration entrypoint for external pokers
 *      (e.g. a `useProviderHealth` hook pattern — no I/O here).
 *
 * Pure orchestration + timers. All LLM I/O is delegated to the injected
 * provider; this file knows nothing about HTTP or auth.
 */

import type { EventBus } from "./event-bus.js";
import {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitBreakerOptions,
  type CircuitBreakerStats,
} from "./circuit-breaker.js";

// Mirror the provider contract under the canonical failover name.
// `export type` is required by isolatedModules for re-exports.
import type { Provider } from "@max/providers";
export type { Provider as LLMProvider };

/** The failover provider interface. (Alias of `@max/providers` Provider.) */
type LLMProvider = Provider;

// ---------------------------------------------------------------------------
// Config + events
// ---------------------------------------------------------------------------

export interface ProviderFailoverConfig {
  /** Priority-ordered provider list; index 0 is primary. */
  providers: ProviderEntry[];
  /** Per-provider retry attempts before switching. Default: 2. */
  retryAttempts?: number;
  /** Exponential backoff base delay (ms). Default: 1000. */
  retryBaseDelayMs?: number;
  /** Exponential backoff ceiling (ms). Default: 30_000. */
  retryMaxDelayMs?: number;
  /** Shared options applied to each provider's circuit breaker. */
  circuitBreaker?: CircuitBreakerOptions;
  /** Probe cadence (ms) passed to health check stub. Default: 30_000. */
  healthCheckIntervalMs?: number;
}

export interface ProviderEntry {
  providerId: string;
  provider: LLMProvider;
  priority: number;
  enabled: boolean;
}

export type FailoverEvent =
  | { type: "failover:triggered"; from: string; to: string; reason: string }
  | { type: "failover:success"; provider: string }
  | { type: "failover:exhausted"; attemptedAll: string[] }
  | { type: "failover:no-healthy" };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Raised when every provider in the priority queue has been tried and all
 * failed. Carries the per-provider cause so callers can surface a rich
 * diagnostic (e.g. a "degraded providers" panel in the Dashboard).
 */
export class ProviderExhaustedError extends Error {
  /** Map of providerId → cause, in priority order. */
  readonly failures: ReadonlyArray<{ providerId: string; error: unknown }>;
  constructor(failures: ReadonlyArray<{ providerId: string; error: unknown }>) {
    const summary = failures
      .map((f) => `${f.providerId}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
      .join("; ");
    super(`All providers exhausted (${failures.length} attempted): ${summary}`);
    this.name = "ProviderExhaustedError";
    this.failures = failures;
  }
}

// ---------------------------------------------------------------------------
// Per-provider bookkeeping
// ---------------------------------------------------------------------------

interface ProviderHandle {
  entry: ProviderEntry;
  breaker: CircuitBreaker;
  consecutiveFailures: number;
  lastError?: unknown;
  lastSuccessAt?: number;
  /** Whether the (optional) health probe currently reports this as up. */
  healthy: boolean;
}

export interface ProviderFailoverStats {
  providers: Array<{
    providerId: string;
    priority: number;
    enabled: boolean;
    circuit: CircuitBreakerStats;
    consecutiveFailures: number;
    lastSuccessAt?: number;
    healthy: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class ProviderFailoverOrchestrator {
  private readonly config: Required<
    Pick<
      ProviderFailoverConfig,
      "retryAttempts" | "retryBaseDelayMs" | "retryMaxDelayMs" | "healthCheckIntervalMs"
    >
  > &
    Omit<ProviderFailoverConfig, "retryAttempts" | "retryBaseDelayMs" | "retryMaxDelayMs" | "healthCheckIntervalMs">;

  private readonly handles: ProviderHandle[];
  private readonly bus?: EventBus<FailoverEvent>;
  private healthTimer?: ReturnType<typeof setInterval>;
  private healthAbort?: AbortSignal;
  private disposed = false;

  constructor(config: ProviderFailoverConfig, eventBus?: EventBus<FailoverEvent>) {
    this.bus = eventBus;
    this.config = {
      providers: config.providers,
      retryAttempts: config.retryAttempts ?? 2,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 1000,
      retryMaxDelayMs: config.retryMaxDelayMs ?? 30_000,
      circuitBreaker: config.circuitBreaker,
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 30_000,
    };

    // Sort by priority desc so lower priority numbers come first. The caller
    // may pass an already-sorted list, but staying idempotent never hurts.
    this.handles = [...config.providers]
      .sort((a, b) => a.priority - b.priority)
      .map<ProviderHandle>((entry) => ({
        entry: { ...entry },
        breaker: new CircuitBreaker({
          ...(config.circuitBreaker ?? {}),
          label: `failover:${entry.providerId}`,
        }),
        consecutiveFailures: 0,
        healthy: true,
      }));
  }

  /**
   * Returns enabled providers whose circuit is not open, in priority order.
   * Circuit-open providers are skipped even when `enabled: true` — they
   * either recover into half-open (a probe then re-requalifies them) or
   * stay out of the active queue.
   */
  getHealthyProviders(): ProviderEntry[] {
    return this.handles
      .filter((h) => this.isHealthy(h))
      .sort((a, b) => a.entry.priority - b.entry.priority)
      .map((h) => h.entry);
  }

  /**
   * Run `fn` against the priority-ordered healthy providers. Retries the same
   * provider up to `retryAttempts` times with backoff + jitter before
   * rotating to the next one. Returns the first non-throwing result, or
   * throws {@link ProviderExhaustedError} if every provider fails.
   */
  async execute<T>(fn: (provider: LLMProvider) => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error("ProviderFailoverOrchestrator: disposed");
    const healthy = this.handles
      .filter((h) => this.isHealthy(h))
      .sort((a, b) => a.entry.priority - b.entry.priority);

    if (healthy.length === 0) {
      this.emit({ type: "failover:no-healthy" });
      throw new ProviderExhaustedError([
        { providerId: "<none>", error: new Error("No healthy providers in queue") },
      ]);
    }

    const failures: Array<{ providerId: string; error: unknown }> = [];
    const attemptedAll: string[] = [];

    let prevId: string | undefined;
    let prevError: unknown;
    for (const handle of healthy) {
      attemptedAll.push(handle.entry.providerId);
      if (prevId && prevId !== handle.entry.providerId) {
        this.emit({
          type: "failover:triggered",
          from: prevId,
          to: handle.entry.providerId,
          reason:
            prevError instanceof Error
              ? prevError.message
              : prevError !== undefined
                ? String(prevError)
                : "previous provider failed",
        });
      }
      prevId = handle.entry.providerId;

      let result: T | undefined;
      const ok = await this.retryProvider(handle, fn, (value) => {
        result = value;
      });
      if (ok && result !== undefined) {
        this.emit({ type: "failover:success", provider: handle.entry.providerId });
        return result;
      }
      failures.push({
        providerId: handle.entry.providerId,
        error: handle.lastError ?? new Error("unknown failure"),
      });
      prevError = handle.lastError;
    }

    this.emit({ type: "failover:exhausted", attemptedAll });
    throw new ProviderExhaustedError(failures);
  }

  /** Per-provider aggregate counters for observability / dashboards. */
  getStats(): ProviderFailoverStats {
    return {
      providers: this.handles
        .slice()
        .sort((a, b) => a.entry.priority - b.entry.priority)
        .map((h) => ({
          providerId: h.entry.providerId,
          priority: h.entry.priority,
          enabled: h.entry.enabled,
          circuit: h.breaker.getStats(),
          consecutiveFailures: h.consecutiveFailures,
          lastSuccessAt: h.lastSuccessAt,
          healthy: h.healthy,
        })),
    };
  }

  /**
   * Start a periodic external health probe. This method does **not** perform
   * any I/O itself — it simply provides a timed callback slot that downstream
   * integration code (e.g. a React hook or a runtime scheduler) can wire to
   * its own `useProviderHealth`-style state. When a probe reports the
   * provider as down, call `setProviderHealth(id, false)` to remove it from
   * the active queue until the next probe reports it up again.
   */
  registerHealthCheck(signal?: AbortSignal): void {
    this.healthAbort = signal;
    if (this.healthTimer !== undefined) clearInterval(this.healthTimer);
    if (signal?.aborted) return;

    // Touch once immediately then on the cadence so the UI has data fast.
    this.tickHealthCheck();
    this.healthTimer = setInterval(() => {
      if (this.disposed || this.healthAbort?.aborted) {
        this.clearTimer();
        return;
      }
      this.tickHealthCheck();
    }, this.config.healthCheckIntervalMs);

    // Don't block Node shutdown solely on this timer.
    if (typeof this.healthTimer === "object" && "unref" in this.healthTimer) {
      (this.healthTimer as NodeJS.Timeout).unref?.();
    }
    if (signal) {
      const onAbort = () => this.clearTimer();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  /** Flip the externally-tracked health flag for one provider. */
  setProviderHealth(providerId: string, healthy: boolean): void {
    const h = this.handles.find((x) => x.entry.providerId === providerId);
    if (h) h.healthy = healthy;
  }

  /** Tear down timers + per-provider circuit breakers. */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    for (const h of this.handles) {
      h.breaker.reset();
    }
  }

  // - internal -------------------------------------------------------------

  private isHealthy(h: ProviderHandle): boolean {
    if (!h.entry.enabled) return false;
    if (!h.healthy) return false;
    // Treat open circuit as unhealthy; half-open is allowed so a probe can
    // restore it.
    const s = h.breaker.getState();
    return s === "open" ? false : true;
  }

  /**
   * Retry `fn` against one provider under its circuit breaker, with
   * exponential backoff + full jitter between attempts. Stops on the first
   * success (returning `true`) or after `retryAttempts` consecutive failures
   * (returning `false`).
   */
  private async retryProvider<T>(
    handle: ProviderHandle,
    fn: (provider: LLMProvider) => Promise<T>,
    onResult: (value: T) => void,
  ): Promise<boolean> {
    const maxAttempts = Math.max(1, this.config.retryAttempts);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const value = await handle.breaker.execute(() => fn(handle.entry.provider));
        handle.consecutiveFailures = 0;
        handle.lastSuccessAt = Date.now();
        handle.lastError = undefined;
        onResult(value);
        return true;
      } catch (err) {
        handle.lastError = err;
        // A CircuitOpenError means the breaker itself tripped: don't waste
        // retries on this provider — give up immediately.
        if (err instanceof CircuitOpenError) {
          return false;
        }
        const isLastAttempt = attempt === maxAttempts;
        if (!isLastAttempt) {
          const delay = jitteredBackoff(
            this.config.retryBaseDelayMs,
            this.config.retryMaxDelayMs,
            attempt,
          );
          await sleep(delay);
        }
      }
    }
    return false;
  }

  private emit(event: FailoverEvent): void {
    this.bus?.publish(event);
  }

  /** Stubbed health placeholder — external code calls setProviderHealth. */
  private tickHealthCheck(): void {
    // No-op. Real implementations hook this via setInterval provider-supplied
    // probes, but for testing we keep it deterministic.
  }

  private clearTimer(): void {
    if (this.healthTimer !== undefined) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decorrelated jitter backoff: `min(maxDelay, randomBetween(base, prevDelay*3))`.
 * Avoids the "thundering herd" that synchronized retries cause when a pool of
 * clients all retry on the same cadence.
 *
 * Exported for unit testing — callers should prefer the orchestrator's
 * `execute()` which wires this in with per-provider retry bookkeeping.
 */
export function jitteredBackoff(baseDelayMs: number, maxDelayMs: number, attempt: number): number {
  // First attempt uses base; later attempts cap at maxDelay.
  const cap = Math.min(maxDelayMs, baseDelayMs * 3 ** (attempt - 1));
  // Uniform jitter across [0, cap] (full jitter is better than equal jitter
  // at reducing collisions when the retry cluster is large).
  return Math.max(0, Math.floor(Math.random() * cap));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
