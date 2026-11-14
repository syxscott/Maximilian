// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Benchmark-drift wiring tests: the F1 trigger drift becomes a
 * predicted-vs-observed TruthMeasurement (truth-audit), and benchmark
 * drift signals resolve open predictions (truth-calibrator). Both are
 * additive wirings — existing functions untouched.
 */

import { describe, it, expect } from "vitest"
import { TruthAudit, buildTriggerDriftMeasurement } from "../src/truth-audit.js"
import { TruthCalibrator, type BenchmarkDriftSignal } from "../src/truth-calibrator.js"
import type { TruthMeasurement } from "../src/types.js"

describe("buildTriggerDriftMeasurement (truth-audit add-only)", () => {
  it("maps predicted/observed F1 onto the quality dimension", () => {
    const m = buildTriggerDriftMeasurement({
      proposalId: "prop-f1",
      proposalAction: "promote",
      predictedTriggerF1: 0.9,
      observedTriggerF1: 0.7,
    })
    expect(m.proposalId).toBe("prop-f1")
    expect(m.predicted.qualityDelta).toBe(0.9)
    expect(m.actual.qualityDelta).toBe(0.7)
    // Dimensions without a benchmark anchor resolve to 0 — never fabricated.
    expect(m.predicted.costDelta).toBe(0)
    expect(m.predicted.latencyDeltaMs).toBe(0)
    expect(m.predicted.riskDelta).toBe(0)
    expect(m.sampleSize).toBe(1)
  })

  it("verdicts through TruthAudit: observed F1 below predicted → over_predicted", async () => {
    const audit = await TruthAudit.create()
    // Drift 0.6 exceeds the qualityDelta tolerance (0.5).
    const m = audit.recordMeasurement({
      proposalId: "prop-drift",
      proposalAction: "promote",
      predicted: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0.9, riskDelta: 0 },
      actual: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0.3, riskDelta: 0 },
      sampleSize: 5,
    })
    expect(m.proposalId).toBe("prop-drift")
    const verification = audit.verify("prop-drift")
    expect(verification).not.toBeNull()
    expect(verification!.verdict).toBe("over_predicted")
    // Drift quality = observed − predicted.
    expect(verification!.drifts.qualityDelta).toBeCloseTo(-0.6, 6)
  })
})

describe("TruthCalibrator.resolveBenchmarkDrift (add-only)", () => {
  const ANCHOR = "2026-03-10T00:00:00.000Z"
  const DAY = 24 * 60 * 60_000

  function openMeasurement(): TruthMeasurement {
    return {
      proposalId: "prop-bench",
      proposalAction: "promote",
      predicted: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0.05, riskDelta: 0 },
      actual: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0 },
      sampleSize: 0,
      recordedAt: ANCHOR,
    }
  }

  function signals(): BenchmarkDriftSignal[] {
    // 3 baseline signals (F1 0.7, error rate 0.2) before the rollout and
    // 5 post signals (F1 0.9, error rate 0.0) after it.
    const out: BenchmarkDriftSignal[] = []
    for (let i = 1; i <= 3; i++) {
      out.push({
        at: new Date(Date.parse(ANCHOR) - i * DAY).toISOString(),
        triggerF1: 0.7,
        errorOnlyReasoningRate: 0.2,
      })
    }
    for (let i = 0; i < 5; i++) {
      out.push({
        at: new Date(Date.parse(ANCHOR) + (i + 1) * DAY).toISOString(),
        triggerF1: 0.9,
        errorOnlyReasoningRate: 0,
      })
    }
    return out
  }

  function makeCalibrator(
    signalsForRole: BenchmarkDriftSignal[],
    resolved: TruthMeasurement[],
  ): TruthCalibrator {
    return new TruthCalibrator({
      resolveProposalRoles: async () => ["backend"],
      getMeasurements: async () => [openMeasurement()],
      resolveMeasurement: (m) => resolved.push(m),
      listRolePoints: async () => [],
      listBenchmarkSignals: async () => signalsForRole,
      now: () => new Date(Date.parse(ANCHOR) + 30 * DAY),
    })
  }

  it("resolves the open prediction from F1 + error-rate deltas", async () => {
    const resolved: TruthMeasurement[] = []
    const calibrator = makeCalibrator(signals(), resolved)
    const summary = await calibrator.resolveBenchmarkDrift()
    expect(summary).toEqual({ resolved: 1, pending: 0, inspected: 1 })

    const m = resolved[0]!
    // qualityDelta = post F1 mean (0.9) − baseline mean (0.7).
    expect(m.actual.qualityDelta).toBeCloseTo(0.2, 6)
    // riskDelta = post error rate (0) − baseline (0.2).
    expect(m.actual.riskDelta).toBeCloseTo(-0.2, 6)
    // Un-anchored dimensions stay 0.
    expect(m.actual.costDelta).toBe(0)
    expect(m.actual.latencyDeltaMs).toBe(0)
    expect(m.sampleSize).toBe(5)
    // Identity anchor preserved for persistence.
    expect(m.recordedAt).toBe(ANCHOR)
    // The predicted side is untouched (resolve replaces actuals only).
    expect(m.predicted.qualityDelta).toBe(0.05)
  })

  it("stays pending without enough post-window signals", async () => {
    const few = signals().slice(0, 6) // 3 baseline + 3 post (< minPostSamples 5)
    const resolved: TruthMeasurement[] = []
    const calibrator = makeCalibrator(few, resolved)
    const summary = await calibrator.resolveBenchmarkDrift()
    expect(summary).toEqual({ resolved: 0, pending: 1, inspected: 1 })
    expect(resolved).toHaveLength(0)
  })

  it("stays pending when no baseline anchor exists", async () => {
    const postOnly = signals().slice(3)
    const resolved: TruthMeasurement[] = []
    const calibrator = makeCalibrator(postOnly, resolved)
    const summary = await calibrator.resolveBenchmarkDrift()
    expect(summary.resolved).toBe(0)
    expect(resolved).toHaveLength(0)
  })

  it("is a no-op when benchmark signals are not wired", async () => {
    const resolved: TruthMeasurement[] = []
    const calibrator = new TruthCalibrator({
      resolveProposalRoles: async () => ["backend"],
      getMeasurements: async () => [openMeasurement()],
      resolveMeasurement: (m) => resolved.push(m),
      listRolePoints: async () => [],
      now: () => new Date(Date.parse(ANCHOR) + 30 * DAY),
    })
    const summary = await calibrator.resolveBenchmarkDrift()
    expect(summary).toEqual({ resolved: 0, pending: 0, inspected: 0 })
    expect(resolved).toHaveLength(0)
  })
})
