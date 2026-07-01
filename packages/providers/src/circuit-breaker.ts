import type { Provider, ChatMessage, ChatOptions, ChatResponse } from "./base.js";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Duration in ms to keep circuit open before half-open (default: 30000) */
  resetTimeout?: number;
  /** Jitter the reset window by ±20% to avoid synchronized probe storms (default: true) */
  jitter?: boolean;
}

type CircuitState = "closed" | "open" | "half-open";

/**
 * Circuit breaker for LLM providers.
 *
 * States:
 *   closed   — normal operation, requests pass through
 *   open     — too many failures, requests fail immediately
 *   half-open — testing if provider recovered, exactly one probe at a time
 *
 * All state transitions go through a single serialized chain so concurrent
 * calls cannot both see "open + elapsed" and both enter half-open as probes.
 */
export function withCircuitBreaker(provider: Provider, options?: CircuitBreakerOptions): Provider {
  const {
    failureThreshold = 5,
    resetTimeout = 30_000,
    jitter = true,
  } = options ?? {};

  let state: CircuitState = "closed";
  let failures = 0;
  let lastFailureTime = 0;
  let probeInFlight = false;
  // Per-open jittered timeout: recomputed each time the circuit opens, so
  // distinct breakers (or the same breaker across open/close cycles) don't
  // all probe in lockstep. Without this, 50 retries fired at the same
  // provider all transition open→half-open at the same instant.
  let currentResetWindow = resetTimeout;
  // Serialize all state-mutating operations. Without this, two concurrent
  // calls in `open` state could both observe `elapsed >= resetTimeout` and
  // both transition to half-open, blowing the "one probe at a time" rule.
  let chain: Promise<void> = Promise.resolve();

  function run<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = chain.then(fn);
    chain = next.then(() => undefined, () => undefined);
    return next;
  }

  function applyJitteredWindow(): void {
    if (!jitter) {
      currentResetWindow = resetTimeout;
      return;
    }
    // ±20% jitter: 0.8x..1.2x
    const factor = 0.8 + Math.random() * 0.4;
    currentResetWindow = Math.floor(resetTimeout * factor);
  }

  async function checkState(): Promise<void> {
    await run(() => {
      if (state === "open") {
        const elapsed = Date.now() - lastFailureTime;
        if (elapsed >= currentResetWindow) {
          state = "half-open";
        } else {
          const remaining = Math.ceil((currentResetWindow - elapsed) / 1000);
          throw new Error(`[${provider.id}] circuit breaker is OPEN — provider unavailable (retry in ${remaining}s)`);
        }
      }
      // In half-open: allow only one probe at a time.
      // The first request to reach here claims the probe slot atomically.
      if (state === "half-open") {
        if (probeInFlight) {
          throw new Error(`[${provider.id}] circuit breaker is HALF-OPEN — probe in flight, retry shortly`);
        }
        probeInFlight = true;
      }
    });
  }

  function onSuccess(): void {
    run(() => {
      failures = 0;
      state = "closed";
      probeInFlight = false;
    });
  }

  function onFailure(): void {
    run(() => {
      failures++;
      lastFailureTime = Date.now();
      if (failures >= failureThreshold) {
        state = "open";
        applyJitteredWindow();
      }
      // A failed probe should re-open the circuit and clear the in-flight
      // flag so the next open-window test can probe again. Apply a fresh
      // jittered window so the retry storm spreads out.
      if (state === "half-open" || probeInFlight) {
        state = "open";
        probeInFlight = false;
        applyJitteredWindow();
      }
    });
  }

  async function circuitChat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> {
    await checkState();
    try {
      const result = await provider.chat(messages, opts);
      onSuccess();
      return result;
    } catch (err) {
      onFailure();
      throw err;
    }
  }

  async function* circuitStream(messages: ChatMessage[], opts?: ChatOptions) {
    await checkState();
    try {
      for await (const chunk of provider.stream(messages, opts)) {
        yield chunk;
      }
      onSuccess();
    } catch (err) {
      onFailure();
      throw err;
    }
  }

  return {
    get id() { return provider.id; },
    get name() { return provider.name; },
    get defaultModel() { return provider.defaultModel; },
    chat: circuitChat,
    stream: circuitStream,
    embeddings: provider.embeddings?.bind(provider),
    isConfigured: provider.isConfigured.bind(provider),
  };
}
