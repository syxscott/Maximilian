// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Per-session / per-role range breakdown (token-monitor sessionUsageArchive
 * borrowing). The contract under test:
 *   - group rows sum EXACTLY to the summary they decompose (same scan,
 *     same formulas) — the dashboard's drill-down never disagrees with the
 *     totals above it
 *   - `groupBy=agentRole` decomposes by role instead of by taskId
 *   - an invalid `groupBy` is a 400 client error, not a silent fallback
 *   - omitting `groupBy` leaves the historical response shape untouched
 */

import { describe, it, expect } from "vitest"
import { Hono } from "hono"
import {
  aggregateUsageBreakdown,
  aggregateUsageSummary,
  parseUsageGroupBy,
  resolveUsageRange,
  usageRoutes,
  type UsageGroupBy,
} from "../src/routes/usage.js"
import type { EvolutionFacade, MetricRecord } from "@max/evolution"

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0) // 2026-06-15T12:00:00Z
const INSIDE = new Date(NOW - 60_000).toISOString()
const OUTSIDE = new Date(NOW - 30 * 86_400_000).toISOString()

function rec(
  overrides: Partial<MetricRecord> & { timestamp: string; tokenInput: number; tokenOutput: number },
): MetricRecord {
  return {
    agentId: "a1",
    agentRole: "general",
    executionTime: 100,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    retryCount: 0,
    provider: "anthropic",
    // A model present in DEFAULT_PRICING, so "cost known" assertions are
    // about the breakdown logic rather than the price table.
    model: "claude-sonnet-4-20250514",
    ...overrides,
  }
}

// Two sessions and two roles, so both grouping dimensions have >1 bucket.
const RECORDS: MetricRecord[] = [
  rec({
    taskId: "session-a",
    agentRole: "general",
    timestamp: INSIDE,
    tokenInput: 100,
    tokenOutput: 50,
  }),
  rec({
    taskId: "session-a",
    agentRole: "general",
    timestamp: INSIDE,
    tokenInput: 200,
    tokenOutput: 100,
  }),
  rec({
    taskId: "session-b",
    agentRole: "reviewer",
    timestamp: INSIDE,
    tokenInput: 1000,
    tokenOutput: 20,
    cacheReadTokens: 900,
  }),
]

/** Route handlers resolve the range against the real clock, so give them
 *  records stamped relative to now (and use the 7d preset). */
function routeRecords(): MetricRecord[] {
  const stamp = new Date(Date.now() - 60_000).toISOString()
  return RECORDS.map((r) => ({ ...r, timestamp: stamp }))
}

describe("aggregateUsageBreakdown", () => {
  const range = resolveUsageRange("today", NOW)

  it("session rows sum exactly to the summary", () => {
    const summary = aggregateUsageSummary(RECORDS, range, "today")
    const rows = aggregateUsageBreakdown(RECORDS, range, "session")

    expect(rows.map((r) => r.key).sort()).toEqual(["session-a", "session-b"])
    expect(rows.reduce((sum, r) => sum + r.realTotalTokens, 0)).toBe(summary.realTotalTokens)
    expect(rows.reduce((sum, r) => sum + r.totalRequests, 0)).toBe(summary.totalRequests)
    expect(rows.reduce((sum, r) => sum + r.totalInputTokens, 0)).toBe(summary.totalInputTokens)
    expect(rows.reduce((sum, r) => sum + r.totalOutputTokens, 0)).toBe(summary.totalOutputTokens)
    expect(rows.reduce((sum, r) => sum + r.totalCacheReadTokens, 0)).toBe(
      summary.totalCacheReadTokens,
    )
    expect(rows.reduce((sum, r) => sum + r.totalCostUsd, 0)).toBeCloseTo(summary.totalCostUsd, 10)
  })

  it("groups by taskId (the session/workspace association key)", () => {
    const rows = aggregateUsageBreakdown(RECORDS, range, "session")
    const a = rows.find((r) => r.key === "session-a")!
    expect(a.totalRequests).toBe(2)
    expect(a.agentRole).toBe("general")
    expect(a.realTotalTokens).toBe(450)
  })

  it("agentRole rows sum exactly to the summary", () => {
    const summary = aggregateUsageSummary(RECORDS, range, "today")
    const rows = aggregateUsageBreakdown(RECORDS, range, "agentRole")
    expect(rows.map((r) => r.key).sort()).toEqual(["general", "reviewer"])
    expect(rows.reduce((sum, r) => sum + r.realTotalTokens, 0)).toBe(summary.realTotalTokens)
    expect(rows.reduce((sum, r) => sum + r.totalRequests, 0)).toBe(summary.totalRequests)
  })

  it("flags a group cost-unknown when one of its requests is unpriced", () => {
    const records = [
      ...RECORDS,
      rec({
        taskId: "session-a",
        timestamp: INSIDE,
        tokenInput: 10,
        tokenOutput: 5,
        provider: "unknown-provider",
        model: "mystery",
      }),
    ]
    const rows = aggregateUsageBreakdown(records, range, "session")
    expect(rows.find((r) => r.key === "session-a")!.totalCostUsdKnown).toBe(false)
    expect(rows.find((r) => r.key === "session-b")!.totalCostUsdKnown).toBe(true)
  })

  it("excludes out-of-range records and sorts by tokens then key", () => {
    const records = [
      ...RECORDS,
      rec({ taskId: "old", timestamp: OUTSIDE, tokenInput: 999, tokenOutput: 999 }),
    ]
    const rows = aggregateUsageBreakdown(records, range, "session")
    expect(rows.some((r) => r.key === "old")).toBe(false)
    expect(rows[0]!.key).toBe("session-b") // largest first
  })
})

