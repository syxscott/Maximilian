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
