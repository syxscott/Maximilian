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

/**
 * Benchmark-derived drift signal for a role window (borrowing
 * MiniMax-Provider-Verifier calculate_toolcall_similarity.py /
 * compare_with_baseline.py — benchmark suite summaries fed back as
 * calibration anchors). Both rates are 0..1; undefined means "not
 * measured in that window" and is skipped, never guessed.
 */
export interface BenchmarkDriftSignal {
  /** ISO timestamp the signal was measured at. */
  at: string
  /** ToolCalls-Trigger F1 of the window (candidate vs baseline corpus). */
  triggerF1?: number
  /** Error-only-reasoning rate of the window (higher = worse). */
  errorOnlyReasoningRate?: number
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
  /**
   * Benchmark-derived drift signals per role (benchmark-core suite
   * summaries). Optional — when unset, benchmark drift resolution is
   * simply unavailable.
   */
  listBenchmarkSignals?: (role: string) => Promise<BenchmarkDriftSignal[]> | BenchmarkDriftSignal[]
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

  /**
   * Resolve open predictions from BENCHMARK drift signals (additive
   * wiring; the telemetry path in {@link resolveOne} is untouched).
   *
   * Mapping (honesty boundaries identical to resolveOne):
   *   - triggerF1 post−baseline mean  → actual.qualityDelta
   *     (ToolCalls-Trigger F1 IS the quality dimension here),
   *   - errorOnlyReasoningRate post−baseline mean → actual.riskDelta
   *     (a rising only-reasoning failure rate is risk, not quality).
   * A dimension without signals in BOTH windows resolves to 0, and a
   * proposal without enough post-window signals stays pending — never
   * guessed.
   */
  async resolveBenchmarkDrift(): Promise<CalibratorSummary> {
    if (!this.deps.listBenchmarkSignals) {
      return { resolved: 0, pending: 0, inspected: 0 }
    }
    const measurements = await this.deps.getMeasurements()
    const open = measurements.filter((m) => m.sampleSize === 0)

    let resolved = 0
    let pending = 0
    for (const measurement of open) {
      const didResolve = await this.resolveBenchmarkOne(measurement)
      if (didResolve) resolved += 1
      else pending += 1
    }
    return { resolved, pending, inspected: open.length }
  }

  private async resolveBenchmarkOne(measurement: TruthMeasurement): Promise<boolean> {
    if (!this.deps.listBenchmarkSignals) return false
    const roles = await this.deps.resolveProposalRoles(measurement.proposalId)
    if (roles.length === 0) return false

    const signals = (await Promise.all(roles.map((r) => this.deps.listBenchmarkSignals!(r)))).flat()
    const anchor = Date.parse(measurement.recordedAt)
    if (!Number.isFinite(anchor)) return false

    const inWindow = (s: BenchmarkDriftSignal, from: number, to: number): boolean => {
      const t = Date.parse(s.at)
      return Number.isFinite(t) && t >= from && t < to
    }
    const baseline = signals.filter((s) => inWindow(s, anchor - this.baselineWindowMs, anchor))
    const post = signals.filter((s) => inWindow(s, anchor, this.now().getTime()))
    if (baseline.length === 0 || post.length < this.minPostSamples) return false

    const meanOf = (values: Array<number | undefined>): number | undefined => {
      const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined
    }
    const delta = (before: number | undefined, after: number | undefined): number =>
      before !== undefined && after !== undefined ? after - before : 0

    const actual = {
      qualityDelta: delta(
        meanOf(baseline.map((s) => s.triggerF1)),
        meanOf(post.map((s) => s.triggerF1)),
      ),
      riskDelta: delta(
        meanOf(baseline.map((s) => s.errorOnlyReasoningRate)),
        meanOf(post.map((s) => s.errorOnlyReasoningRate)),
      ),
      // Dimensions without a benchmark anchor resolve to 0 — never fabricated.
      costDelta: 0,
      latencyDeltaMs: 0,
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
