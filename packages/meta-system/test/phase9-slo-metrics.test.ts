/**
 * Phase 9 — SLO metric wiring for TruthAudit.
 *
 * Verifies that `report()` increments `truthAuditVerdictsTotal` once per
 * verdict bucketed by kind. This is the SLO-3 indicator source for the
 * `truth_audit_verdict_accuracy` dashboard chart.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  TruthAudit,
  type TruthAuditDeps,
} from "../src/truth-audit.js";
import { truthAuditVerdictsTotal } from "@max/telemetry";

const fixedNow = () => new Date("2026-08-18T12:00:00.000Z");

function makeAudit(deps: TruthAuditDeps = {}): TruthAudit {
  return new TruthAudit({ now: fixedNow, ...deps });
}

interface InternalCounter {
  hashMap: Record<string, { value: number; labels?: Record<string, string> }>;
}

function readCounter(counter: unknown, label?: Record<string, string>): number {
  const internal = counter as InternalCounter;
  if (!label) return internal.hashMap[""]?.value ?? 0;
  // Find the entry whose labels match. The label-key is the JSON
  // stringification prom-client uses internally; we just iterate.
  for (const entry of Object.values(internal.hashMap)) {
    const e = entry as { value: number; labels?: Record<string, string> };
    if (!e.labels) continue;
    if (Object.entries(label).every(([k, v]) => e.labels?.[k] === v)) {
      return e.value;
    }
  }
  return 0;
}

describe("TruthAudit — Phase 9 SLO metric wiring", () => {
  beforeEach(() => {
    // Reset the counter between tests so deltas are clean.
    truthAuditVerdictsTotal.reset();
  });

  it("report() increments truthAuditVerdictsTotal for each verdict bucket", async () => {
    const a = makeAudit();
    // Seed 3 accurate proposals
    for (const id of ["p-acc-1", "p-acc-2", "p-acc-3"]) {
      for (let i = 0; i < 5; i++) {
        a.recordMeasurement({
          proposalId: id,
          proposalAction: "promote",
          predicted: { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: 0.5, riskDelta: 0.05 },
          actual:    { costDelta: 0.12, latencyDeltaMs: 60, qualityDelta: 0.55, riskDelta: 0.06 },
          sampleSize: 3,
        });
      }
    }
    // Seed 2 over-predicted proposals (quality over-predicted)
    for (const id of ["p-over-1", "p-over-2"]) {
      for (let i = 0; i < 5; i++) {
        a.recordMeasurement({
          proposalId: id,
          proposalAction: "retire",
          predicted: { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: 1.0, riskDelta: 0.05 },
          actual:    { costDelta: 0.12, latencyDeltaMs: 60, qualityDelta: 0.2, riskDelta: 0.06 },
          sampleSize: 3,
        });
      }
    }

    const accurateBefore = readCounter(truthAuditVerdictsTotal, { verdict: "accurate" });
    const overBefore = readCounter(truthAuditVerdictsTotal, { verdict: "over_predicted" });

    await a.report();

    const accurateAfter = readCounter(truthAuditVerdictsTotal, { verdict: "accurate" });
    const overAfter = readCounter(truthAuditVerdictsTotal, { verdict: "over_predicted" });

    expect(accurateAfter - accurateBefore).toBe(3);
    expect(overAfter - overBefore).toBe(2);
  });

  it("insufficient_data verdicts also count (for SLO-3's total denominators)", async () => {
    const a = makeAudit();
    // Only 2 samples — under TRUTH_AUDIT_CONFIG.minSampleSize → insufficient_data
    for (let i = 0; i < 2; i++) {
      a.recordMeasurement({
        proposalId: "p-small",
        proposalAction: "birth",
        predicted: { costDelta: 0.1, latencyDeltaMs: 50, qualityDelta: 0.5, riskDelta: 0.05 },
        actual:    { costDelta: 0.12, latencyDeltaMs: 60, qualityDelta: 0.55, riskDelta: 0.06 },
        sampleSize: 1,
      });
    }
    const before = readCounter(truthAuditVerdictsTotal, { verdict: "insufficient_data" });
    await a.report();
    const after = readCounter(truthAuditVerdictsTotal, { verdict: "insufficient_data" });
    expect(after - before).toBe(1);
  });
});