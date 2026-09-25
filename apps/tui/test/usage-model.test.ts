/**
 * Unit tests for the Usage panel's pure model layer (usage-model.ts): the
 * compact token / cost formatting behind the three-line display, including
 * the honest "—" when a window contains unpriced requests.
 */

import { describe, it, expect } from "vitest"
import {
  cacheHitRate,
  compactTokens,
  formatCostUsd,
  unpricedCount,
  usageMetrics,
} from "../src/components/usage-model"

describe("compactTokens", () => {
  it("keeps small counts plain and compacts K / M / B with stable digits", () => {
    expect(compactTokens(0)).toBe("0")
    expect(compactTokens(999)).toBe("999")
    expect(compactTokens(1000)).toBe("1.00K")
    expect(compactTokens(12_300)).toBe("12.3K")
    expect(compactTokens(456_000)).toBe("456K")
    expect(compactTokens(4_560_000)).toBe("4.56M")
    expect(compactTokens(1_230_000_000)).toBe("1.23B")
  })

  it("renders non-finite / negative / non-numeric input as an em-dash", () => {
    expect(compactTokens(Number.NaN)).toBe("—")
    expect(compactTokens(-5)).toBe("—")
    expect(compactTokens(undefined)).toBe("—")
    expect(compactTokens("123" as unknown as number)).toBe("—")
  })
})

describe("formatCostUsd", () => {
  it("prints a fixed 4-decimal dollar amount", () => {
    expect(formatCostUsd(0)).toBe("$0.0000")
    expect(formatCostUsd(1.23456)).toBe("$1.2346")
  })

  it("discloses unknown pricing and garbage with an em-dash", () => {
    expect(formatCostUsd(1.23, false)).toBe("—")
    expect(formatCostUsd(undefined, true)).toBe("—")
    expect(formatCostUsd(Number.NaN)).toBe("—")
  })
})

describe("usageMetrics (the compact three-line view model)", () => {
  it("reads totalRequests / realTotalTokens / totalCostUsd off a summary", () => {
    expect(
      usageMetrics({
        range: "today",
        totalRequests: 1234,
        totalInputTokens: 100,
        totalOutputTokens: 200,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        realTotalTokens: 1_234_567,
        totalCostUsd: 4.5678,
        successRate: 1,
        cacheHitRate: 0,
        unpricedRequestCount: 0,
        latency: { p50Ms: 0, p95Ms: 0, p99Ms: 0, avgMs: 0, sampleCount: 0 },
      }),
    ).toEqual({ requests: "1.23K", tokens: "1.23M", cost: "$4.5678" })
  })

  it("marks cost unknown when unpriced requests are in the window", () => {
    expect(
      usageMetrics({
        totalRequests: 3,
        realTotalTokens: 42,
        totalCostUsd: 1,
        totalCostUsdKnown: false,
      }),
    ).toEqual({
      requests: "3",
      tokens: "42",
      cost: "—",
    })
  })

  it("never throws on a garbage payload", () => {
    expect(usageMetrics(null)).toEqual({ requests: "0", tokens: "0", cost: "—" })
    expect(usageMetrics("junk")).toEqual({ requests: "0", tokens: "0", cost: "—" })
  })
})

describe("cacheHitRate (deepened panel line)", () => {
  it("divides cache reads by the honest grand total (real + reads)", () => {
    // realTotalTokens EXCLUDES cache reads, so the denominator is the sum —
    // dividing by realTotal alone could exceed 100%.
    expect(cacheHitRate({ realTotalTokens: 700, totalCacheReadTokens: 300 })).toBe(30)
    expect(cacheHitRate({ realTotalTokens: 1, totalCacheReadTokens: 3 })).toBe(75)
    expect(cacheHitRate({ realTotalTokens: 150, totalCacheReadTokens: 50 })).toBe(25)
    expect(cacheHitRate({ realTotalTokens: 0, totalCacheReadTokens: 25 })).toBe(100)
  })

  it("yields null when either count is missing/garbage or the total is zero", () => {
    expect(cacheHitRate({ realTotalTokens: 0, totalCacheReadTokens: 0 })).toBeNull()
    expect(cacheHitRate({ realTotalTokens: 100 })).toBeNull()
    expect(cacheHitRate({ totalCacheReadTokens: 100 })).toBeNull()
    expect(cacheHitRate({ realTotalTokens: -1, totalCacheReadTokens: 5 })).toBeNull()
    expect(cacheHitRate({ realTotalTokens: "700", totalCacheReadTokens: 300 })).toBeNull()
    expect(cacheHitRate(null)).toBeNull()
    expect(cacheHitRate("junk")).toBeNull()
  })
})

describe("unpricedCount (deepened panel line)", () => {
  it("discloses the count only when the cost total is partial", () => {
    expect(unpricedCount({ totalCostUsdKnown: false, unpricedRequestCount: 3 })).toBe(3)
    expect(unpricedCount({ totalCostUsdKnown: true, unpricedRequestCount: 3 })).toBeNull()
    expect(unpricedCount({ unpricedRequestCount: 3 })).toBeNull()
    expect(unpricedCount(null)).toBeNull()
  })

  it("degrades a garbage count to 0 instead of hiding a known-partial total", () => {
    expect(unpricedCount({ totalCostUsdKnown: false })).toBe(0)
    expect(unpricedCount({ totalCostUsdKnown: false, unpricedRequestCount: "3" })).toBe(0)
    expect(unpricedCount({ totalCostUsdKnown: false, unpricedRequestCount: -2 })).toBe(0)
    expect(unpricedCount({ totalCostUsdKnown: false, unpricedRequestCount: 2.6 })).toBe(3)
  })
})
