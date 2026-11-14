// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Context-occupancy estimate model (deepseek ContextMeter.tsx mechanism,
 * LOCAL-ESTIMATE edition): the dashboard has no provider-anchored token
 * meter yet, so occupancy is a chars/4 heuristic over the composer draft
 * plus the current workspace session's event text.
 *
 * Estimate + ceiling alignment: `estimateTokensFromChars` mirrors
 * packages/core runtime.ts `estimateChatTokens` (chars/4 per message);
 * `CONTEXT_LIMIT_TOKENS` mirrors core `defaultProactiveCompaction()`'s
 * tokenLimit (120k). The dashboard/api expose no context-window config
 * surface today (checked: api.ts, ProviderPanel — provider *model* limits
 * exist but no session runtime config), so the constant is the honest
 * default; wiring a config read is a drop-in replacement of this constant.
 */

import type { RuntimeEvent } from "@/api"

/** Context ceiling — core defaultProactiveCompaction() tokenLimit parity. */
export const CONTEXT_LIMIT_TOKENS = 120_000

/** Occupancy percentage at which the meter switches to the warning tone. */
export const CONTEXT_WARN_PERCENT = 80

/** chars/4 whole-request token heuristic (core estimateChatTokens parity). */
export function estimateTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0
  return Math.ceil(chars / 4)
}

/**
 * Session event text volume, in characters. Each runtime event is counted
 * by its JSON length — the events arrive as passthrough objects and the
 * JSON form is exactly what the backend will re-materialize into the
 * model's request, so it is the least-wrong local approximation.
 */
export function sessionCharsFromEvents(events: readonly RuntimeEvent[]): number {
  let chars = 0
  for (const e of events) {
    try {
      chars += JSON.stringify(e)?.length ?? 0
    } catch {
      // A circular/hostile event can't be serialized — skip it rather than
      // poison the estimate.
    }
  }
  return chars
}

export interface ContextOccupancy {
  draftTokens: number
  sessionTokens: number
  totalTokens: number
  limit: number
  /** 0–100+, clamped to 100 for ring geometry. */
  percent: number
  /** Raw percent (may exceed 100 — displayed as-is). */
  rawPercent: number
  warn: boolean
}

/** Occupancy of the configured budget by the draft + session estimate. */
export function contextOccupancyModel(
  draftChars: number,
  sessionChars: number,
  limit: number = CONTEXT_LIMIT_TOKENS,
): ContextOccupancy {
  const draftTokens = estimateTokensFromChars(draftChars)
  const sessionTokens = estimateTokensFromChars(sessionChars)
  const totalTokens = draftTokens + sessionTokens
  const boundedLimit = Number.isFinite(limit) && limit > 0 ? limit : CONTEXT_LIMIT_TOKENS
  const rawPercent = Math.round((totalTokens / boundedLimit) * 100)
  return {
    draftTokens,
    sessionTokens,
    totalTokens,
    limit: boundedLimit,
    percent: Math.min(100, rawPercent),
    rawPercent,
    warn: rawPercent >= CONTEXT_WARN_PERCENT,
  }
}
