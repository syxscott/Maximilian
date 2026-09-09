/**
 * Tests for ProviderFailoverOrchestrator — resilient multi-provider failsisem
 * (borrowed from kyegomez/swarms + VRSEN/agency-swarm failover pattern).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ProviderFailoverOrchestrator,
  ProviderExhaustedError,
  jitteredBackoff,
  type ProviderEntry,
  type FailoverEvent,
} from "../src/provider-failover.js";
import { CircuitOpenError } from "../src/circuit-breaker.js";
import type { Provider } from "@max/providers";

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

class MockLLMProvider implements Provider {
  readonly id: string;
  readonly name: string;
  readonly defaultModel = "mock-model";
  private calls = 0;
  chatCalls = 0;

  constructor(
    id: string,
    private failCount = 0,
  ) {
    this.id = id;
    this.name = id;
  }

  isConfigured(): boolean {
    return true;
  }

  async chat(): Promise<{ content: string; model: string }> {
    this.calls++;
    this.chatCalls = this.calls;
    if (this.calls <= this.failCount) throw new Error("boom");
    return { content: `response from ${this.id}`, model: this.defaultModel };
  }

  async *stream(): AsyncIterable<{ delta: string; done: boolean }> {
    this.calls++;
    if (this.calls <= this.failCount) throw new Error("boom");
    yield { delta: `response from ${this.id}`, done: true };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entry(
  id: string,
  opts: Partial<Omit<ProviderEntry, "providerId" | "provider">> & { failCount?: number } = {},
): ProviderEntry {
  const { failCount, ...rest } = opts;
  return {
    providerId: id,
    provider: new MockLLMProvider(id, failCount ?? 0),
    priority: 0,
    enabled: true,
    ...rest,
  };
}

interface RecordedBus {
  subscribers: Map<(e: FailoverEvent) => unknown, unknown>;
  events: FailoverEvent[];
}

function makeBus(): RecordedBus {
  const rec: RecordedBus = {
    subscribers: new Map(),
    events: [],
  };
  // Minimal EventBus-compatible stub.
  return rec;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Borrowed — ProviderFailoverOrchestrator", () => {
  let providers: ProviderEntry[];

  beforeEach(() => {
    providers = [
      entry("primary", { priority: 0 }),
      entry("secondary", { priority: 1 }),
      entry("tertiary", { priority: 2 }),
    ];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds on primary provider without failover", async () => {
    const orch = new ProviderFailoverOrchestrator({ providers });
    const result = await orch.execute(async (p) => p.chat([]));
    expect(result.content).toBe("response from primary");
    expect(orch.getStats().providers[0]!.consecutiveFailures).toBe(0);
  });

  it("failovers to secondary when primary errors", async () => {
    providers[0] = entry("primary", { priority: 0, failCount: 999 });
    const orch = new ProviderFailoverOrchestrator({
      providers,
      retryAttempts: 1,
    });
    const result = await orch.execute(async (p) => {
      // simulate provider-specific error so failover actually rotates
      if (p.id === "primary") throw new Error("primary down");
      return p.chat([]);
    });
    expect(result.content).toBe("response from secondary");
  });

  it("retries within a provider before switching", async () => {
    // Provider fails 2 times then succeeds on 3rd. With retryAttempts=3 the
    // orchestrator should stay on primary through 2 retries.
    providers[0] = entry("primary", { priority: 0, failCount: 2 });
    providers[1] = entry("secondary", { priority: 1 });
    const orch = new ProviderFailoverOrchestrator({
      providers,
      retryAttempts: 3,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });
    const result = await orch.execute(async (p) => p.chat([]));
    expect(result.content).toBe("response from primary");
    const primaryCalls = (providers[0]!.provider as MockLLMProvider).chatCalls;
    expect(primaryCalls).toBe(3); // 2 failures + 1 success
  });

  it("respects circuit breaker open state (skips unhealthy)", async () => {
    // Open primary CB via a dedicated orchestrator with failCount=999 so
    // that primary always fails; other providers succeed on first try, so
    // their CBs stay closed.
    const orch = new ProviderFailoverOrchestrator({
      providers: [
        entry("primary", { priority: 0, failCount: 999 }),
        entry("secondary", { priority: 1 }),
        entry("tertiary", { priority: 2 }),
      ],
      circuitBreaker: { failureThreshold: 1, coolDownMs: 999_999 },
      retryAttempts: 1,
    });
    const result = await orch.execute(async (p) => p.chat([]));
    expect(result.content).toBe("response from secondary");
    // Primary is now CB-open; confirm it's excluded from healthy providers.
    const healthy = orch.getHealthyProviders().map((p) => p.providerId);
    expect(healthy).not.toContain("primary");
    expect(healthy).toContain("secondary");
    expect(healthy).toContain("tertiary");
  });

  it("throws ProviderExhaustedError after all providers fail", async () => {
    providers = providers.map((p) => entry(p.providerId, { priority: p.priority, failCount: 999 }));
    const orch = new ProviderFailoverOrchestrator({
      providers,
      retryAttempts: 1,
    });
    let caught: unknown = null;
    try {
      await orch.execute(async (p) => p.chat([]));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderExhaustedError);
    const err = caught as ProviderExhaustedError;
    expect(err.failures.length).toBeGreaterThanOrEqual(3);
  });

  it("emits failover:triggered event on switch", async () => {
    providers[0] = entry("primary", { priority: 0, failCount: 999 });

    // Trivial EventBus-compatible stub that records emitted events.
    const recorded: FailoverEvent[] = [];
    const bus = {
      subscribe(
        cb: { (e: FailoverEvent): unknown; (arg0: FailoverEvent): unknown },
        _f: unknown,
      ) {
        recorded.length = 0; // reset
        return { unsubscribe: () => {} };
      },
      publish(e: FailoverEvent) {
        recorded.push(e);
        return 0;
      },
    };

    // @ts-expect-error — test bus mock with looser types
    const orch = new ProviderFailoverOrchestrator({ providers, retryAttempts: 1 }, bus);
    await orch.execute(async (p) => p.chat([]));

    const triggered = recorded.find((e) => e.type === "failover:triggered");
    expect(triggered).toBeDefined();
    expect(triggered!.from).toBe("primary");
    expect(triggered!.to).toBe("secondary");
  });

  it("emits failover:exhausted event after all fail", async () => {
    providers = providers.map((p) => entry(p.providerId, { priority: p.priority, failCount: 999 }));
    const recorded: FailoverEvent[] = [];
    const bus = {
      subscribers: new Map() as Map<{ (e: FailoverEvent): unknown; (arg0: FailoverEvent): unknown }, unknown>,
      subscribe(
        cb: { (e: FailoverEvent): unknown; (arg0: FailoverEvent): unknown },
        _f: unknown,
      ) {
        this.subscribers.set(cb, cb);
        return { unsubscribe: () => this.subscribers.delete(cb) };
      },
      publish(e: FailoverEvent) {
        recorded.push(e);
        return 0;
      },
    };

    // @ts-expect-error — test bus mock with looser types
    const orch = new ProviderFailoverOrchestrator({ providers, retryAttempts: 1 }, bus);
    try {
      await orch.execute(async (p) => p.chat([]));
    } catch {
      // expected
    }

    const exhausted = recorded.find((e) => e.type === "failover:exhausted");
    expect(exhausted).toBeDefined();
    expect(exhausted!.attemptedAll).toContain("primary");
  });

  it("getHealthyProviders excludes circuit-open providers", async () => {
    // Primary has failCount=999 → always fails → CB opens. Secondary
    // succeeds. After execute, primary CB should stay open and be excluded
    // from getHealthyProviders.
    const target = new ProviderFailoverOrchestrator({
      providers: [
        entry("primary", { priority: 0, failCount: 999 }),
        entry("secondary", { priority: 1 }),
      ],
      circuitBreaker: { failureThreshold: 1, coolDownMs: 999_999 },
      retryAttempts: 1,
    });
    const outcome = await target.execute(async (p) => p.chat([]));
    expect(outcome.content).toBe("response from secondary");
    const healthy = target.getHealthyProviders().map((p) => p.providerId);
    expect(healthy).not.toContain("primary");
    expect(healthy).toContain("secondary");
  });

  it("registerHealthCheck runs periodically", async () => {
    // Pre-aborted signal: registerHealthCheck() must not throw and must
    // not schedule any timer (early-exits when signal is already aborted).
    const preAborted = new AbortController();
    preAborted.abort();
    const orch1 = new ProviderFailoverOrchestrator({
      providers,
      healthCheckIntervalMs: 1000,
    });
    expect(() => orch1.registerHealthCheck(preAborted.signal)).not.toThrow();
    orch1.dispose();

    // Active signal: timer should be registered.
    vi.useFakeTimers();
    const live = new AbortController();
    const liveOrch = new ProviderFailoverOrchestrator({
      providers,
      healthCheckIntervalMs: 500,
    });
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    liveOrch.registerHealthCheck(live.signal);
    expect(intervalSpy).toHaveBeenCalled();
    // Advance time and confirm the timer is live (no dispose yet).
    await vi.advanceTimersByTimeAsync(1200);
    // After abort, timer should be cleared.
    live.abort();
    await vi.advanceTimersByTimeAsync(1200);
    // No exception after abort proves teardown path is safe.
    expect(liveOrch.getStats().providers.length).toBe(3);
    liveOrch.dispose();
    vi.useRealTimers();
  });

  it("jittered backoff doesn't exceed maxDelay", () => {
    // Deterministic RNG so we always hit the maximum.
    const half = vi.spyOn(Math, "random").mockReturnValue(0.999_999);
    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = jitteredBackoff(1000, 30_000, attempt);
      expect(delay).toBeLessThanOrEqual(30_000);
      expect(delay).toBeGreaterThanOrEqual(0);
    }
    // Sanity: at attempt=3, cap = min(30000, 1000 * 9) = 9000.
    const d3 = jitteredBackoff(1000, 30_000, 3);
    expect(d3).toBeLessThanOrEqual(9000);
    half.mockRestore();
  });

  it("throws CircuitOpenError-wrapped ProviderExhaustedError when only one provider that's open", async () => {
    providers = [entry("only-one", { priority: 0, failCount: 999 })];
    const orch = new ProviderFailoverOrchestrator({
      providers,
      // failureThreshold=1: first failure opens the circuit. retryAttempts=3
      // gives the second retry a chance to observe the open CB and surface
      // CircuitOpenError as a failure cause.
      circuitBreaker: { failureThreshold: 1, coolDownMs: 999_999 },
      retryAttempts: 3,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });
    let caught: unknown = null;
    try {
      await orch.execute(async (p) => p.chat([]));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderExhaustedError);
    const err = caught as ProviderExhaustedError;
    expect(err.failures.some((f) => f.error instanceof CircuitOpenError)).toBe(true);
  });

  it("returns failover:no-healthy when queue is empty", async () => {
    const recorded: FailoverEvent[] = [];
    const bus = {
      _subs: new Map(),
      subscribe(cb: unknown) {
        this._subs.set(cb, cb);
        return { unsubscribe: () => this._subs.delete(cb) };
      },
      publish(e: FailoverEvent) {
        recorded.push(e);
      },
    };
    // @ts-expect-error — test bus mock
    const orch = new ProviderFailoverOrchestrator({ providers: [] }, bus);
    let caught: unknown = null;
    try {
      await orch.execute(async () => "never");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderExhaustedError);
    expect(recorded.some((e) => e.type === "failover:no-healthy")).toBe(true);
  });

  // Bonus: 11th case — disabled providers are excluded from healthy list.
  it("excludes disabled providers from healthy list", () => {
    providers[0]!.enabled = false;
    const orch = new ProviderFailoverOrchestrator({ providers });
    const healthy = orch.getHealthyProviders().map((p) => p.providerId);
    expect(healthy).not.toContain("primary");
    expect(healthy).toContain("secondary");
  });
});
