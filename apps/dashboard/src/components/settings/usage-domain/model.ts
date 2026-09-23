// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the usage charts domain. All geometry (polyline
 * points, bar rectangles) is computed here so the SVG components stay
 * dumb renderers and the math is unit-testable. Inputs are passthrough
 * JSON from /obs/usage/* — every accessor is defensive.
 */

export type DailyMetric = "requests" | "tokens" | "cost"

export interface DailyPoint {
  date: string
  value: number
}

export interface SummaryView {
  requests: number
  tokens: number
  costUsd: number
  costKnown: boolean
  successRate: number
  cacheHitRate: number
}

export interface WindowRow {
  window: string
  requests: number
  inputTokens: number
  outputTokens: number
  /** null = window contains unpriced requests (cost unknown, never partial). */
  costUsd: number | null
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

// ── Normalizers ─────────────────────────────────────────────────────────────

export function toDailySeries(raw: unknown, metric: DailyMetric): DailyPoint[] {
  if (raw == null || typeof raw !== "object") return []
  const daily = (raw as { daily?: unknown }).daily
  if (!Array.isArray(daily)) return []
  const points: DailyPoint[] = []
  for (const item of daily) {
    if (item == null || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const date = str(row.date)
    if (!date) continue
    const value =
      metric === "requests"
        ? num(row.requestCount)
        : metric === "tokens"
          ? num(row.totalTokens)
          : num(row.totalCostUsd)
    points.push({ date, value })
  }
  return points
}

export function toSummaryView(raw: unknown): SummaryView {
  const row = raw != null && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    requests: num(row.totalRequests),
    tokens: num(row.realTotalTokens, num(row.totalInputTokens) + num(row.totalOutputTokens)),
    costUsd: num(row.totalCostUsd),
    costKnown: row.totalCostUsdKnown === true,
    successRate: num(row.successRate),
    cacheHitRate: num(row.cacheHitRate),
  }
}

export function toWindowRows(raw: unknown): WindowRow[] {
  if (raw == null || typeof raw !== "object") return []
  const windows = (raw as { windows?: unknown }).windows
  if (!Array.isArray(windows)) return []
  const rows: WindowRow[] = []
  for (const item of windows) {
    if (item == null || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const window = str(row.window)
    if (!window) continue
    rows.push({
      window,
      requests: num(row.requests),
      inputTokens: num(row.inputTokens),
      outputTokens: num(row.outputTokens),
      costUsd: typeof row.costUsd === "number" && Number.isFinite(row.costUsd) ? row.costUsd : null,
    })
  }
  return rows
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** Compact metric formatting for axis labels and tiles: 1.2k / 3.4M / 0.9G. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1).replace(/\.0$/, "")}G`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, "")}k`
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

// ── Chart geometry ──────────────────────────────────────────────────────────

/**
 * SVG polyline points for `values` fit into (width × height) minus a
 * padding on all sides. Handles empty input, single point and the flat
 * (min === max) degenerate case — always returns a drawable string.
 */
export function polylinePoints(
  values: number[],
  width: number,
  height: number,
  pad: number,
): string {
  if (values.length === 0 || width <= 0 || height <= 0) return ""
  const usableW = Math.max(1, width - pad * 2)
  const usableH = Math.max(1, height - pad * 2)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  return values
    .map((v, i) => {
      const x = values.length === 1 ? pad + usableW / 2 : pad + (usableW * i) / (values.length - 1)
      const y = pad + usableH - (span === 0 ? usableH / 2 : (usableH * (v - min)) / span)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
}

export interface BarRect {
  x: number
  y: number
  w: number
  h: number
  label: string
  value: number
}

/**
 * Bar rectangles for a (date, value) series inside (width × height) minus
 * padding. Bars keep a minimum visible height of 1px so zero-value days
 * stay clickable/visible. Empty input → [].
 */
export function dailyBars(
  dates: string[],
  values: number[],
  width: number,
  height: number,
  pad: number,
): BarRect[] {
  if (dates.length === 0 || dates.length !== values.length) return []
  if (width <= 0 || height <= 0) return []
  const usableW = Math.max(1, width - pad * 2)
  const usableH = Math.max(1, height - pad * 2)
  const max = Math.max(...values, 0)
  const slot = usableW / dates.length
  const barW = Math.max(1, slot * 0.7)
  return dates.map((date, i) => {
    const value = values[i]
    const barH = max > 0 ? Math.max(1, (usableH * value) / max) : 1
    const x = pad + slot * i + (slot - barW) / 2
    const y = pad + usableH - barH
    return { x, y, w: barW, h: barH, label: date, value }
  })
}
