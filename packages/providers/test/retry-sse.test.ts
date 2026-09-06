// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Retry status broadcast + SSE guard tests (opencode borrowing).
 */

import { describe, it, expect } from "vitest"
import { withRetry, describeRetryAction, type ProviderRetryStatus } from "../src/retry.js"
import { guardSse, withSseGuard, SseTimeoutError } from "../src/sse-guard.js"
import type { Provider, ChatMessage } from "../src/base.js"

function failingProvider(errorsBeforeSuccess: number): Provider {
  let calls = 0
  return {
    id: "test-provider",
    name: "Test",
    defaultModel: "m",
    isConfigured: () => true,
    async chat() {
      calls += 1
      if (calls <= errorsBeforeSuccess) throw new Error("429 too many requests")
      return { content: "ok", model: "m" }
    },

    async *stream() {
      throw new Error("ECONNRESET")
    },
  }
}

describe("retry status broadcast", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "hi" }]

  it("emits attempt/delay/action before each backoff sleep", async () => {
    const statuses: ProviderRetryStatus[] = []
    const provider = withRetry(failingProvider(2), {
      maxAttempts: 3,
      baseDelay: 1,
      jitter: false,
      onRetryStatus: (s) => statuses.push(s),
    })
    const res = await provider.chat(messages)
    expect(res.content).toBe("ok")
    expect(statuses).toHaveLength(2)
    expect(statuses[0]).toMatchObject({
      providerId: "test-provider",
      attempt: 0,
      maxAttempts: 3,
      action: "provider rate limit hit — waiting for capacity",
    })
    expect(statuses[0]!.nextRetryAt).toBeGreaterThan(Date.now() - 1000)
  })

  it("respects retry-after headers and reports the delay", async () => {
    const statuses: ProviderRetryStatus[] = []
    const provider = withRetry(failingProvider(1), {
      maxAttempts: 2,
      baseDelay: 1,
      headers: () => ({ "retry-after-ms": "250" }),
      onRetryStatus: (s) => statuses.push(s),
    })
    await provider.chat(messages)
    expect(statuses[0]!.delayMs).toBe(250)
  })

  it("does not truncate a server retry-after hint to maxDelay", async () => {
    // opencode semantics: an explicit server window wins over the local
    // backoff cap — only the 32-bit setTimeout limit may clamp it.
    const statuses: ProviderRetryStatus[] = []
    const provider = withRetry(failingProvider(1), {
      maxAttempts: 2,
      baseDelay: 1,
      headers: () => ({ "retry-after-ms": "60000" }),
      onRetryStatus: (s) => statuses.push(s),
      sleep: async () => {},
    })
    await provider.chat(messages)
    expect(statuses[0]!.delayMs).toBe(60000)
  })

  it("retries an SSE-guard timeout as a transient failure", async () => {
    // Regression: sse-guard's "SSE headers timeout …" must classify as
    // retryable (the borrowed guard×retry contract), not fail the call.
    let calls = 0
    const provider = withRetry(
      {
        id: "sse-timeout-provider",
        name: "Test",
        defaultModel: "m",
        isConfigured: () => true,
        async chat() {
          calls += 1
          if (calls === 1) throw new SseTimeoutError("SSE headers timeout after 300000ms")
          return { content: "ok", model: "m" }
        },
        async *stream() {
          throw new Error("ECONNRESET")
        },
      },
      { maxAttempts: 2, baseDelay: 1, jitter: false, sleep: async () => {} },
    )
    const res = await provider.chat(messages)
    expect(res.content).toBe("ok")
    expect(calls).toBe(2)
  })

  it("describeRetryAction maps network errors to readable actions", () => {
    expect(describeRetryAction(new Error("connect ECONNREFUSED x"))).toContain("unreachable")
    expect(describeRetryAction(new Error("socket ETIMEDOUT"))).toContain("timed out")
    expect(describeRetryAction(new Error("weird"))).toContain("transient")
  })
})

describe("guardSse", () => {
  async function* slowStream(gapsMs: number[]): AsyncIterable<number> {
    for (const gap of gapsMs) {
      await new Promise((r) => setTimeout(r, gap))
      yield gap
    }
  }

  it("passes chunks through when the stream is healthy", async () => {
    const chunks: number[] = []
    for await (const c of guardSse(slowStream([1, 1, 1]), { chunkTimeoutMs: 500 })) {
      chunks.push(c)
    }
    expect(chunks).toEqual([1, 1, 1])
  })

  it("fails fast when headers never arrive", async () => {
    async function* never(): AsyncIterable<number> {
      await new Promise((r) => setTimeout(r, 5_000))
      yield 1
    }
    await expect(async () => {
      for await (const _ of guardSse(never(), { headerTimeoutMs: 20 })) {
        void _
      }
    }).rejects.toBeInstanceOf(SseTimeoutError)
  })

  it("fails when the inter-chunk gap exceeds the window", async () => {
    const collected: number[] = []
    await expect(async () => {
      for await (const c of guardSse(slowStream([1, 200]), { chunkTimeoutMs: 50 })) {
        collected.push(c)
      }
    }).rejects.toThrow(/SSE chunk timeout/)
    expect(collected).toEqual([1])
  })

  it("closes the upstream when the consumer breaks early", async () => {
    let closed = false
    async function* stream(): AsyncIterable<number> {
      try {
        yield 1
        yield 2
      } finally {
        closed = true
      }
    }
    for await (const c of guardSse(stream(), { chunkTimeoutMs: 1_000 })) {
      void c
      break
    }
    // give the generator's finally a microtask to run
    await new Promise((r) => setTimeout(r, 1))
    expect(closed).toBe(true)
  })

  it("withSseGuard decorates stream() and leaves chat untouched", async () => {
    const inner = failingProvider(0)
    const guarded = withSseGuard(inner, { headerTimeoutMs: 1_000 })
    expect(guarded.id).toBe("test-provider")
    await expect(guarded.chat([{ role: "user", content: "hi" }])).resolves.toMatchObject({
      content: "ok",
    })
    // Upstream errors propagate through the guard untouched.
    await expect(async () => {
      for await (const _ of guarded.stream([{ role: "user", content: "hi" }])) {
        void _
      }
    }).rejects.toThrow("ECONNRESET")
  })

  it("timeout error carries phase and window", () => {
    const err = new SseTimeoutError("headers", 123)
    expect(err.phase).toBe("headers")
    expect(err.timeoutMs).toBe(123)
    expect(err.message).toContain("123")
  })
})
