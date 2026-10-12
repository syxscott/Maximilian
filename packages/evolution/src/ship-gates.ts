// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Feature-family audit ship gate — degradation, not disable
 * (codebase-memory-mcp 7209ae12 / 78eace4f borrowing).
 *
 * Every self-evolution artifact family is one row of
 * {@link CAPABILITY_FAMILIES}, and that single tuple generates BOTH the
 * family names (the derived `CapabilityFamily` union) and the ship gates
 * (the derived `FAMILY_SHIP_GATES` map). A family cannot exist without a
 * name and a gate — the TS counterpart of the C X-macro list that
 * generates an enum and its table from one row set.
 *
 * The gate's semantics are degradation: a family whose held-out audit is
 * below the bar still produces its artifacts exactly as before — the row
 * carrying the result is marked degraded with the `below_bar_tier` reason
 * instead of the artifact being promoted to shipped status. Nothing is
 * disabled; what is withheld is only the upgrade.
 *
 * A family ships only after a held-out audit passed it: blind judging on a
 * sample disjoint from every development corpus, Wilson 95% lower bound
 * >= 0.90 and point estimate >= 0.95. The protocol is
 * docs/audits/capability-family-audit-protocol.md; the audit records live
 * in the committed ledger (test/fixtures in @max/evolution), and
 * {@link shipGateViolations} is the check the ship-gate test runs: with a
 * family re-opened in the registry but no passing audit in the ledger, the
 * test goes red.
 */

/** The registry — ONE row per family: id, display name, ships. */
export const CAPABILITY_FAMILIES = [
  ["prompt_rewrite", "Evolved system-prompt candidates", true],
  ["memory_curation", "Curator consolidation and archiving", true],
  ["lesson_gating", "Efficacy-gated lesson injection", true],
  ["model_selection", "Leaderboard-driven model auto-pick", true],
  ["background_reflection", "Background-reflected lessons", true],
  // Held: held-out audit scored 93/100 — point estimate below the bar.
  ["oracle_triad", "Injection-ceiling (PGR) recommendations", false],
  // Held: never audited — no held-out occurrences to sample yet.
  ["team_rebalance", "Team-optimizer rebalance suggestions", false],
] as const

/** One family id. Derived from the registry — a new row extends this union. */
export type CapabilityFamily = (typeof CAPABILITY_FAMILIES)[number][0]

/** Audit bar (protocol: held-out, blind; two-sided 95% Wilson interval). */
export const WILSON_LOWER_BOUND_MIN = 0.9
export const POINT_ESTIMATE_MIN = 0.95
/** A family audit judges at least this many held-out samples (census if smaller). */
export const MIN_HELDOUT_SAMPLE = 30

export const BELOW_BAR_TIER_REASON = "below_bar_tier"

/** The gate one registry row generates. */
export interface FamilyShipGate {
  readonly family: CapabilityFamily
  readonly displayName: string
  /** false: below the audit bar (or not yet audited) — degraded, not disabled. */
  readonly ships: boolean
}

/**
 * The gate map derived from the SAME tuple as the family union: adding a
 * family row adds its gate; no gate can exist for a family that is not in
 * the registry, and no family can exist without a gate.
 */
export const FAMILY_SHIP_GATES: Readonly<Record<CapabilityFamily, FamilyShipGate>> =
  Object.fromEntries(
    CAPABILITY_FAMILIES.map(([family, displayName, ships]) => [
      family,
      { family, displayName, ships } satisfies FamilyShipGate,
    ]),
  ) as Readonly<Record<CapabilityFamily, FamilyShipGate>>

export function isCapabilityFamily(value: string): value is CapabilityFamily {
  return Object.hasOwn(FAMILY_SHIP_GATES, value)
}

/**
 * Wilson 95% lower bound on a binomial proportion (z = 1.96). The bar
 * metric of the audit protocol: how low the true rate may plausibly be
 * given `correct` of `n` blind judgements.
 */
export function wilsonLowerBound(correct: number, n: number, z = 1.96): number {
  if (n <= 0) return 0
  const p = correct / n
  const z2 = z * z
  const centre = p + z2 / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return Math.max(0, (centre - margin) / (1 + z2 / n))
}

