/**
 * Phase 8.3 — Proposal Pipeline.
 *
 * The single chokepoint for every organization mutation.
 *
 *   MetaAgent / TeamOptimizer / EvolutionPlanner
 *     → createProposal(...)
 *     → pipeline.run(proposal)
 *         1. simulate  — DigitalTwin.apply + SimulationEngine.simulateDelta
 *         2. score     — utility = quality_gain − penalties
 *         3. approve   — score.approved && governance allows
 *         4. rollout   — shadow / canary / full
 *
 * No source is allowed to mutate the real system directly anymore;
 * MetaOrchestrator is the only caller of AgentBirth / AgentRetirement
 * / registry.transition / blueprintStore.save.
 */

import { randomUUID } from "node:crypto";
import { getLogger } from "@max/telemetry";

const log = getLogger("meta-system:proposal-pipeline");
import {
  ProposalSchema,
  DecisionScoreSchema,
  DECISION_SCORING_CONFIG,
  ROLLOUT_CONFIG,
  type Proposal,
  type ProposalAction,
  type ProposalSourceEnum,
  type DecisionScore,
  type SimulationDelta,
  type TelemetrySink,
} from "./types.js";
import type { SimulationEngine } from "./simulation.js";
import type {
  OrganizationSnapshot,
  CapabilityRecord,
} from "./types.js";
import { DigitalTwin, snapshotToSimulationInput } from "./digital-twin.js";

export interface CreateProposalInput {
  action: ProposalAction;
  subject: string;
  target?: string;
  rationale: string;
  source: ProposalSourceEnum;
  payload?: Record<string, unknown>;
}

export function createProposal(input: CreateProposalInput): Proposal {
  return ProposalSchema.parse({
    id: `prop-${randomUUID().slice(0, 8)}`,
    action: input.action,
    subject: input.subject,
    target: input.target,
    rationale: input.rationale,
    payload: input.payload ?? {},
    status: "draft",
    source: input.source,
    createdAt: new Date().toISOString(),
  });
}

export interface PipelineDeps {
  simulation: SimulationEngine;
  /**
   * Capture a fresh snapshot of the live organization for "before" state.
   * Called once per pipeline.run().
   */
  captureSnapshot: () => Promise<OrganizationSnapshot>;
  /** Phase 10 — optional telemetry for recording evolution traces. */
  telemetry?: TelemetrySink;
}

export interface PipelineResult {
  proposal: Proposal;
  simulation: SimulationDelta;
  score: DecisionScore;
  approved: boolean;
  rejectionReason?: string;
}

export class ProposalPipeline {
  constructor(private deps: PipelineDeps) {}

  /**
   * Run the full pipeline: simulate → score → approve.
   * The caller (MetaOrchestrator) is responsible for the actual mutation
   * if `approved === true`.
   */
  async run(proposal: Proposal): Promise<PipelineResult> {
    try {
      // 1. Simulate on twin.
      const snapshot = await this.deps.captureSnapshot();
      const twinAfter = DigitalTwin.apply(snapshot, {
        kind: proposal.action,
        subject: proposal.subject,
        target: proposal.target,
      });
      const beforeInput = snapshotToSimulationInput(snapshot, "before");
      const afterInput = snapshotToSimulationInput(twinAfter, "after");
      const simulation = await this.deps.simulation.simulateDelta(beforeInput, afterInput);

      // 2. Score via utility formula.
      const score = scoreProposal(proposal, simulation);

      // 3. Approve if utility > threshold.
      const approved = score.approved;

      // 4. Update proposal status to reflect pipeline outcome.
      const final: Proposal = {
        ...proposal,
        status: approved ? "approved" : "rejected",
      };

      const result: PipelineResult = {
        proposal: final,
        simulation,
        score,
        approved,
        rejectionReason: approved ? undefined : score.reason,
      };

      // Phase 10 — record evolution trace if telemetry is wired.
      if (this.deps.telemetry) {
        await this.deps.telemetry.recordEvolution({
          proposalId: final.id,
          proposalType: final.action,
          subject: final.subject,
          snapshotId: snapshot.id,
          simulatedScores: {
            costDelta: simulation.costDelta,
            latencyDeltaMs: simulation.latencyDeltaMs,
            qualityDelta: simulation.qualityDelta,
            riskDelta: simulation.riskDelta,
            utility: score.utility,
          },
          governanceVerdict: {
            allowed: approved,
            reason: result.rejectionReason ?? "approved",
          },
          rolloutStatus: "shadow",
          approved,
        });
      }

      return result;
    } catch (err) {
      log.error({ err, action: proposal.action, subject: proposal.subject }, "run failed");
      // Return a safe "rejected" result so the orchestrator can continue.
      return {
        proposal: { ...proposal, status: "rejected" },
        simulation: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0, simulatedAt: new Date().toISOString() },
        score: {
          proposalId: proposal.id,
          qualityGain: 0,
          latencyPenalty: 0,
          costPenalty: 0,
          riskPenalty: 0,
          utility: 0,
          approved: false,
          reason: `pipeline error: ${String(err)}`,
        },
        approved: false,
        rejectionReason: `pipeline error: ${String(err)}`,
      };
    }
  }
}

