// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the TruthCalibrator (hermes usage-anchor borrowing): open
 * truth measurements resolved from role telemetry — post-vs-baseline
 * anchor windows, pending-when-insufficient, and the in-place
 * replacement contract that keeps verify()'s means honest.
 */
import { describe, expect, it } from "vitest"
import { TruthAudit } from "../src/truth-audit.js"
import { TruthCalibrator, type CalibratorRolePoint } from "../src/truth-calibrator.js"
import type { TruthMeasurement } from "../src/types.js"

const ROLLOUT_AT = "2026-09-15T00:00:00.000Z"

function points(list: Array<[string, number]>): CalibratorRolePoint[] {
  return list.map(([at, reviewScore]) => ({ at, reviewScore }))
}

function makeHarness(rolePoints: CalibratorRolePoint[]) {
  // Pin the audit clock to the rollout instant so the anchor windows
  // in the fixtures are deterministic.
  const audit = new TruthAudit({
    idGenerator: (() => "id") as never,
    now: () => new Date(ROLLOUT_AT),
  })
  const open: TruthMeasurement = audit.recordMeasurement({
    proposalId: "prop-1",
    proposalAction: "promote",
    predicted: { costDelta: 1, latencyDeltaMs: 100, qualityDelta: 0.5, riskDelta: 0 },
    actual: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0 },
    sampleSize: 0,
  })
  const resolvedLog: TruthMeasurement[] = []
  const calibrator = new TruthCalibrator({
    listRolePoints: async () => rolePoints,
    resolveProposalRoles: async () => ["backend"],
    getMeasurements: () => [open],
    resolveMeasurement: (m) => {
      resolvedLog.push(m)
      audit.resolveMeasurement({
        proposalId: m.proposalId,
        actual: m.actual,
        sampleSize: m.sampleSize,
      })
    },
    minPostSamples: 3,
    baselineWindowMs: 7 * 24 * 60 * 60_000,
  })
  return { audit, calibrator, open, resolvedLog }
}

describe("TruthCalibrator", () => {
  it("resolves an open prediction once post-rollout telemetry accumulates", async () => {
    const { calibrator, resolvedLog, audit } = makeHarness(
      points([
        ["2026-09-10T00:00:00.000Z", 6],
        ["2026-09-12T00:00:00.000Z", 8],
        // post-rollout: mean 9 vs baseline mean 7 → +2 quality
        ["2026-09-16T00:00:00.000Z", 9],
        ["2026-09-17T00:00:00.000Z", 9],
        ["2026-09-18T00:00:00.000Z", 9],
      ]),
    )
    const summary = await calibrator.resolveOpen()
    expect(summary).toEqual({ resolved: 1, pending: 0, inspected: 1 })
    expect(resolvedLog).toHaveLength(1)
    expect(resolvedLog[0]!.actual.qualityDelta).toBeCloseTo(2)
    expect(resolvedLog[0]!.sampleSize).toBe(3)

    // The open placeholder was replaced in place — verify() now sees real
    // actuals, and no zero-sample row drags the mean.
    const verification = audit.verify("prop-1")
    expect(verification).not.toBeNull()
    expect(audit.openMeasurements()).toHaveLength(0)
  })

  it("keeps the prediction pending when post data is insufficient", async () => {
    const { calibrator, resolvedLog } = makeHarness(
      points([
        ["2026-09-10T00:00:00.000Z", 6],
        ["2026-09-16T00:00:00.000Z", 9],
        ["2026-09-17T00:00:00.000Z", 9],
      ]),
    )
    const summary = await calibrator.resolveOpen()
    expect(summary).toEqual({ resolved: 0, pending: 1, inspected: 1 })
    expect(resolvedLog).toHaveLength(0)
  })

  it("stays pending when the baseline anchor window is empty", async () => {
    const { calibrator, resolvedLog } = makeHarness(
      points([
        // all points AFTER rollout — no baseline
        ["2026-09-16T00:00:00.000Z", 9],
        ["2026-09-17T00:00:00.000Z", 9],
        ["2026-09-18T00:00:00.000Z", 9],
      ]),
    )
    const summary = await calibrator.resolveOpen()
    expect(summary.pending).toBe(1)
    expect(resolvedLog).toHaveLength(0)
  })

  it("stays pending when the proposal's roles carry no telemetry", async () => {
    const { calibrator, resolvedLog } = makeHarness([])
    const summary = await calibrator.resolveOpen()
    expect(summary.pending).toBe(1)
    expect(resolvedLog).toHaveLength(0)
  })
})
