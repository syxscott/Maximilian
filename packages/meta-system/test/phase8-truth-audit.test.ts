/**
 * Phase 8.7 — TruthAudit runtime engine tests.
 *
 * Verifies that prediction-vs-reality measurement, per-proposal verdicts,
 * global calibration reports, and drift detection all work end-to-end.
 */

import { describe, it, expect } from "vitest";
import {
  TruthAudit,
  buildMeasurement,
  type TruthAuditDeps,
} from "../src/truth-audit.js";
import {
  TRUTH_AUDIT_CONFIG,
  type TruthMeasurement,
} from "../src/types.js";

const fixedNow = () => new Date("2026-06-22T12:00:00.000Z");

function makeAudit(deps: TruthAuditDeps = {}): TruthAudit {
  return new TruthAudit({ now: fixedNow, ...deps });
}

describe("TruthAudit (Phase 8.7 — prediction-vs-reality)", () => {
  it("empty store returns null on verify and empty report", async () => {
    const a = makeAudit();
    expect(a.size()).toBe(0);
    expect(a.verify("missing")).toBeNull();
    const r = await a.report();
    expect(r.totalMeasurements).toBe(0);
    expect(r.verdictCounts.accurate).toBe(0);
    expect(r.recalibrationRecommended).toBe(false);
  });

  it("recordMeasurement parses input via schema and timestamps it", () => {
    const a = makeAudit();
    const m = a.recordMeasurement({
      proposalId: "p-1",
      proposalAction: "birth",
      predicted: { costDelta: 0.5, latencyDeltaMs: 100, qualityDelta: 1.0, riskDelta: 0.1 },
      actual:    { costDelta: 0.6, latencyDeltaMs: 110, qualityDelta: 0.9, riskDelta: 0.12 },
      sampleSize: 5,
    });
    expect(m.recordedAt).toBe("2026-06-22T12:00:00.000Z");
    expect(a.size()).toBe(1);
  });

  it("verify returns accurate when all dims within tolerance", () => {
    const a = makeAudit();
    for (let i = 0; i < 5; i++) {
      a.recordMeasurement({
        proposalId: "p-ok",
        proposalAction: "promote",
        predicted: { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: 0.5, riskDelta: 0.05 },
        actual:    { costDelta: 0.12, latencyDeltaMs: 60, qualityDelta: 0.55, riskDelta: 0.06 },
        sampleSize: 3,
      });
    }
    const v = a.verify("p-ok");
    expect(v).not.toBeNull();
    expect(v!.verdict).toBe("accurate");
    expect(v!.needsRecalibration).toBe(false);
    expect(v!.sampleSize).toBe(15);
    expect(v!.maxAbsoluteError).toBeGreaterThan(0);
  });

  it("verify returns over_predicted when reality was worse than predicted", () => {
    const a = makeAudit();
    for (let i = 0; i < 5; i++) {
      a.recordMeasurement({
        proposalId: "p-bad",
        proposalAction: "birth",
        predicted: { costDelta: 1.0, latencyDeltaMs: 200, qualityDelta: 2.0, riskDelta: 0.1 },
        actual:    { costDelta: 1.0, latencyDeltaMs: 200, qualityDelta: -0.5, riskDelta: 0.1 },
        sampleSize: 3,
      });
    }
    const v = a.verify("p-bad");
    expect(v).not.toBeNull();
    expect(v!.verdict).toBe("over_predicted");
    expect(v!.drifts.qualityDelta).toBeLessThan(0);
  });

  it("verify returns under_predicted when reality was better than predicted", () => {
    const a = makeAudit();
    for (let i = 0; i < 5; i++) {
      a.recordMeasurement({
        proposalId: "p-good",
        proposalAction: "promote",
        predicted: { costDelta: 0.5, latencyDeltaMs: 200, qualityDelta: 0.5, riskDelta: 0.1 },
        actual:    { costDelta: 0.5, latencyDeltaMs: 200, qualityDelta: 2.0, riskDelta: 0.1 },
        sampleSize: 3,
      });
    }
    const v = a.verify("p-good");
    expect(v).not.toBeNull();
    expect(v!.verdict).toBe("under_predicted");
    expect(v!.drifts.qualityDelta).toBeGreaterThan(0);
  });

  it("verify returns insufficient_data when sampleSize below threshold", () => {
    const a = makeAudit();
    a.recordMeasurement({
      proposalId: "p-few",
      proposalAction: "retire",
      predicted: { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: 0.5, riskDelta: 0.05 },
      actual:    { costDelta: 1.5, latencyDeltaMs: 500, qualityDelta: -3.0, riskDelta: 0.5 },
      sampleSize: 1,
    });
    const v = a.verify("p-few");
    expect(v).not.toBeNull();
    expect(v!.verdict).toBe("insufficient_data");
    expect(v!.needsRecalibration).toBe(false);
  });

  it("needsRecalibration triggers when relative error ≥ 1.0", () => {
    const a = makeAudit();
    for (let i = 0; i < 5; i++) {
      a.recordMeasurement({
        proposalId: "p-off",
        proposalAction: "birth",
        predicted: { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: 0.5, riskDelta: 0.05 },
        actual:    { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: -1.0, riskDelta: 0.05 },
        sampleSize: 3,
      });
    }
    const v = a.verify("p-off");
    expect(v).not.toBeNull();
    expect(v!.verdict).toBe("over_predicted");
    expect(v!.needsRecalibration).toBe(true);
  });

  it("report aggregates verdictCounts and mean errors", async () => {
    const a = makeAudit();
    // Three accurate proposals.
    for (let i = 0; i < 5; i++) {
      a.recordMeasurement({
        proposalId: `p-acc-${i}`,
        proposalAction: "promote",
        predicted: { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: 0.5, riskDelta: 0.05 },
        actual:    { costDelta: 0.11, latencyDeltaMs: 55, qualityDelta: 0.52, riskDelta: 0.06 },
        sampleSize: 3,
      });
    }
    // One over-predicted.
    for (let i = 0; i < 5; i++) {
      a.recordMeasurement({
        proposalId: "p-bad",
        proposalAction: "birth",
        predicted: { costDelta: 0.5, latencyDeltaMs: 100, qualityDelta: 1.0, riskDelta: 0.1 },
        actual:    { costDelta: 0.5, latencyDeltaMs: 100, qualityDelta: -1.5, riskDelta: 0.1 },
        sampleSize: 3,
      });
    }
    const r = await a.report();
    expect(r.totalMeasurements).toBeGreaterThan(0);
    expect(r.verdictCounts.accurate).toBeGreaterThan(0);
    expect(r.verdictCounts.over_predicted).toBe(1);
    expect(r.meanAbsoluteError.qualityDelta).toBeGreaterThan(0);
    expect(r.windowStart).toBeTruthy();
    expect(r.windowEnd).toBeTruthy();
  });

  it("recalibrationRecommended is true when mean quality MAE exceeds threshold", async () => {
    const a = makeAudit({ config: { recalibrationThreshold: 0.1 } });
    for (let i = 0; i < 5; i++) {
      a.recordMeasurement({
        proposalId: "p-drift",
        proposalAction: "birth",
        predicted: { costDelta: 0.5, latencyDeltaMs: 200, qualityDelta: 2.0, riskDelta: 0.1 },
        actual:    { costDelta: 0.5, latencyDeltaMs: 200, qualityDelta: 0.0, riskDelta: 0.1 },
        sampleSize: 3,
      });
    }
    const r = await a.report();
    expect(r.recalibrationRecommended).toBe(true);
  });

  it("findDrift returns top-N worst-calibrated proposals", async () => {
    const a = makeAudit();
    for (let i = 0; i < 5; i++) {
      a.recordMeasurement({
        proposalId: "p-good",
        proposalAction: "promote",
        predicted: { costDelta: 0.5, latencyDeltaMs: 100, qualityDelta: 1.0, riskDelta: 0.1 },
        actual:    { costDelta: 0.5, latencyDeltaMs: 100, qualityDelta: 1.05, riskDelta: 0.1 },
        sampleSize: 3,
      });
    }
    for (let i = 0; i < 5; i++) {
      a.recordMeasurement({
        proposalId: "p-bad",
        proposalAction: "birth",
        predicted: { costDelta: 0.5, latencyDeltaMs: 100, qualityDelta: 1.0, riskDelta: 0.1 },
        actual:    { costDelta: 0.5, latencyDeltaMs: 5000, qualityDelta: -5.0, riskDelta: 0.9 },
        sampleSize: 3,
      });
    }
    const leaders = await a.findDrift(3);
    expect(leaders.length).toBeGreaterThan(0);
    expect(leaders[0]!.proposalId).toBe("p-bad");
    expect(leaders[0]!.maxAbsoluteError).toBeGreaterThan(0);
  });

  it("merges external measurements via getMeasurements hook", async () => {
    const external: TruthMeasurement[] = [
      buildMeasurement({
        proposalId: "p-ext",
        proposalAction: "retire",
        predicted: { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: 0.5, riskDelta: 0.05 },
        actual:    { costDelta: 0.11, latencyDeltaMs: 55, qualityDelta: 0.51, riskDelta: 0.06 },
        sampleSize: 3,
        recordedAt: "2026-06-22T11:00:00.000Z",
      }),
    ];
    const a = makeAudit({ getMeasurements: async () => external });
    a.recordMeasurement({
      proposalId: "p-local",
      proposalAction: "promote",
      predicted: { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: 0.5, riskDelta: 0.05 },
      actual:    { costDelta: 0.12, latencyDeltaMs: 60, qualityDelta: 0.55, riskDelta: 0.06 },
      sampleSize: 3,
    });
    const r = await a.report();
    expect(r.totalMeasurements).toBe(2);
    const leaders = await a.findDrift(5);
    const externalLeader = leaders.find((l) => l.proposalId === "p-ext");
    expect(externalLeader).toBeDefined();
  });

  it("clear() wipes in-memory store without touching external source", async () => {
    const external: TruthMeasurement[] = [
      buildMeasurement({
        proposalId: "p-ext",
        proposalAction: "retire",
        predicted: { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: 0.5, riskDelta: 0.05 },
        actual:    { costDelta: 0.11, latencyDeltaMs: 55, qualityDelta: 0.51, riskDelta: 0.06 },
        sampleSize: 3,
      }),
    ];
    const a = makeAudit({ getMeasurements: async () => external });
    a.recordMeasurement({
      proposalId: "p-local",
      proposalAction: "promote",
      predicted: { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: 0.5, riskDelta: 0.05 },
      actual:    { costDelta: 0.12, latencyDeltaMs: 60, qualityDelta: 0.55, riskDelta: 0.06 },
      sampleSize: 3,
    });
    expect(a.size()).toBe(1);
    a.clear();
    expect(a.size()).toBe(0);
    const r = await a.report();
    expect(r.totalMeasurements).toBe(1); // external only
  });

  it("buildMeasurement helper parses input through schema", () => {
    const m = buildMeasurement({
      proposalId: "p-1",
      proposalAction: "merge",
      predicted: { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: 0.5, riskDelta: 0.05 },
      actual:    { costDelta: 0.2, latencyDeltaMs: 60, qualityDelta: 0.6, riskDelta: 0.07 },
    });
    expect(m.proposalAction).toBe("merge");
    expect(m.recordedAt).toBeTruthy();
  });

  it("TRUTH_AUDIT_CONFIG exposes tolerance and threshold defaults", () => {
    expect(TRUTH_AUDIT_CONFIG.minSampleSize).toBe(3);
    expect(TRUTH_AUDIT_CONFIG.tolerance.qualityDelta).toBe(0.5);
    expect(TRUTH_AUDIT_CONFIG.driftLeaderCount).toBe(5);
  });
});