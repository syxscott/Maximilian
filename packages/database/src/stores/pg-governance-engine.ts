import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { PgGovernanceConfigStore, type GovernanceConfigRow } from "./pg-governance-config-store.js";

// Import types from meta-system without creating a hard dependency.
// The GovernanceEngine is used via structural typing.

/**
 * PostgreSQL-backed GovernanceEngine wrapper.
 *
 * Delegates config persistence to PgGovernanceConfigStore while keeping
 * the governance check/checkProposal logic in the original engine.
 *
 * Usage: construct this instead of GovernanceEngine when DATABASE_URL is set.
 * The check() and checkProposal() methods are identical to GovernanceEngine.
 */
export class PgGovernanceEngine {
  private configStore: PgGovernanceConfigStore;
  private config: GovernanceConfigRow;

  constructor(
    db: PostgresJsDatabase,
    defaultConfig: GovernanceConfigRow = DEFAULT_GOV_CONFIG,
  ) {
    this.configStore = new PgGovernanceConfigStore(db);
    this.config = defaultConfig;
  }

  async loadConfig(): Promise<GovernanceConfigRow> {
    const stored = await this.configStore.load();
    if (stored) {
      this.config = stored;
      return stored;
    }
    return this.config;
  }

  async saveConfig(cfg: GovernanceConfigRow): Promise<void> {
    await this.configStore.save(cfg);
    this.config = cfg;
  }

  getConfig(): GovernanceConfigRow {
    return this.config;
  }

  checkProposal(input: {
    proposal: { action: string };
    score: { riskPenalty: number };
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

  check(input: {
    graphs: Array<{ nodes: Array<{ id: string; dependsOn: string[] }> }>;
    capabilities: Array<{ status: string }>;
    blueprints: Array<{ retiredAt?: string }>;
  }): { allowed: boolean; reason: string; currentCounts: { agents: number; capabilities: number; depth: number }; status: string } {
    const agents = input.blueprints.filter((b) => !b.retiredAt).length;
    const capabilities = input.capabilities.filter((c) => c.status !== "retired").length;
    const depth = this.maxDepth(input.graphs);

    const counts = { agents, capabilities, depth };

    if (agents > this.config.maxAgents) {
      return { allowed: false, reason: `maxAgents limit reached (${agents}/${this.config.maxAgents})`, currentCounts: counts, status: "blocked" };
    }
    if (capabilities > this.config.maxCapabilities) {
      return { allowed: false, reason: `maxCapabilities limit reached (${capabilities}/${this.config.maxCapabilities})`, currentCounts: counts, status: "blocked" };
    }
    if (depth > this.config.maxDepth) {
      return { allowed: false, reason: `maxDepth exceeded (${depth}/${this.config.maxDepth})`, currentCounts: counts, status: "blocked" };
    }

    return { allowed: true, reason: "Within governance limits", currentCounts: counts, status: "approved" };
  }

  private maxDepth(graphs: Array<{ nodes: Array<{ id: string; dependsOn: string[] }> }>): number {
    let max = 0;
    for (const g of graphs) {
      const memo = new Map<string, number>();
      const depth = (id: string, visited = new Set<string>()): number => {
        const cached = memo.get(id);
        if (cached !== undefined) return cached;
        if (visited.has(id)) return 0;
        visited.add(id);
        const node = g.nodes.find((n) => n.id === id);
        if (!node) { memo.set(id, 0); return 0; }
        if (node.dependsOn.length === 0) { memo.set(id, 1); return 1; }
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

const DEFAULT_GOV_CONFIG: GovernanceConfigRow = {
  maxAgents: 20,
  maxCapabilities: 30,
  maxDepth: 4,
  requireReviewForBirth: true,
  minUsageForBirth: 0,
  hitlRiskThreshold: 0.4,
  hitlAlwaysForActions: ["retire"],
};

// PgGovernanceEngine: PostgreSQL-backed governance engine.
// Delegates config persistence to PgGovernanceConfigStore while keeping
// governance check logic identical to GovernanceEngine from @max/meta-system.
