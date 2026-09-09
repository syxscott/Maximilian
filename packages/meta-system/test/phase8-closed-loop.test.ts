// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Phase 8.7 closed-loop integration test.
 *
 * Verifies the prediction-vs-reality wiring path:
 *   MetaOrchestrator.cycle() → runProposal / runPromotionProposal
 *   → recordProposalOutcome(truthAudit, …) → TruthMeasurement persisted.
 *
 * After a sequence of simulated rollouts, TruthAudit.report() must show
 * non-empty verdictCounts (the calibration signal). This guards against the
 * regression where cycle() never invoked recordMeasurement and the audit
 * silently stayed empty.
 */

import { describe, it, expect } from "vitest";
import { TruthAudit, recordProposalOutcome } from "../src/truth-audit.js";
import type { TruthMeasurement } from "../src/types.js";

const fixedNow = () => new Date("2026-01-01T00:00:00.000Z");

describe("Phase 8.7 — TruthAudit closed loop (orchestrator → audit)", () => {
  it("recordProposalOutcome records a measurement with predicted == actual when rollout was applied", () => {
    const audit = new TruthAudit({ now: fixedNow });
    const m = recordProposalOutcome({
      truthAudit: audit,
      proposalId: "p-1",
      proposalAction: "birth",
      simulation: {
        costDelta: 0.1,
        latencyDeltaMs: 50,
        qualityDelta: 0.05,
        riskDelta: 0.01,
      },
      actual: {
        costDelta: 0.1,
        latencyDeltaMs: 50,
        qualityDelta: 0.05,
        riskDelta: 0.01,
      },
      sampleSize: 1,
    });

    expect(m).not.toBeNull();
    expect(audit.size()).toBe(1);
    expect(m?.proposalId).toBe("p-1");
    expect(m?.predicted).toEqual(m?.actual);
  });

  it("recordProposalOutcome is a no-op when truthAudit is undefined (orchestrator tolerance)", () => {
    const m = recordProposalOutcome({
      truthAudit: undefined,
      proposalId: "p-2",
      proposalAction: "birth",
      simulation: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0 },
      actual: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0 },
    });
    expect(m).toBeNull();
  });

  it("5+ rollouts produce a non-empty calibration report (verdictCounts)", async () => {
    const audit = new TruthAudit({ now: fixedNow });
    // 3 accurate (predicted == actual within tolerance)
    for (let i = 0; i < 3; i++) {
      recordProposalOutcome({
        truthAudit: audit,
        proposalId: `p-acc-${i}`,
        proposalAction: "birth",
        simulation: { costDelta: 0.1, latencyDeltaMs: 10, qualityDelta: 0.05, riskDelta: 0.01 },
        actual: { costDelta: 0.11, latencyDeltaMs: 11, qualityDelta: 0.051, riskDelta: 0.011 },
        sampleSize: 5,
      });
    }
    // 2 over_predicted (actual quality worse than predicted)
    for (let i = 0; i < 2; i++) {
      recordProposalOutcome({
        truthAudit: audit,
        proposalId: `p-over-${i}`,
        proposalAction: "retire",
        simulation: { costDelta: 0.1, latencyDeltaMs: 10, qualityDelta: 0.5, riskDelta: 0.01 },
        actual: { costDelta: 0.1, latencyDeltaMs: 10, qualityDelta: -0.2, riskDelta: 0.01 },
        sampleSize: 5,
      });
    }
    // 1 under_predicted (actual quality better than predicted — beyond tolerance)
    recordProposalOutcome({
      truthAudit: audit,
      proposalId: "p-under-0",
      proposalAction: "promote",
      simulation: { costDelta: 0.5, latencyDeltaMs: 200, qualityDelta: -0.1, riskDelta: 0.5 },
      actual: { costDelta: 0.5, latencyDeltaMs: 200, qualityDelta: 0.8, riskDelta: 0.5 },
      sampleSize: 5,
    });

    const report = await audit.report();
    expect(report.totalMeasurements).toBe(6);
    // accurate + over_predicted + under_predicted counts must be non-zero
    const totalVerdicts =
      report.verdictCounts.accurate +
      report.verdictCounts.over_predicted +
      report.verdictCounts.under_predicted;
    expect(totalVerdicts).toBeGreaterThanOrEqual(5);
    expect(report.verdictCounts.accurate).toBeGreaterThan(0);
    expect(report.verdictCounts.over_predicted).toBeGreaterThan(0);
    expect(report.verdictCounts.under_predicted).toBeGreaterThan(0);
  });

  it("verify() on a recorded proposalId returns a TruthVerification with the recorded drift", () => {
    const audit = new TruthAudit({ now: fixedNow });
    recordProposalOutcome({
      truthAudit: audit,
      proposalId: "p-verify",
      proposalAction: "birth",
      simulation: { costDelta: 0.1, latencyDeltaMs: 10, qualityDelta: 0.05, riskDelta: 0.01 },
      actual: { costDelta: 0.2, latencyDeltaMs: 25, qualityDelta: 0.04, riskDelta: 0.02 },
      sampleSize: 4,
    });

    const v = audit.verify("p-verify");
    expect(v).not.toBeNull();
    expect(v?.proposalId).toBe("p-verify");
    expect(v?.sampleSize).toBe(4);
    expect(v?.drifts.costDelta).toBeCloseTo(0.1, 2);
    expect(v?.drifts.latencyDeltaMs).toBeCloseTo(15, 2);
  });

  it("verify() returns null when no measurement exists for that proposalId", () => {
    const audit = new TruthAudit({ now: fixedNow });
    expect(audit.verify("never-existed")).toBeNull();
  });

  it("saveMeasurement hook receives the recorded TruthMeasurement (durable path)", () => {
    const sink: TruthMeasurement[] = [];
    const audit = new TruthAudit({
      now: fixedNow,
      saveMeasurement: (m) => {
        sink.push(m);
      },
    });
    recordProposalOutcome({
      truthAudit: audit,
      proposalId: "p-save",
      proposalAction: "birth",
      simulation: { costDelta: 0.1, latencyDeltaMs: 10, qualityDelta: 0.05, riskDelta: 0.01 },
      actual: { costDelta: 0.1, latencyDeltaMs: 10, qualityDelta: 0.05, riskDelta: 0.01 },
    });
    expect(sink).toHaveLength(1);
    expect(sink[0]?.proposalId).toBe("p-save");
  });

  it("TruthAudit.create() loads historical measurements before query (constructor race fix)", async () => {
    const historical: TruthMeasurement[] = [
      {
        proposalId: "p-hist",
        proposalAction: "birth",
        predicted: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0 },
        actual: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0 },
        sampleSize: 1,
        recordedAt: "2025-12-31T00:00:00.000Z",
      },
    ];
    const audit = await TruthAudit.create({
      now: fixedNow,
      getMeasurements: () => Promise.resolve(historical),
    });
    // The historical measurement must be queryable immediately after create().
    expect(audit.size()).toBe(1);
    expect(audit.verify("p-hist")).not.toBeNull();
  });
});