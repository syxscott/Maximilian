/**
 * 6.3 — MetaAgent
 *
 * Decides which Agent Change actions to take:
 *   - create:    new capability proposal promoted → needs a blueprint
 *   - delete:    retirement decision for an active blueprint
 *   - merge:     two roles with overlapping capabilities & low scores
 *   - split:     one role with high latency / failure rate
 *
 * Output: AgentChangePlan
 */

import { randomUUID } from "node:crypto";
import {
  AgentChangePlanSchema,
  type AgentChange,
  type AgentChangePlan,
  type CapabilityRecord,
  type RetirementDecision,
} from "./types.js";

export interface MetaAgentInput {
  capabilities: CapabilityRecord[];
  retirements: RetirementDecision[];
  proposals: Array<{ capabilityId: string; evidenceCount: number }>;
  executionStats: Record<
    string,
    { avgScore: number; avgDurationMs: number; usageCount: number; failureRate: number }
  >;
}

export interface MetaAgentConfig {
  /** Min evidence for a proposal to become a "create". */
  minProposalEvidence?: number;
  /** Score below which two roles are considered merge candidates. */
  mergeScoreThreshold?: number;
  /** Latency above which a role is a split candidate. */
  splitLatencyMs?: number;
}

const DEFAULT_CONFIG: Required<MetaAgentConfig> = {
  minProposalEvidence: 3,
  mergeScoreThreshold: 5.0,
  splitLatencyMs: 60000,
};

export class MetaAgent {
  constructor(private config: MetaAgentConfig = {}) {}

  decide(input: MetaAgentInput): AgentChangePlan {
    const cfg = { ...DEFAULT_CONFIG, ...this.config };
    const decisions: AgentChange[] = [];

    // 1. CREATE for each promoted proposal with enough evidence.
    for (const p of input.proposals) {
      if (p.evidenceCount >= cfg.minProposalEvidence) {
        decisions.push({
          action: "create",
          agentRole: `${p.capabilityId}_agent`,
          reason: `Promote proposal '${p.capabilityId}' (evidence: ${p.evidenceCount})`,
        });
      }
    }

    // 2. DELETE for each retirement decision.
    for (const r of input.retirements) {
      decisions.push({
        action: "delete",
        agentRole: r.role,
        reason: `Retire ${r.blueprintId}: ${r.reason} (usage=${r.metrics.usageCount}, score=${r.metrics.avgScore.toFixed(2)})`,
      });
    }

    // 3. MERGE — two roles with low score and overlapping execution profile.
    const lowScoreRoles = Object.entries(input.executionStats)
      .filter(([, s]) => s.usageCount >= 5 && s.avgScore < cfg.mergeScoreThreshold)
      .map(([role]) => role);
    if (lowScoreRoles.length >= 2) {
      const [a, b] = lowScoreRoles.slice(0, 2);
      if (a && b) {
        decisions.push({
          action: "merge",
          agentRole: a,
          targetRole: b,
          reason: `Merge ${a} into ${b}: both below score ${cfg.mergeScoreThreshold}`,
        });
      }
    }

    // 4. SPLIT — role with high latency.
    const highLatencyRoles = Object.entries(input.executionStats)
      .filter(([, s]) => s.usageCount >= 5 && s.avgDurationMs > cfg.splitLatencyMs)
      .map(([role, s]) => ({ role, duration: s.avgDurationMs }));
    for (const h of highLatencyRoles) {
      decisions.push({
        action: "split",
        agentRole: h.role,
        targetRole: `${h.role}_planner`,
        reason: `Split ${h.role}: avgDuration ${h.duration.toFixed(0)}ms > ${cfg.splitLatencyMs}ms`,
      });
    }

    const expectedImpact = this.scoreImpact(decisions);
    const plan = AgentChangePlanSchema.parse({
      id: `change-${randomUUID().slice(0, 8)}`,
      decisions,
      expectedImpact,
      rationale: this.composeRationale(decisions),
      createdAt: new Date().toISOString(),
    });
    return plan;
  }

  private scoreImpact(decisions: AgentChange[]): AgentChangePlan["expectedImpact"] {
    let costDelta = 0;
    let latencyDeltaMs = 0;
    let qualityDelta = 0;
    for (const d of decisions) {
      switch (d.action) {
        case "create":
          costDelta += 1;
          qualityDelta += 0.2;
          break;
        case "delete":
          costDelta -= 1;
          break;
        case "merge":
          costDelta -= 0.5;
          latencyDeltaMs -= 500;
          qualityDelta -= 0.1;
          break;
        case "split":
          costDelta += 0.5;
          latencyDeltaMs -= 2000;
          qualityDelta += 0.3;
          break;
      }
    }
    return { costDelta, latencyDeltaMs, qualityDelta };
  }

  private composeRationale(decisions: AgentChange[]): string {
    if (decisions.length === 0) return "No actions needed; system is healthy.";
    const summary = decisions.map((d) => `${d.action}:${d.agentRole}`).join(", ");
    return `${decisions.length} change(s): ${summary}`;
  }
}
