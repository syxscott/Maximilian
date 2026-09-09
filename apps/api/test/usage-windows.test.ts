// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Rolling usage windows (cc-switch borrowing) + real-cost null semantics
 * (openclaw usage-tracking borrowing).
 */

import { describe, it, expect } from "vitest"
import { computeUsageWindows, type UsageWindowKey } from "../src/routes/usage.js"
import type { MetricRecord } from "@max/evolution"

const NOW = Date.UTC(2026, 8, 5, 12, 0, 0) // 2026-09-05T12:00:00Z

function rec(overrides: Partial<MetricRecord>): MetricRecord {
  return {
    taskId: "t-" + Math.random().toString(36).slice(2, 8),
    agentId: "a1",
    agentRole: "general",
    executionTime: 100,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    retryCount: 0,
    provider: "openai",
    model: "gpt-4o",
    timestamp: new Date(NOW - 1000).toISOString(),
    tokenInput: 100,
    tokenOutput: 50,
    ...overrides,
  }
}

describe("computeUsageWindows", () => {
  it("exposes the 5h/24h/7d/30d tiers", () => {
    const windows = computeUsageWindows([], NOW)
    expect(windows.map((w) => w.window)).toEqual<UsageWindowKey[]>(["5h", "24h", "7d", "30d"])
    expect(windows[0]!.spanMs).toBe(5 * 60 * 60 * 1000)
  })

  it("buckets requests into the correct windows", () => {
    const records = [
      rec({ timestamp: new Date(NOW - 60_000).toISOString() }), // 1 min ago → all windows
      rec({ timestamp: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() }), // 2h → 24h/7d/30d
      rec({ timestamp: new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString() }), // 3d → 7d/30d
      rec({ timestamp: new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString() }), // 20d → 30d
    ]
    const windows = computeUsageWindows(records, NOW)
    const byKey = new Map(windows.map((w) => [w.window, w]))
    expect(byKey.get("5h")!.requests).toBe(2) // 1min + 2h ago
    expect(byKey.get("24h")!.requests).toBe(2)
    expect(byKey.get("7d")!.requests).toBe(3)
    expect(byKey.get("30d")!.requests).toBe(4)
  })

  it("costUsd is a number when every record is priced", () => {
    const windows = computeUsageWindows([rec({})], NOW)
    expect(windows.every((w) => typeof w.costUsd === "number")).toBe(true)
  })

  it("one unpriced model makes the whole window cost null — never silently partial", () => {
    const records = [
      rec({}), // priced
      rec({ model: "totally-unknown-model", provider: "unknown-provider" }), // unpriced
    ]
    const windows = computeUsageWindows(records, NOW)
    for (const w of windows) {
      if (w.requests === 0) continue
      expect(w.costUsd).toBeNull()
      expect(w.unpricedRequests).toBe(1)
    }
  })

  it("excludes records outside the window span and in the future", () => {
    const records = [
      rec({ timestamp: new Date(NOW - 6 * 60 * 60 * 1000).toISOString() }), // 6h ago
      rec({ timestamp: new Date(NOW + 60_000).toISOString() }), // future
    ]
    const windows = computeUsageWindows(records, NOW)
    expect(windows.find((w) => w.window === "5h")!.requests).toBe(0)
    expect(windows.find((w) => w.window === "24h")!.requests).toBe(1)
  })
})
