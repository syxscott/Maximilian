/**
 * Tests for the usage aggregation logic. We don't need a running server —
 * the `aggregateUsageSummary` and `aggregateDailyUsage` functions are pure
 * and accept a list of MetricRecord rows.
 */

import { describe, it, expect } from "vitest"
import {
  resolveUsageRange,
  aggregateUsageSummary,
  aggregateDailyUsage,
  computeLatencyStats,
  type UsageRangePreset,
} from "../src/routes/usage.js"
import type { MetricRecord } from "@max/evolution"

function rec(
  overrides: Partial<MetricRecord> & {
    timestamp: string
    provider?: string
    model?: string
    tokenInput: number
    tokenOutput: number
  },
): MetricRecord {
  return {
    taskId: "t-" + Math.random().toString(36).slice(2, 8),
    agentId: "a1",
    agentRole: "general",
    executionTime: 100,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    retryCount: 0,
    provider: overrides.provider ?? "anthropic",
    model: overrides.model ?? "claude-sonnet-4-5",
    ...overrides,
  }
}

describe("resolveUsageRange", () => {
  const NOW = Date.UTC(2026, 5, 15, 12, 0, 0) // 2026-06-15T12:00:00Z

  it("'today' starts at UTC midnight and covers 1 day", () => {
    const r = resolveUsageRange("today", NOW)
    expect(new Date(r.startMs).toISOString()).toBe("2026-06-15T00:00:00.000Z")
    expect(r.endMs).toBe(NOW)
    expect(r.days).toEqual(["2026-06-15"])
  })

  it("'7d' covers 7 days ending today", () => {
    const r = resolveUsageRange("7d", NOW)
    expect(r.days).toHaveLength(7)
    expect(r.days[r.days.length - 1]).toBe("2026-06-15")
    expect(r.days[0]).toBe("2026-06-09")
  })

  it("'30d' covers 30 days ending today", () => {
    const r = resolveUsageRange("30d", NOW)
    expect(r.days).toHaveLength(30)
  })

  it("'all' returns zero start and empty days (no auto-fill)", () => {
    const r = resolveUsageRange("all", NOW)
    expect(r.startMs).toBe(0)
    expect(r.days).toEqual([])
  })
})

describe("aggregateUsageSummary", () => {
  const NOW = Date.UTC(2026, 5, 15, 12, 0, 0)
  const ISO_INSIDE = new Date(NOW - 60_000).toISOString()
  const ISO_OUTSIDE = new Date(NOW - 30 * 86_400_000).toISOString() // 30d ago

  it("excludes records outside the range", () => {
    const records = [
      rec({ timestamp: ISO_INSIDE, tokenInput: 100, tokenOutput: 50 }),
      rec({ timestamp: ISO_OUTSIDE, tokenInput: 999, tokenOutput: 999 }),
    ]
    const range = resolveUsageRange("today", NOW)
    const summary = aggregateUsageSummary(records, range, "today")
    expect(summary.totalRequests).toBe(1)
    expect(summary.totalInputTokens).toBe(100)
  })

  it("aggregates cache tokens and computes hit rate", () => {
    const records = [
      rec({
        timestamp: ISO_INSIDE,
        provider: "anthropic",
        tokenInput: 1000,
        tokenOutput: 100,
        cacheReadTokens: 900, // hits 90% of fresh input
      }),
    ]
    const range = resolveUsageRange("today", NOW)
    const summary = aggregateUsageSummary(records, range, "today")
    expect(summary.totalCacheReadTokens).toBe(900)
    // hit rate: cacheRead / (realFreshInput + cacheCreation)
    // = 900 / (1000 + 0) = 0.9
    expect(summary.cacheHitRate).toBeCloseTo(0.9, 5)
  })

  it("computes OpenAI-style hit rate correctly", () => {
    // For OpenAI, promptTokens already includes cache reads.
    const records = [
      rec({
        timestamp: ISO_INSIDE,
        provider: "openai",
        model: "gpt-4o",
        tokenInput: 1000, // includes 800 cached
        tokenOutput: 50,
        cacheReadTokens: 800,
      }),
    ]
    const range = resolveUsageRange("today", NOW)
    const summary = aggregateUsageSummary(records, range, "today")
    // realFreshInput = 1000 - 800 = 200
    // cacheHitRate = 800 / (200 + 0) = 0.8
    expect(summary.cacheHitRate).toBeCloseTo(0.8, 5)
    expect(summary.realTotalTokens).toBe(200 + 50) // 250
  })

  it("computes success rate and unpriced flag", () => {
    const records = [
      rec({
        timestamp: ISO_INSIDE,
        tokenInput: 100,
        tokenOutput: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      }),
      rec({
        timestamp: ISO_INSIDE,
        tokenInput: 100,
        tokenOutput: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      }),
      rec({
        timestamp: ISO_INSIDE,
        tokenInput: 100,
        tokenOutput: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        error: "boom",
      }),
      // unknown provider — should round to ~$0 and flag unpriced
      rec({
        timestamp: ISO_INSIDE,
        tokenInput: 100,
        tokenOutput: 50,
        provider: "unknown-provider",
        model: "mystery",
      }),
    ]
    const range = resolveUsageRange("today", NOW)
    const summary = aggregateUsageSummary(records, range, "today")
    expect(summary.totalRequests).toBe(4)
    expect(summary.successRate).toBe(0.75) // 3 ok / 4
    expect(summary.unpricedRequestCount).toBeGreaterThanOrEqual(1)
  })
})