/** One held-out audit's record, as committed to the ledger. */
export interface AuditRecord {
  family: string
  /** "passed" | "failed" — the auditor's disposition, kept for history. */
  verdict: "passed" | "failed"
  /** Blind judgements made. */
  judged: number
  /** Judgements found correct against the source. */
  correct: number
  /** ISO date of the audit. */
  auditedAt: string
}

export interface AuditLedger {
  /** Pointer to the protocol doc this ledger is scored under. */
  protocol: string
  audits: AuditRecord[]
}

export type ShipGateViolation =
  | { kind: "family_reopened_without_audit"; family: string; detail: string }
  | { kind: "ledger_family_unknown"; family: string; detail: string }
  | { kind: "audit_below_bar"; family: string; detail: string }

/**
 * The ship-gate check the test runs: every SHIPPED family must have a
 * ledger audit that meets the bar (Wilson 95% lower bound >= 0.90 and
 * point >= 0.95 on at least the minimum held-out sample); every ledger row
 * must name a family in the registry. Re-opening a family without a
 * passing audit produces a violation — and turns the test red.
 */
export function shipGateViolations(
  ships: Readonly<Record<string, boolean>>,
  ledger: AuditLedger,
): ShipGateViolation[] {
  const violations: ShipGateViolation[] = []
  const auditedByFamily = new Map<string, AuditRecord>()
  for (const record of ledger.audits) {
    if (!isCapabilityFamily(record.family)) {
      violations.push({
        kind: "ledger_family_unknown",
        family: record.family,
        detail: "ledger names a family the registry does not define",
      })
      continue
    }
    // Keep the most recent audit per family.
    const existing = auditedByFamily.get(record.family)
    if (!existing || record.auditedAt > existing.auditedAt) {
      auditedByFamily.set(record.family, record)
    }
  }
  for (const [family, shipsNow] of Object.entries(ships)) {
    if (!shipsNow) continue
    const record = auditedByFamily.get(family)
    if (!record) {
      violations.push({
        kind: "family_reopened_without_audit",
        family,
        detail: "family ships but the ledger has no audit for it",
      })
      continue
    }
    const point = record.correct / record.judged
    const lower = wilsonLowerBound(record.correct, record.judged)
    if (
      record.verdict !== "passed" ||
      record.judged < MIN_HELDOUT_SAMPLE ||
      point < POINT_ESTIMATE_MIN ||
      lower < WILSON_LOWER_BOUND_MIN
    ) {
      violations.push({
        kind: "audit_below_bar",
        family,
        detail:
          `audit ${record.correct}/${record.judged} (point ${point.toFixed(3)}, ` +
          `Wilson lower ${lower.toFixed(3)}) does not meet the bar ` +
          `(point >= ${POINT_ESTIMATE_MIN}, lower >= ${WILSON_LOWER_BOUND_MIN}, ` +
          `n >= ${MIN_HELDOUT_SAMPLE}, verdict passed)`,
      })
    }
  }
  return violations
}

/** Degradation marker on a produced-but-not-promoted row. */
export interface Degradation {
  code: "below_bar_tier"
  reason: string
}

/** Ship-gate stamp carried on an artifact row (EvolutionDecision.shipGate). */
export interface EvolutionDecisionShipGate {
  family: CapabilityFamily | string
  shipped: boolean
  degradation?: Degradation
}

export interface FamilyRow<T> {
  family: CapabilityFamily
  displayName: string
  /** false: the row is produced but degraded — the artifact is not promoted. */
  shipped: boolean
  /** Present exactly when `shipped` is false. */
  degradation?: Degradation
  /** The artifact itself — produced as usual regardless of the gate. */
  output: T
}

/**
 * Wrap a family's produced artifact in its gate's row: shipped families
 * pass through clean; held families keep the output intact and carry the
 * `below_bar_tier` degradation.
 */
export function resolveFamilyRow<T>(family: CapabilityFamily, output: T): FamilyRow<T> {
  const gate = FAMILY_SHIP_GATES[family]
  if (gate.ships) {
    return { family, displayName: gate.displayName, shipped: true, output }
  }
  return {
    family,
    displayName: gate.displayName,
    shipped: false,
    degradation: {
      code: "below_bar_tier",
      reason:
        `family "${family}" has not passed its held-out audit ` +
        `(Wilson 95% lower bound >= ${WILSON_LOWER_BOUND_MIN}, point >= ${POINT_ESTIMATE_MIN}); ` +
        "the artifact is produced but not promoted to shipped status",
    },
    output,
  }
}