describe("parseUsageGroupBy", () => {
  it("accepts the documented dimensions and absence", () => {
    expect(parseUsageGroupBy(undefined)).toEqual({ ok: true, groupBy: undefined })
    const dims: UsageGroupBy[] = ["session", "agentRole"]
    for (const dim of dims) {
      expect(parseUsageGroupBy(dim)).toEqual({ ok: true, groupBy: dim })
    }
  })

  it("rejects unknown values instead of silently ignoring them", () => {
    expect(parseUsageGroupBy("bogus").ok).toBe(false)
    expect(parseUsageGroupBy("").ok).toBe(false)
    expect(parseUsageGroupBy("SESSION").ok).toBe(false)
  })
})

describe("usage routes: groupBy", () => {
  function appWith(records: MetricRecord[]) {
    const evolution = {
      metrics: { listAll: async () => records },
    } as unknown as EvolutionFacade
    const routes = usageRoutes({ evolution })
    const app = new Hono()
    app.get("/obs/usage/summary", routes.summary)
    app.get("/obs/usage/daily", routes.daily)
    return app
  }

  it("returns bySession alongside the summary total", async () => {
    const app = appWith(routeRecords())
    const res = await app.request("/obs/usage/summary?range=7d&groupBy=session")
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    const rows = body.bySession as Array<Record<string, number>>
    expect(rows).toHaveLength(2)
    expect(rows.reduce((sum, r) => sum + r.realTotalTokens, 0)).toBe(body.realTotalTokens)
  })

  it("returns byAgentRole for groupBy=agentRole", async () => {
    const app = appWith(routeRecords())
    const res = await app.request("/obs/usage/summary?range=7d&groupBy=agentRole")
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body.byAgentRole as Array<Record<string, unknown>>).map((r) => r.key).sort()).toEqual([
      "general",
      "reviewer",
    ])
    expect(body.bySession).toBeUndefined()
  })

  it("rejects an invalid groupBy with 400", async () => {
    const app = appWith(routeRecords())
    for (const bad of ["bogus", "project", ""]) {
      const res = await app.request(
        `/obs/usage/summary?range=7d&groupBy=${encodeURIComponent(bad)}`,
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.error).toBe("invalid_group_by")
    }
  })

  it("keeps the historical response shape when groupBy is absent", async () => {
    const records = routeRecords()
    const app = appWith(records)
    const res = await app.request("/obs/usage/summary?range=7d")
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect("bySession" in body).toBe(false)
    expect("byAgentRole" in body).toBe(false)
    const expected = aggregateUsageSummary(records, resolveUsageRange("7d"), "7d")
    expect(body).toEqual(expected)
  })

  it("daily accepts groupBy and keeps pagination fields", async () => {
    const app = appWith(routeRecords())
    const res = await app.request("/obs/usage/daily?range=7d&groupBy=session")
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.range).toBe("7d")
    expect(Array.isArray(body.daily)).toBe(true)
    expect(typeof body.total).toBe("number")
    expect(body.bySession).toHaveLength(2)
  })
})
