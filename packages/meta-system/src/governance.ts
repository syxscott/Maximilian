/**
 * 6.9 — GovernanceEngine
 *
 * Enforces organization safety limits:
 *   - maxAgents
 *   - maxCapabilities
 *   - maxDepth (longest path in team graph)
 *
 * Output: GovernanceVerdict (allowed / reason / counts)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  GovernanceConfigSchema,
  GovernanceVerdictSchema,
  DEFAULT_GOVERNANCE_CONFIG,
  type GovernanceConfig,
  type GovernanceVerdict,
  type CapabilityRecord,
  type Proposal,
  type DecisionScore,
} from "./types.js";
import type { TeamGraph, AgentBlueprint } from "@max/dags";

export interface GovernanceInput {
  graphs: TeamGraph[];
  capabilities: CapabilityRecord[];
  blueprints: AgentBlueprint[];
}

export class GovernanceEngine {
  constructor(
    private rootDir: string,
    private config: GovernanceConfig = DEFAULT_GOVERNANCE_CONFIG
  ) {}

  private configFile(): string {
    return path.join(this.rootDir, "governance-config.json");
  }

  async loadConfig(): Promise<GovernanceConfig> {
    try {
      const raw = await fs.readFile(this.configFile(), "utf-8");
      return GovernanceConfigSchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return this.config;
      }
      throw err;
    }
  }

  async saveConfig(cfg: GovernanceConfig): Promise<void> {
    const validated = GovernanceConfigSchema.parse(cfg);
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.writeFile(this.configFile(), JSON.stringify(validated, null, 2), "utf-8");
    this.config = validated;
  }

  /** Phase 7 — expose current config to orchestrator for early-block decisions. */
  getConfig(): GovernanceConfig {
    return this.config;
  }

  /**
   * Phase 11 — HITL gate: evaluate whether a proposal needs human approval.
   *
   * Returns `pending_human` when:
   *   - proposal.action is in `hitlAlwaysForActions` (default: ["retire"]), OR
   *   - score.riskPenalty > hitlRiskThreshold (default: 0.4)
   *
   * Otherwise returns `approved`.
   */
  checkProposal(input: {
    proposal: Proposal;
    score: DecisionScore;
  }): { status: "approved" | "blocked" | "pending_human"; reason: string } {
    const { proposal, score } = input;

    if (this.config.hitlAlwaysForActions.includes(proposal.action)) {
      return {
        status: "pending_human",
        reason: `action "${proposal.action}" requires human approval (hitlAlwaysForActions)`,
      };
    }

    if (score.riskPenalty > this.config.hitlRiskThreshold) {
      return {
        status: "pending_human",
        reason: `riskPenalty ${score.riskPenalty.toFixed(2)} exceeds threshold ${this.config.hitlRiskThreshold}`,
      };
    }

    return { status: "approved", reason: "within HITL thresholds" };
  }

  check(input: GovernanceInput): GovernanceVerdict {
    const agents = input.blueprints.filter((b) => !b.retiredAt).length;
    const capabilities = input.capabilities.filter(
      (c) => c.status !== "retired"
    ).length;
    const depth = this.maxDepth(input.graphs);

    const counts = { agents, capabilities, depth };

    if (agents > this.config.maxAgents) {
      return GovernanceVerdictSchema.parse({
        allowed: false,
        reason: `maxAgents limit reached (${agents}/${this.config.maxAgents})`,
        currentCounts: counts,
      });
    }
    if (capabilities > this.config.maxCapabilities) {
      return GovernanceVerdictSchema.parse({
        allowed: false,
        reason: `maxCapabilities limit reached (${capabilities}/${this.config.maxCapabilities})`,
        currentCounts: counts,
      });
    }
    if (depth > this.config.maxDepth) {
      return GovernanceVerdictSchema.parse({
        allowed: false,
        reason: `maxDepth exceeded (${depth}/${this.config.maxDepth})`,
        currentCounts: counts,
      });
    }

    return GovernanceVerdictSchema.parse({
      allowed: true,
      reason: "Within governance limits",
      currentCounts: counts,
    });
  }

  private maxDepth(graphs: TeamGraph[]): number {
    let max = 0;
    for (const g of graphs) {
      const memo = new Map<string, number>();
      const depth = (id: string, visited = new Set<string>()): number => {
        const cached = memo.get(id);
        if (cached !== undefined) return cached;
        if (visited.has(id)) return 0; // cycle detected
        visited.add(id);
        const node = g.nodes.find((n) => n.id === id);
        if (!node) {
          memo.set(id, 0);
          return 0;
        }
        if (node.dependsOn.length === 0) {
          memo.set(id, 1);
          return 1;
        }
        const d = 1 + Math.max(...node.dependsOn.map((dep) => depth(dep, visited)));
        memo.set(id, d);
        return d;
      };
      for (const n of g.nodes) {
        max = Math.max(max, depth(n.id));
      }
    }
    return max;
  }
}
