/**
 * Integration test: withRetry wrapping withCircuitBreaker.
 *
 * The production code path is `withRetry(withCircuitBreaker(provider))` —
 * retry handles transient 429/5xx, circuit-breaker prevents retry storms
 * by opening after sustained failures. These tests verify that:
 *   1. Retries succeed when failures are intermittent (within retry budget).
 *   2. The circuit opens after the failure threshold is exceeded, even
 *      when retries are layered on top.
 *   3. The combined wrapper doesn't double-retry or break the half-open
 *      probe semantics.
 */

import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/retry.js";
import { withCircuitBreaker } from "../src/circuit-breaker.js";
import type { Provider, ChatMessage, ChatResponse } from "../src/base.js";

function makeProvider(behavior: () => Promise<ChatResponse>): Provider {
  return {
    id: "test-int",
    name: "Test Integrated",
    defaultModel: "m",
    isConfigured: () => true,
    chat: behavior,
    stream: (async function* () {}) as never,
  };
}

const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

describe("withRetry + withCircuitBreaker integration", () => {
  it("recovers after 2 transient failures (within retry budget)", async () => {
    let calls = 0;
    const chat = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls <= 2) throw new Error("rate limit 429");
      return { content: "recovered", model: "m" };
    });

    // Production layering: retry wraps circuit-breaker wraps provider.
    const p = withRetry(
      withCircuitBreaker(makeProvider(chat), {
        failureThreshold: 10, // high enough that retries don't open the circuit
        resetTimeout: 1000,
        jitter: false,
      }),
      { baseDelay: 1, maxRetries: 3, jitter: false },
    );

    const out = await p.chat(messages);
    expect(out.content).toBe("recovered");
    // 1 + 2 retries = 3 calls to the provider (2 failures + 1 success)
    expect(chat).toHaveBeenCalledTimes(3);
  });

  it("exhausts retries and surfaces the last error when failures are sustained", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("rate limit 429"));
    const p = withRetry(
      withCircuitBreaker(makeProvider(chat), {
        failureThreshold: 100, // never opens during this test
        resetTimeout: 1000,
        jitter: false,
      }),
      { baseDelay: 1, maxRetries: 2, jitter: false },
    );

    await expect(p.chat(messages)).rejects.toThrow("rate limit 429");
    // 1 initial + 2 retries = 3 attempts
    expect(chat).toHaveBeenCalledTimes(3);
  });

  it("circuit-breaker's OPEN state fails fast even when wrapped by withRetry", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("econnrefused 127.0.0.1"));
    const p = withRetry(
      withCircuitBreaker(makeProvider(chat), {
        failureThreshold: 3,
        resetTimeout: 60_000, // long enough that reset doesn't kick in
        jitter: false,
      }),
      { baseDelay: 1, maxRetries: 10, jitter: false },
    );

    // 3 failed calls open the circuit (no retries trigger because retry
    // catches the first error, retries 2 more times, then circuit has
    // seen 3 failures and opens on the 3rd call's onFailure).
    // After the 3rd call, the circuit is open.
    for (let i = 0; i < 3; i++) {
      await expect(p.chat(messages)).rejects.toThrow();
    }
    // Now the 4th call should be a fast OPEN rejection — but withRetry
    // is wrapping it. We need to see whether the retry's exhausted loop
    // sees the OPEN error. Verify the provider was called exactly 3
    // times (subsequent calls short-circuit through the breaker):
    expect(chat).toHaveBeenCalledTimes(3);
  });

  it("recovers after circuit closes via the half-open probe", async () => {
    let calls = 0;
    const chat = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls <= 3) throw new Error("etimedout");
      return { content: "ok", model: "m" };
    });
    const p = withRetry(
      withCircuitBreaker(makeProvider(chat), {
        failureThreshold: 3,
        resetTimeout: 30,
        jitter: false,
      }),
      { baseDelay: 1, maxRetries: 5, jitter: false },
    );

    // First attempt: 3 retries internally, 3 calls = circuit opens
    for (let i = 0; i < 3; i++) {
      await expect(p.chat(messages)).rejects.toThrow();
    }
    // Wait for the reset window
    await new Promise((r) => setTimeout(r, 50));
    // The next call from outside should be the half-open probe.
    const out = await p.chat(messages);
    expect(out.content).toBe("ok");
  });

  it("does not retry on non-retryable errors (4xx)", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("401 unauthorized"));
    const p = withRetry(
      withCircuitBreaker(makeProvider(chat), {
        failureThreshold: 100,
        resetTimeout: 1000,
        jitter: false,
      }),
      { baseDelay: 1, maxRetries: 5, jitter: false },
    );

    // 4xx should NOT be retried — the retry policy filters them out.
    await expect(p.chat(messages)).rejects.toThrow("401");
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
