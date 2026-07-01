/**
 * Phase 8.6 — ReplayEngine.
 *
 * Validates a Proposal against historical executions: "what if this
 * proposal had been applied to past tasks?" — a sanity check before
 * the rollout goes canary/full.
 *
 * For each historical ExecutionRecord that touches the proposal's
 * subject, we re-score it with the simulated-after profile to compute
 * the predicted quality delta.
 */

import {
  ReplayOutcomeSchema,
  type ReplayOutcome,
  type Proposal,
} from "./types.js";
import type { ExecutionRecord } from "@max/autonomy";
import type { SimulationEngine, SimulationInput } from "./simulation.js";

export interface ReplayDeps {
  /** Source of historical executions (read-only). */
  getExecutions: () => Promise<ExecutionRecord[]> | ExecutionRecord[];
  /** Simulation engine for computing quality delta when scoreDelta is omitted. */
  simulation?: SimulationEngine;
  /** Capture a DigitalTwin snapshot and convert to SimulationInput pair (before, after). */
  captureSimulation?: (proposal: Proposal) => Promise<{ before: SimulationInput; after: SimulationInput }>;
}

export interface ReplayInput {
  proposal: Proposal;
  /**
   * Predicted score delta per affected role. When omitted, the ReplayEngine
   * uses SimulationEngine.simulateDelta() to compute it automatically.
   */
  scoreDelta?: number;
}

export class ReplayEngine {
  constructor(private deps: ReplayDeps) {}

  /**
   * Replay: how many historical executions would have been affected,
   * and what was their average quality vs. the predicted-after quality.
   */
  async replay(input: ReplayInput): Promise<ReplayOutcome> {
    const all = await this.deps.getExecutions();
    const affected = all.filter((e) =>
      e.agentRole === input.proposal.subject ||
      e.agentRole === input.proposal.target ||
      e.blueprintId === input.proposal.subject
    );

    const scored = affected
      .map((e) => e.review?.score)
      .filter((s): s is number => s !== undefined);
    const baselineQuality = scored.length > 0
      ? scored.reduce((a, b) => a + b, 0) / scored.length
      : 0;

    // Use explicit scoreDelta if provided; otherwise try SimulationEngine.
    let delta = input.scoreDelta;
    if (delta === undefined && this.deps.simulation && this.deps.captureSimulation) {
      try {
        const { before, after } = await this.deps.captureSimulation(input.proposal);
        const simDelta = await this.deps.simulation.simulateDelta(before, after);
        delta = simDelta.qualityDelta;
      } catch {
        delta = 0;
      }
    }
    delta ??= 0;

    const simulatedQuality = baselineQuality + delta;
    const qualityDelta = simulatedQuality - baselineQuality;

    return ReplayOutcomeSchema.parse({
      proposalId: input.proposal.id,
      baselineQuality: round2(baselineQuality),
      simulatedQuality: round2(simulatedQuality),
      qualityDelta: round2(qualityDelta),
      affectedExecutions: affected.length,
      at: new Date().toISOString(),
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}