/**
 * Phase 8.5 — Decision Scoring.
 *
 * utility = quality_gain − latency_penalty − cost_penalty − risk_penalty
 *
 * Approved when utility > DECISION_SCORING_CONFIG.utilityThreshold.
 */
export function scoreProposal(
  proposal: Proposal,
  sim: SimulationDelta
): DecisionScore {
  const w = DECISION_SCORING_CONFIG;
  const qualityGain = sim.qualityDelta * w.qualityWeight;
  const latencyPenalty = Math.max(0, sim.latencyDeltaMs) * w.latencyWeight;
  const costPenalty = Math.max(0, sim.costDelta) * w.costWeight;
  const riskPenalty = Math.max(0, sim.riskDelta) * w.riskWeight;

  const utility = round2(
    qualityGain - latencyPenalty - costPenalty - riskPenalty
  );

  const approved = utility > w.utilityThreshold;
  const reason = approved
    ? `utility=${utility} ≥ threshold=${w.utilityThreshold}`
    : `utility=${utility} ≤ threshold=${w.utilityThreshold} (q=${qualityGain.toFixed(2)}, l=${latencyPenalty.toFixed(2)}, c=${costPenalty.toFixed(2)}, r=${riskPenalty.toFixed(2)})`;

  return DecisionScoreSchema.parse({
    proposalId: proposal.id,
    qualityGain: round2(qualityGain),
    latencyPenalty: round2(latencyPenalty),
    costPenalty: round2(costPenalty),
    riskPenalty: round2(riskPenalty),
    utility,
    approved,
    reason,
  });
}

/**
 * Convert AgentChangePlan.decisions (Phase 6) into Proposals (Phase 8).
 * Existing MetaAgent / TeamOptimizer outputs are still useful as input.
 */
export function fromAgentChange(
  decision: {
    action: "create" | "delete" | "merge" | "split";
    agentRole: string;
    targetRole?: string;
    reason: string;
  }
): Proposal {
  const map: Record<typeof decision.action, ProposalAction> = {
    create: "birth",
    delete: "retire",
    merge: "merge",
    split: "split",
  };
  return createProposal({
    action: map[decision.action],
    subject: decision.agentRole,
    target: decision.targetRole,
    rationale: decision.reason,
    source: "meta_agent",
  });
}

export function fromTeamHint(
  hint: {
    id: string;
    suggestions: Array<{
      type: string;
      targetRole?: string;
      rationale: string;
    }>;
  }
): Proposal[] {
  const out: Proposal[] = [];
  for (const s of hint.suggestions) {
    if (s.type === "remove_redundant" || s.type === "shrink_team") {
      out.push(
        createProposal({
          action: "retire",
          subject: s.targetRole ?? "unknown",
          rationale: s.rationale,
          source: "team_optimizer",
          payload: { hintId: hint.id, type: s.type },
        })
      );
    } else if (s.type === "grow_team" || s.type === "add_review_node") {
      out.push(
        createProposal({
          action: "rebalance_team",
          subject: s.targetRole ?? "review",
          rationale: s.rationale,
          source: "team_optimizer",
          payload: { hintId: hint.id, type: s.type },
        })
      );
    } else if (s.type === "parallelize") {
      out.push(
        createProposal({
          action: "rebalance_team",
          subject: "all",
          rationale: s.rationale,
          source: "team_optimizer",
          payload: { hintId: hint.id, type: s.type },
        })
      );
    }
  }
  return out;
}

export function getDefaultRolloutMode(): import("./types.js").RolloutMode {
  return ROLLOUT_CONFIG.defaultMode;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Re-export for convenience
export type { OrganizationSnapshot, CapabilityRecord };