// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * One-shot compensation for runs missed during a store outage (hermes
 * borrowing: `cron/jobs.py` `_retire_expired_oneshot` + store_health
 * cooperation, commits around 91fc7badaf).
 *
 * A one-shot due INSIDE an outage was skipped, not missed: when the store
 * accepts writes again it must fire EXACTLY ONCE. The gates, in order:
 *
 *   1. inside the grace window            → fire (normal path);
 *   2. beyond grace, outage-covered       → fire (catch-up after recovery);
 *   3. an outage claim that never reached its fire claim never started →
 *      still covered → fire;
 *   4. claimed or fired beyond coverage   → a run may be in flight
 *      elsewhere → skip, keep the record (never double-fire);
 *   5. no claim at all, beyond coverage   → retire with a diagnostic —
 *      a truly missed one-shot is never silently deleted and never fires
 *      hours late.
 *
 * The pending-slot exactly-once admission (`@max/core` cron-slot) stamps
 * step 3/4's claims; this module is the recovery-side complement.
 */

import type { StoreHealthRegistry } from "./store-health.js"

/** What the tick should do with a due one-shot. */
export type OneShotAction = "fire" | "skip-in-flight" | "retire"

export interface OneShotDecision {
  action: OneShotAction
  /** Why — surfaced in diagnostics, never silent. */
  reason: string
}

/** The dispatch claim a scheduler stamps when it takes a one-shot. */
export interface OneShotClaim {
  /** The claim was made while the store was degraded. */
  outage?: boolean
}

export interface OneShotOutageInput {
  /** The one-shot's scheduled instant (epoch ms). */
  dueAtMs: number
  /** How late a one-shot may still fire normally. */
  graceMs: number
  /** Wall now (epoch ms). */
  nowMs: number
  /** Present when a dispatch claim was stamped. */
  claim?: OneShotClaim | null
  /** Present when the fire claim (the run actually started) was stamped. */
  fireClaimPresent?: boolean
}

/**
 * Decide a due one-shot against the store's outage history. Pure apart
 * from the injected registry's outage records.
 */
export function decideOneShotAfterOutage(
  input: OneShotOutageInput,
  health: StoreHealthRegistry,
  store: string,
): OneShotDecision {
  const { dueAtMs, graceMs, nowMs, claim, fireClaimPresent } = input

  if (nowMs - dueAtMs <= graceMs) {
    return { action: "fire", reason: "inside the grace window" }
  }

  // Due during an outage: skipped, not missed; catch up exactly once.
  if (health.outageCovers(store, dueAtMs, graceMs)) {
    return { action: "fire", reason: "due inside an outage window; firing once on recovery" }
  }

  // An outage-covered claim that never reached its fire claim never
  // started: it stays covered.
  if (claim?.outage === true && fireClaimPresent !== true) {
    return { action: "fire", reason: "outage claim never started; covered by its outage" }
  }

  if (claim !== null && claim !== undefined) {
    return {
      action: "skip-in-flight",
      reason: "claimed beyond any outage coverage; a run may still be in flight elsewhere",
    }
  }
  if (fireClaimPresent === true) {
    return {
      action: "skip-in-flight",
      reason: "fire claim present beyond any outage coverage; a run may still be in flight",
    }
  }

  return {
    action: "retire",
    reason: "beyond grace with no claim: missed, retiring with a diagnostic (not firing late)",
  }
}

/**
 * The diagnostic record for a retired one-shot (hermes: never silently
 * delete). The caller persists it next to the job ledger.
 */
export interface MissedOneShotDiagnostic {
  jobId: string
  dueAtMs: number
  retiredAtMs: number
  reason: string
}

export function buildMissedOneShotDiagnostic(
  jobId: string,
  input: OneShotOutageInput,
  decision: OneShotDecision,
): MissedOneShotDiagnostic {
  return {
    jobId,
    dueAtMs: input.dueAtMs,
    retiredAtMs: input.nowMs,
    reason: decision.reason,
  }
}