describe("aggregateDailyUsage", () => {
  const NOW = Date.UTC(2026, 5, 15, 12, 0, 0)

  it("returns one entry per day in the range, even if empty", () => {
    const range = resolveUsageRange("7d", NOW)
    const daily = aggregateDailyUsage([], range)
    expect(daily).toHaveLength(7)
    expect(daily.every((d) => d.requestCount === 0)).toBe(true)
  })

  it("buckets records by ISO date", () => {
    const day1 = "2026-06-14T10:00:00.000Z"
    const day2 = "2026-06-15T10:00:00.000Z"
    const records = [
      rec({ timestamp: day1, tokenInput: 100, tokenOutput: 50 }),
      rec({ timestamp: day1, tokenInput: 200, tokenOutput: 100 }),
      rec({ timestamp: day2, tokenInput: 50, tokenOutput: 25 }),
    ]
    const range = resolveUsageRange("7d", NOW)
    const daily = aggregateDailyUsage(records, range)
    const d1 = daily.find((d) => d.date === "2026-06-14")
    const d2 = daily.find((d) => d.date === "2026-06-15")
    expect(d1?.requestCount).toBe(2)
    expect(d1?.totalInputTokens).toBe(300)
    expect(d2?.requestCount).toBe(1)
    expect(d2?.totalOutputTokens).toBe(25)
  })

  it("flags a day as cost-unknown when any request is unpriced", () => {
    const dayIso = "2026-06-15T10:00:00.000Z"
    const records = [
      rec({
        timestamp: dayIso,
        tokenInput: 100,
        tokenOutput: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      }),
      // unpriced model — the day's cost becomes a partial estimate
      rec({
        timestamp: dayIso,
        tokenInput: 100,
        tokenOutput: 50,
        provider: "unknown-provider",
        model: "mystery",
      }),
    ]
    const range = resolveUsageRange("7d", NOW)
    const daily = aggregateDailyUsage(records, range, (provider, model) =>
      hasExactPricingEntryForTest(provider, model),
    )
    const entry = daily.find((d) => d.date === dayIso.slice(0, 10))
    expect(entry?.totalCostUsdKnown).toBe(false)
    // untouched days stay known
    const other = daily.find((d) => d.date !== dayIso.slice(0, 10) && d.requestCount === 0)
    expect(other?.totalCostUsdKnown).toBe(true)
  })
})

// Mirror of usage.ts hasExactPricingEntry for test assertions (the real one
// is not exported; the aggregation accepts the lookup as a parameter).
function hasExactPricingEntryForTest(provider: string, model: string): boolean {
  const known: Array<[string, string]> = [
    ["anthropic", "claude-sonnet-4-5"],
    ["openai", "gpt-4o"],
  ]
  return known.some(([p, m]) => p === provider && m === model)
}

describe("computeLatencyStats", () => {
  it("returns zeros for empty input", () => {
    const stats = computeLatencyStats([])
    expect(stats).toEqual({ p50Ms: 0, p95Ms: 0, p99Ms: 0, avgMs: 0, sampleCount: 0 })
  })

  it("computes p50/p95/p99 with nearest-rank method", () => {
    // 100 samples from 1..100; sorted already.
    const samples = Array.from({ length: 100 }, (_, i) => i + 1)
    const stats = computeLatencyStats(samples)
    expect(stats.sampleCount).toBe(100)
    // p50: rank = ceil(0.50 * 100) = 50 → samples[49] = 50
    expect(stats.p50Ms).toBe(50)
    // p95: rank = ceil(0.95 * 100) = 95 → samples[94] = 95
    expect(stats.p95Ms).toBe(95)
    // p99: rank = ceil(0.99 * 100) = 99 → samples[98] = 99
    expect(stats.p99Ms).toBe(99)
    expect(stats.avgMs).toBeCloseTo(50.5, 5)
  })

  it("handles single sample", () => {
    const stats = computeLatencyStats([1234])
    expect(stats.p50Ms).toBe(1234)
    expect(stats.p95Ms).toBe(1234)
    expect(stats.p99Ms).toBe(1234)
    expect(stats.avgMs).toBe(1234)
  })

  it("includes latency stats in aggregateUsageSummary output", () => {
    const NOW = Date.UTC(2026, 5, 15, 12, 0, 0)
    const ISO = new Date(NOW - 60_000).toISOString()
    const records = [
      rec({ timestamp: ISO, executionTime: 100 }),
      rec({ timestamp: ISO, executionTime: 200 }),
      rec({ timestamp: ISO, executionTime: 300 }),
      rec({ timestamp: ISO, executionTime: 400, error: "boom" }), // excluded (failed)
    ]
    const range = resolveUsageRange("today", NOW)
    const summary = aggregateUsageSummary(records, range, "today")
    expect(summary.latency.sampleCount).toBe(3) // failed task excluded
    expect(summary.latency.p50Ms).toBe(200)
    expect(summary.latency.avgMs).toBeCloseTo(200, 5)
  })
})
