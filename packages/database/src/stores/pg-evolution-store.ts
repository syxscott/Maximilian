import { eq, desc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { agentVersions, evolutionDecisions } from "../schema.js";

/**
 * PostgreSQL-backed store for agent versions and evolution decisions.
 * API-compatible with the file-based version/decision persistence in
 * EvolutionEngine from @max/evolution.
 */
export class PgEvolutionStore {
  constructor(private db: PostgresJsDatabase) {}

  // ---- Agent Versions -------------------------------------------------------

  async listVersions(role: string): Promise<AgentVersionRow[]> {
    const rows = await this.db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentRole, role));
    return rows.map(rowToVersion).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  async getCurrentVersion(role: string): Promise<AgentVersionRow | undefined> {
    const all = await this.listVersions(role);
    return all[all.length - 1];
  }

  async saveVersion(version: AgentVersionRow): Promise<void> {
    await this.db
      .insert(agentVersions)
      .values({
        id: version.id,
        agentRole: version.agentRole,
        manifest: version.manifest,
        createdAt: version.createdAt,
        retiredAt: version.retiredAt ?? null,
        reason: version.reason,
        stats: version.stats,
      })
      .onConflictDoUpdate({
        target: agentVersions.id,
        set: {
          manifest: version.manifest,
          retiredAt: version.retiredAt ?? null,
          reason: version.reason,
          stats: version.stats,
        },
      });
  }

  // ---- Evolution Decisions --------------------------------------------------

  async appendDecision(decision: EvolutionDecisionRow): Promise<void> {
    await this.db.insert(evolutionDecisions).values({
      id: decision.id,
      agentRole: decision.agentRole,
      fromVersion: decision.fromVersion,
      toVersion: decision.toVersion,
      outcome: decision.outcome,
      oldAvgScore: decision.oldAvgScore,
      newAvgScore: decision.newAvgScore,
      triggeredAt: decision.triggeredAt,
      reason: decision.reason,
    });
  }

  async listDecisions(role: string): Promise<EvolutionDecisionRow[]> {
    const rows = await this.db
      .select()
      .from(evolutionDecisions)
      .where(eq(evolutionDecisions.agentRole, role))
      .orderBy(desc(evolutionDecisions.triggeredAt));
    return rows.map(rowToDecision);
  }

  async listAllDecisions(): Promise<EvolutionDecisionRow[]> {
    const rows = await this.db
      .select()
      .from(evolutionDecisions)
      .orderBy(desc(evolutionDecisions.triggeredAt));
    return rows.map(rowToDecision);
  }
}

export interface AgentVersionRow {
  id: string;
  agentRole: string;
  manifest: unknown;
  createdAt: string;
  retiredAt?: string;
  reason: string;
  stats: { totalTasks: number; avgScore: number };
}

export interface EvolutionDecisionRow {
  id: string;
  agentRole: string;
  fromVersion: string;
  toVersion: string;
  outcome: "promoted" | "discarded";
  oldAvgScore: number;
  newAvgScore: number;
  triggeredAt: string;
  reason: string;
}

function rowToVersion(row: typeof agentVersions.$inferSelect): AgentVersionRow {
  return {
    id: row.id,
    agentRole: row.agentRole,
    manifest: row.manifest,
    createdAt: row.createdAt,
    retiredAt: row.retiredAt ?? undefined,
    reason: row.reason,
    stats: (row.stats as AgentVersionRow["stats"]) ?? { totalTasks: 0, avgScore: 0 },
  };
}

function rowToDecision(row: typeof evolutionDecisions.$inferSelect): EvolutionDecisionRow {
  return {
    id: row.id,
    agentRole: row.agentRole,
    fromVersion: row.fromVersion,
    toVersion: row.toVersion,
    outcome: row.outcome as "promoted" | "discarded",
    oldAvgScore: row.oldAvgScore,
    newAvgScore: row.newAvgScore,
    triggeredAt: row.triggeredAt,
    reason: row.reason,
  };
}

// PgEvolutionStore: PostgreSQL-backed agent version and evolution decision persistence.
// Replaces file-based storage in EvolutionEngine from @max/evolution.
