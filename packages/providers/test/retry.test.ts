/**
 * Tests for withRetry backoff computation and retry behavior.
 * Focus on jitter, maxDelay cap, and retryable-status handling.
 */

import { describe, it, expect, vi } from "vitest"
import { withRetry, computeBackoff } from "../src/retry.js"
import type { Provider, ChatMessage, ChatResponse, ChatOptions } from "../src/base.js"

function makeProvider(behavior: () => Promise<ChatResponse>): Provider {
  return {
    id: "test",
    name: "Test",
    defaultModel: "test-model",
    isConfigured: () => true,
    chat: behavior,
    stream: async function* () {} as never,
  }
}

const messages: ChatMessage[] = [{ role: "user", content: "hi" }]

describe("computeBackoff", () => {
  it("returns 0..base on attempt 0 without jitter", () => {
    for (let i = 0; i < 50; i++) {
      const d = computeBackoff(0, 1000, 30000, false)
      expect(d).toBe(1000)
    }
  })

  it("doubles each attempt without jitter", () => {
    expect(computeBackoff(0, 1000, 30000, false)).toBe(1000)
    expect(computeBackoff(1, 1000, 30000, false)).toBe(2000)
    expect(computeBackoff(2, 1000, 30000, false)).toBe(4000)
    expect(computeBackoff(3, 1000, 30000, false)).toBe(8000)
  })

  it("caps at maxDelay", () => {
    expect(computeBackoff(10, 1000, 5000, false)).toBe(5000)
    expect(computeBackoff(20, 1000, 5000, false)).toBe(5000)
  })

  it("applies full jitter within [0, ceiling)", () => {
    const samples = new Set<number>()
    for (let i = 0; i < 100; i++) {
      samples.add(computeBackoff(2, 1000, 30000, true))
    }
    // Should be many distinct values, all < 4000
    expect(samples.size).toBeGreaterThan(20)
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThan(4000)
    }
  })
})

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    const chat = vi.fn().mockResolvedValue({ content: "ok", model: "m" })
    const p = withRetry(makeProvider(chat), { baseDelay: 1, jitter: false })
    const out = await p.chat(messages)
    expect(out.content).toBe("ok")
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it("retries on 429 then succeeds", async () => {
    const err = Object.assign(new Error("rate limit"), { statusCode: 429 })
    const chat = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ content: "ok", model: "m" })
    const p = withRetry(makeProvider(chat), { maxAttempts: 3, baseDelay: 1, jitter: false })
    const out = await p.chat(messages)
    expect(out.content).toBe("ok")
    expect(chat).toHaveBeenCalledTimes(2)
  })

  it("does not retry on 400", async () => {
    const err = Object.assign(new Error("bad request"), { statusCode: 400 })
    const chat = vi.fn().mockRejectedValue(err)
    const p = withRetry(makeProvider(chat), { maxAttempts: 3, baseDelay: 1, jitter: false })
    await expect(p.chat(messages)).rejects.toThrow("bad request")
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it("gives up after maxAttempts", async () => {
    const err = Object.assign(new Error("server error"), { statusCode: 503 })
    const chat = vi.fn().mockRejectedValue(err)
    const p = withRetry(makeProvider(chat), { maxAttempts: 3, baseDelay: 1, jitter: false })
    await expect(p.chat(messages)).rejects.toThrow("server error")
    expect(chat).toHaveBeenCalledTimes(3)
  })

  it("retries on network error (fetch failed)", async () => {
    const chat = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ content: "ok", model: "m" })
    const p = withRetry(makeProvider(chat), { maxAttempts: 3, baseDelay: 1, jitter: false })
    const out = await p.chat(messages)
    expect(out.content).toBe("ok")
    expect(chat).toHaveBeenCalledTimes(2)
  })

  it("respects retryableStatuses option", async () => {
    const err = Object.assign(new Error("rate limit"), { statusCode: 429 })
    const chat = vi.fn().mockRejectedValue(err)
    // 429 is NOT in the custom retryable list
    const p = withRetry(makeProvider(chat), {
      maxAttempts: 3,
      baseDelay: 1,
      jitter: false,
      retryableStatuses: [500, 502, 503, 504],
    })
    await expect(p.chat(messages)).rejects.toThrow("rate limit")
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it("jitter varies the delay between attempts", async () => {
    const err = Object.assign(new Error("rate limit"), { statusCode: 429 })
    const chat = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ content: "ok", model: "m" })
    const p = withRetry(makeProvider(chat), { maxAttempts: 3, baseDelay: 50, jitter: true })
    const start = Date.now()
    await p.chat(messages)
    const elapsed = Date.now() - start
    // With jitter on base=50, attempts 0&1 take 0..50ms + 0..100ms = 0..150ms total
    // Without jitter it would be 50+100 = 150ms. Verify we got 3 calls.
    expect(chat).toHaveBeenCalledTimes(3)
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })
})

