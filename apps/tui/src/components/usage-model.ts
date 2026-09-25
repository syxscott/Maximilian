// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the TUI Usage panel: GET /api/obs/usage/summary is
 * already a typed contract (UsageSummary in ../api), but the panel still
 * goes through a defensive view model — totalCostUsdKnown may be false (the
 * window contained unpriced requests, so the total is partial) and token
 * counts get compact K/M formatting for the three-line display.
 */

import type { UsageSummary } from "../api"

/**
 * Compact token count: plain digits under 1,000, then one decimal of K / M /
 * B ("999", "12.3K", "4.56M"). Never throws; non-finite input renders "—".
 */
export function compactTokens(count: unknown): string {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return "—"
  if (count < 1000) return String(Math.round(count))
  const units = [
    { limit: 1e9, suffix: "B" },
    { limit: 1e6, suffix: "M" },
    { limit: 1e3, suffix: "K" },
  ] as const
  for (const unit of units) {
    if (count >= unit.limit) {
      const scaled = count / unit.limit
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
      return `${scaled.toFixed(digits)}${unit.suffix}`
    }
  }
  return String(count)
}

/**
 * Cost line: a fixed 4-decimal dollar amount, or an honest em-dash when the
 * window contained unpriced requests (totalCostUsdKnown === false) — the
 * same disclosure the dashboard's usage card makes.
 */
export function formatCostUsd(costUsd: unknown, known?: boolean): string {
  if (known === false) return "—"
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0) return "—"
  return `$${costUsd.toFixed(4)}`
}

/** The three headline metrics of the compact panel. */
export interface UsageMetricsView {
  requests: string
  tokens: string
  cost: string
}

/**
 * Defensively read the three core metrics (totalRequests / totalTokens /
 * totalCost) off a passthrough summary payload. Tokens are the REAL total
 * (input + output + cache-creation; cache reads excluded) — the same number
 * the home view's LiveUsageBar shows.
 */
export function usageMetrics(summary: unknown): UsageMetricsView {
  const record =
    summary != null && typeof summary === "object" ? (summary as Record<string, unknown>) : {}
  const requests = typeof record.totalRequests === "number" ? record.totalRequests : 0
  const tokens = typeof record.realTotalTokens === "number" ? record.realTotalTokens : 0
  return {
    requests: compactTokens(requests),
    tokens: compactTokens(tokens),
    cost: formatCostUsd(record.totalCostUsd, record.totalCostUsdKnown as boolean | undefined),
  }
}

/**
 * The full UsageSummary variant (typed caller): delegates to the defensive
 * reader so both entry points stay in lockstep.
 */
export function usageMetricsFromSummary(summary: UsageSummary): UsageMetricsView {
  return usageMetrics(summary)
}

/**
 * Cache hit rate for the deepened panel: cache-read tokens over the honest
 * grand total. realTotalTokens EXCLUDES cache reads (input + output +
 * cache-creation only), so the denominator is realTotal + cacheRead —
 * dividing by realTotal alone could exceed 100%. Both counts must be
 * present, finite, non-negative and the denominator strictly positive;
 * anything else yields null (the panel hides the line — no "NaN%").
 * Returns a percentage rounded to one decimal, clamped to 0..100.
 */
export function cacheHitRate(summary: unknown): number | null {
  const record =
    summary != null && typeof summary === "object" ? (summary as Record<string, unknown>) : {}
  const read = record.totalCacheReadTokens
  const real = record.realTotalTokens
  if (typeof read !== "number" || !Number.isFinite(read) || read < 0) return null
  if (typeof real !== "number" || !Number.isFinite(real) || real < 0) return null
  const total = real + read
  if (total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((read / total) * 1000) / 10))
}

/**
 * Unpriced-request count for the disclosure line: only shown when the
 * summary says the cost total is partial (totalCostUsdKnown === false) —
 * a known total means nothing is unpriced and the line stays hidden
 * (null). The count itself is read defensively; garbage degrades to 0.
 */
export function unpricedCount(summary: unknown): number | null {
  const record =
    summary != null && typeof summary === "object" ? (summary as Record<string, unknown>) : {}
  if (record.totalCostUsdKnown !== false) return null
  const count = record.unpricedRequestCount
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return 0
  return Math.round(count)
}

// ── Rolling windows (GET /api/obs/usage/windows, the 24h line) ──────────────

/** The single rolling-window line under the three summary rows. */
export interface UsageWindowView {
  /** The matched window key, e.g. "24h". */
  window: string
  requests: string
  tokens: string
  cost: string
}

/**
 * Pick one rolling window by key — pickWindow(windows, "24h") — and shape it
 * into the panel's line: requests / real tokens (input + output; cache reads
 * excluded, the same definition as the summary's realTotalTokens) / cost.
 * The cost keeps the strict real-cost semantics of the endpoint: a null
 * costUsd (any unpriced request in the window) renders the honest "—", never
 * a silently partial total. Returns null when there is no matching bucket
 * (non-array input, garbage rows, unknown/empty key) so the panel can hide
 * the line instead of printing fake zeros.
 */
export function pickWindow(windows: unknown, key: unknown): UsageWindowView | null {
  const list = Array.isArray(windows) ? windows : []
  const wanted = typeof key === "string" && key.length > 0 ? key : ""
  if (wanted.length === 0) return null
  for (const raw of list) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue
    const bucket = raw as Record<string, unknown>
    if (bucket.window !== wanted) continue
    const count = (value: unknown): number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
    return {
      window: wanted,
      requests: compactTokens(count(bucket.requests)),
      tokens: compactTokens(count(bucket.inputTokens) + count(bucket.outputTokens)),
      cost: formatCostUsd(bucket.costUsd),
    }
  }
  return null
}
