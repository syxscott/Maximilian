// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TruthCalibrator — closes the truth-audit loop with real actuals
 * (hermes methodology borrowing: usage anchors + residual comparison).
 *
 * At rollout time the orchestrator records an OPEN prediction
 * (sampleSize = 0, zero actuals). This calibrator resolves those open
 * predictions from telemetry:
 *
 *   baseline anchor = executions of the affected roles in the
 *                     `baselineWindowMs` window BEFORE the rollout,
 *   post window     = executions AFTER the rollout.
 *
 * Once the post window holds `minPostSamples` executions AND a non-empty
 * baseline exists, the observed deltas (post mean − baseline mean) are
 * recorded via `TruthAudit.resolveMeasurement` — replacing the placeholder
 * so calibration reports reflect reality instead of fabrication.
 *
 * Honesty boundaries:
 *   - A dimension without telemetry (cost until pricing is wired, risk —
 *     which has no runtime anchor at all) resolves to 0, i.e. "no observed
 *     change", never an invented number.
 *   - A proposal whose roles carry no metric history stays PENDING — it is
 *     never guessed.
 */

import { TruthMeasurementSchema, type TruthMeasurement } from "./types.js"

/** One telemetry point for a role (adapted from the metrics store). */
export interface CalibratorRolePoint {
  /** ISO timestamp of the execution. */
  at: string
  reviewScore?: number
  executionTimeMs?: number
  costUsd?: number
}

export interface TruthCalibratorDeps {
  /** Metric history for a role (evolution MetricsStore / PgMetricsStore). */
  listRolePoints(role: string): Promise<CalibratorRolePoint[]>
  /** Roles affected by a proposal (best effort — empty when unknown). */
  resolveProposalRoles(proposalId: string): Promise<string[]>
  /** All known measurements (persisted or in-memory). */
  getMeasurements: () => Promise<TruthMeasurement[]> | TruthMeasurement[]
  /** Persist an open→resolved replacement (see TruthAudit.resolveMeasurement). */
  resolveMeasurement(resolved: TruthMeasurement): void
  /** Baseline anchor window. Default: 7 days. */
  baselineWindowMs?: number
  /** Minimum post-rollout executions before resolving. Default: 5. */
  minPostSamples?: number
  now?: () => Date
}

export interface CalibratorSummary {
  /** Open predictions resolved this pass. */
  resolved: number
  /** Open predictions still waiting for enough post-rollout data. */
  pending: number
  /** Total open predictions inspected. */
  inspected: number
}

export class TruthCalibrator {
  private readonly baselineWindowMs: number
  private readonly minPostSamples: number
  private readonly now: () => Date

  constructor(private readonly deps: TruthCalibratorDeps) {
    this.baselineWindowMs = deps.baselineWindowMs ?? 7 * 24 * 60 * 60_000
    this.minPostSamples = deps.minPostSamples ?? 5
    this.now = deps.now ?? (() => new Date())
  }

  /**
   * Resolve every open prediction that has accumulated enough telemetry.
   * Called at the start of each meta cycle; idempotent (resolved
   * predictions are no longer open).
   */
  async resolveOpen(): Promise<CalibratorSummary> {
    const measurements = await this.deps.getMeasurements()
    const open = measurements.filter((m) => m.sampleSize === 0)

    let resolved = 0
    let pending = 0
    for (const measurement of open) {
      const didResolve = await this.resolveOne(measurement)
      if (didResolve) resolved += 1
      else pending += 1
    }
    return { resolved, pending, inspected: open.length }
  }

  private async resolveOne(measurement: TruthMeasurement): Promise<boolean> {
    const roles = await this.deps.resolveProposalRoles(measurement.proposalId)
    if (roles.length === 0) return false

    const points = (await Promise.all(roles.map((r) => this.deps.listRolePoints(r)))).flat()
    const anchor = Date.parse(measurement.recordedAt)
    if (!Number.isFinite(anchor)) return false

    const inWindow = (p: CalibratorRolePoint, from: number, to: number): boolean => {
      const t = Date.parse(p.at)
      return Number.isFinite(t) && t >= from && t < to
    }
    const baseline = points.filter((p) => inWindow(p, anchor - this.baselineWindowMs, anchor))
    const post = points.filter((p) => inWindow(p, anchor, this.now().getTime()))

    if (baseline.length === 0 || post.length < this.minPostSamples) return false

    const mean = (values: Array<number | undefined>): number | undefined => {
      const nums = values.filter((v): v is number => typeof v === "number")
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined
    }
    const delta = (before: number | undefined, after: number | undefined): number =>
      before !== undefined && after !== undefined ? after - before : 0

    const actual = {
      qualityDelta: delta(
        mean(baseline.map((p) => p.reviewScore)),
        mean(post.map((p) => p.reviewScore)),
      ),
      latencyDeltaMs: delta(
        mean(baseline.map((p) => p.executionTimeMs)),
        mean(post.map((p) => p.executionTimeMs)),
      ),
      costDelta: delta(mean(baseline.map((p) => p.costUsd)), mean(post.map((p) => p.costUsd))),
      riskDelta: 0, // no runtime anchor for risk yet — never fabricated
    }

    const resolvedMeasurement = TruthMeasurementSchema.parse({
      ...measurement,
      actual,
      sampleSize: post.length,
      recordedAt: measurement.recordedAt, // identity anchor for persistence
    })
    this.deps.resolveMeasurement(resolvedMeasurement)
    return true
  }
}
