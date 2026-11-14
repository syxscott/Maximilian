// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Read-only benchmark-summary consumption on the leaderboard (A1 wiring):
 * benchmark-core suite summaries roll up per-field without touching the
 * leaderboard's own aggregation or entries.
 */

import { describe, it, expect } from "vitest"
import { aggregateBenchmarkSummaries } from "../src/leaderboard.js"

describe("aggregateBenchmarkSummaries", () => {
  it("means each defined field across summaries", () => {
    const merged = aggregateBenchmarkSummaries([
      { passRate: 0.5, avgQuality: 0.4, toolCallsMatchRate: 0.8, avgLatencyMs: 100 },
      { passRate: 1.0, avgQuality: 0.8, toolCallsMatchRate: 0.6, avgLatencyMs: 300 },
    ])
    expect(merged.passRate).toBe(0.75)
    expect(merged.avgQuality).toBe(0.6)
    expect(merged.toolCallsMatchRate).toBe(0.7)
    expect(merged.avgLatencyMs).toBe(200)
  })

  it("a field no summary defines stays absent (never a fabricated 0)", () => {
    const merged = aggregateBenchmarkSummaries([
      { passRate: 1, avgQuality: 1 },
      { passRate: 0, avgQuality: 0, scenarioCheckPassRate: 0.5 },
    ])
    expect(merged.scenarioCheckPassRate).toBe(0.5)
    expect(merged.toolCallsMatchRate).toBeUndefined()
    expect(merged.errorOnlyReasoningRate).toBeUndefined()
    expect(merged.totalTokens).toBeUndefined()
  })

  it("accepts benchmark-core AggregateMetrics objects as-is", () => {
    const merged = aggregateBenchmarkSummaries([
      {
        passRate: 1,
        avgQuality: 1,
        avgLatencyMs: 42,
        totalTokens: 900,
        avgAcceptance: 1,
        toolCallsMatchRate: 0.9,
        toolCallsSchemaAccuracy: 0.95,
        errorOnlyReasoningRate: 0.1,
      },
    ])
    expect(merged).toEqual({
      passRate: 1,
      avgQuality: 1,
      avgLatencyMs: 42,
      totalTokens: 900,
      avgAcceptance: 1,
      toolCallsMatchRate: 0.9,
      toolCallsSchemaAccuracy: 0.95,
      errorOnlyReasoningRate: 0.1,
    })
  })

  it("an empty list yields an empty summary", () => {
    expect(aggregateBenchmarkSummaries([])).toEqual({})
  })
})