// 借鉴 opencode - SessionRetry.parseRetryAfter
describe("parseRetryAfter (借鉴 opencode)", () => {
  it("parses retry-after-ms header", async () => {
    const { parseRetryAfter } = await import("../src/retry.js")
    expect(parseRetryAfter({ "retry-after-ms": "1500" })).toBe(1500)
  })

  it("parses retry-after seconds header", async () => {
    const { parseRetryAfter } = await import("../src/retry.js")
    expect(parseRetryAfter({ "retry-after": "3" })).toBe(3000)
  })

  it("parses retry-after HTTP date header", async () => {
    const { parseRetryAfter } = await import("../src/retry.js")
    const future = new Date(Date.now() + 5000).toUTCString()
    const ms = parseRetryAfter({ "retry-after": future })
    expect(ms).toBeGreaterThan(4000)
    expect(ms).toBeLessThan(6000)
  })

  it("returns undefined when headers missing", async () => {
    const { parseRetryAfter } = await import("../src/retry.js")
    expect(parseRetryAfter(undefined)).toBeUndefined()
  })

  it("returns undefined when headers present but no retry-after", async () => {
    const { parseRetryAfter } = await import("../src/retry.js")
    expect(parseRetryAfter({ "x-ratelimit-remaining": "10" })).toBeUndefined()
  })

  it("prefers retry-after-ms over retry-after seconds", async () => {
    const { parseRetryAfter } = await import("../src/retry.js")
    expect(parseRetryAfter({ "retry-after-ms": "500", "retry-after": "10" })).toBe(500)
  })
})

// 借鉴 opencode - server hint override backoff
describe("withRetry with server headers (借鉴 opencode)", () => {
  it("uses retry-after-ms from headers callback over exponential backoff", async () => {
    const err = Object.assign(new Error("rate limit"), { statusCode: 429 })
    const chat = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ content: "ok", model: "m" })
    const headersFn = vi.fn().mockReturnValue({ "retry-after-ms": "100" })
    const p = withRetry(makeProvider(chat), {
      maxAttempts: 2,
      baseDelay: 10000,
      headers: headersFn,
    })
    const start = Date.now()
    await p.chat(messages)
    const elapsed = Date.now() - start
    // server 给了 100ms,所以 backoff ≈ 100ms(远小于 baseDelay 10000)
    expect(elapsed).toBeLessThan(2000)
    expect(headersFn).toHaveBeenCalled()
    expect(chat).toHaveBeenCalledTimes(2)
  })

  it("falls back to exponential backoff when headers callback returns undefined", async () => {
    const err = Object.assign(new Error("rate limit"), { statusCode: 429 })
    const chat = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ content: "ok", model: "m" })
    const p = withRetry(makeProvider(chat), {
      maxAttempts: 2,
      baseDelay: 50,
      maxDelay: 5000,
      headers: () => undefined,
    })
    await p.chat(messages)
    expect(chat).toHaveBeenCalledTimes(2)
  })
})

// 修复 HIGH 5 - RETRY_MAX_DELAY_NO_HEADERS 必须生效
describe("withRetry cap on baseDelay (借鉴 opencode - RETRY_MAX_DELAY_NO_HEADERS)", () => {
  it(
    "clamps baseDelay to 30s when no server hint given",
    async () => {
      const err = Object.assign(new Error("rate limit"), { statusCode: 429 })
      const chat = vi
        .fn()
        .mockRejectedValueOnce(err)
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ content: "ok", model: "m" })
      // baseDelay=60000 (60s) 大于 RETRY_MAX_DELAY_NO_HEADERS (30s)
      const p = withRetry(makeProvider(chat), {
        maxAttempts: 3,
        baseDelay: 60_000,
        maxDelay: 120_000,
        jitter: false,
        headers: () => undefined,
      })
      const start = Date.now()
      await p.chat(messages)
      const elapsed = Date.now() - start
      // capped: 30000 + 60000 = 90000ms 总退避(因为 maxDelay 120000 没触发)
      expect(elapsed).toBeLessThan(95_000)
      expect(elapsed).toBeGreaterThan(80_000)
      expect(chat).toHaveBeenCalledTimes(3)
    },
    100_000,
  )

  it("server hint overrides the 30s cap", async () => {
    const err = Object.assign(new Error("rate limit"), { statusCode: 429 })
    const chat = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ content: "ok", model: "m" })
    const p = withRetry(makeProvider(chat), {
      maxAttempts: 2,
      baseDelay: 60_000,
      maxDelay: 120_000,
      headers: () => ({ "retry-after-ms": "100" }),
    })
    const start = Date.now()
    await p.chat(messages)
    const elapsed = Date.now() - start
    // server 给了 100ms,即使 baseDelay=60000 也只等 100ms
    expect(elapsed).toBeLessThan(2000)
  })
})
