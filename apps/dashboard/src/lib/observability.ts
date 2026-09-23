// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Observability model layer — pure helpers for the analytics panels
 * (tested; presentation stays dumb).
 */

/** 0..1+ → percentage string. */
export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/** Badge tone for a truth-audit verdict. */
export function verdictTone(verdict: string): "default" | "secondary" | "destructive" | "outline" {
  switch (verdict) {
    case "accurate":
      return "default"
    case "insufficient_data":
      return "outline"
    case "under_predicted":
    case "over_predicted":
      return "secondary"
    default:
      return "destructive"
  }
}

/**
 * One-line PGR reading guidance (mirrors the oracle-triad interpretation
 * thresholds so the badge and the text can never disagree).
 */
export function pgrBand(pgr: number | undefined): "none" | "maintain" | "curate" | "bottleneck" {
  if (pgr === undefined) return "none"
  if (pgr >= 0.7) return "maintain"
  if (pgr >= 0.3) return "curate"
  return "bottleneck"
}

export function pgrLabel(report: { pgr?: number; oracleCorpusMissing?: boolean }): string | null {
  if (report.oracleCorpusMissing) return null
  switch (pgrBand(report.pgr)) {
    case "maintain":
      return "≥70%"
    case "curate":
      return "30–70%"
    case "bottleneck":
      return "<30%"
    default:
      return null
  }
}
