// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Handoff budget — inter-agent communication is a FIRST-CLASS cost item
 * (C2C paper, ICLR 2026 borrowing: Table 3 measured T2T communication text
 * at 1312 ms of decode per handoff vs 90 ms for cache fusion; Table 5 showed
 * communication text becomes a net negative under long context).
 *
 * In Maximilian the sharer→receiver payload is the priorResults bundle
 * (review.ts) and the replanner snippet (commander). Both are bounded HERE,
 * at the code level — never by asking the model to be brief (§A.4.3: some
 * models ignore length instructions; only orchestration-layer truncation
 * is enforceable).
 */

import { communicationTokensTotal } from "@max/telemetry"

/** Rough char→token estimate for budget accounting (≈4 chars/token). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

/** Budget in tokens: HANDOFF_BUDGET_TOKENS env, else 4000. Kept in sync with
 *  the config schema (which validates the same variable at boot). */
export function defaultHandoffBudgetTokens(): number {
  const raw = process.env.HANDOFF_BUDGET_TOKENS
  const n = raw ? Number(raw) : Number.NaN
  return Number.isFinite(n) && n > 0 ? n : 4000
}

export interface HandoffEntry {
  /** Section heading for this artifact, e.g. "BACKEND (resultId=ab12)". */
  title: string
  body: string
}

export interface HandoffBundleResult {
  /** The assembled, budget-capped bundle text. */
  text: string
  /** Original total characters before capping. */
  totalChars: number
  /** Entries that were dropped or shortened to fit the budget. */
  truncatedEntries: number
  /** Estimated tokens of the FINAL text (what the receiver actually reads). */
  estimatedTokens: number
}

/**
 * Assemble a bounded handoff bundle: entries in order, dropping the
 * TAIL first (earliest context matters most: the user request and the
 * first producers), each kept entry self-reporting when it was shortened.
 * Records the estimated communication-token cost for Prometheus.
 */
export function renderHandoffBundle(
  entries: HandoffEntry[],
  budgetTokens: number,
  opts: { role: string; kind?: string },
): HandoffBundleResult {
  const maxChars = Math.max(200, budgetTokens * 4)
  const totalChars = entries.reduce((sum, e) => sum + e.title.length + e.body.length, 0)
  const parts: string[] = []
  let used = 0
  let truncatedEntries = 0

  for (let i = 0; i < entries.length; i++) {
    const { title, body } = entries[i]!
    const full = `--- ${title} ---\n${body}`
    const remaining = maxChars - used
    if (remaining <= 200) {
      truncatedEntries += entries.length - i
      break
    }
    if (full.length <= remaining) {
      parts.push(full)
      used += full.length
      continue
    }
    // Keep the head of this entry and self-report the cut (swarms borrowing:
    // tell the model how much it did NOT see, so it can ask for more).
    const shown = Math.max(0, remaining - title.length - 80)
    parts.push(
      `--- ${title} ---\n${body.slice(0, shown)}\n` +
        `[… showing first ${shown} of ${body.length} chars — artifact truncated by handoff budget]`,
    )
    used += remaining
    truncatedEntries += 1
    break // budget exhausted
  }

  if (truncatedEntries > 0) {
    parts.push(
      `[handoff budget: showing ${parts.length > 0 && truncatedEntries < entries.length ? "partial" : `${entries.length - truncatedEntries}`} of ${entries.length} artifacts — ${(totalChars / 1000).toFixed(1)}k chars total, budget ${maxChars} chars]`,
    )
  }

  const text = parts.join("\n\n")
  const estimatedTokens = estimateTokens(text.length)
  communicationTokensTotal
    .labels(opts.role, opts.kind ?? "handoff")
    .inc(estimatedTokens)

  return { text, totalChars, truncatedEntries, estimatedTokens }
}
