import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { failureInsights, leaderboardInsights } from "../schema.js";

/**
 * PostgreSQL-backed insights store.
 * API-compatible with InsightsStore from @max/autonomy.
 *
 * Stores failure patterns and leaderboard insights in PostgreSQL
 * instead of JSON files.
 */
export class PgInsightsStore {
  constructor(private db: PostgresJsDatabase) {}

  // ---- Failure Patterns -----------------------------------------------------

  async savePatterns(insights: FailureInsightRow[]): Promise<void> {
    // Replace all: delete existing, then insert new.
    await this.db.delete(failureInsights);
    if (insights.length === 0) return;
    await this.db.insert(failureInsights).values(
      insights.map((i) => ({
        id: i.id ?? `fi-${randomUUID().slice(0, 8)}`,
        pattern: i.pattern,
        frequency: i.frequency,
        agentRoles: i.agentRoles,
        providers: i.providers,
        models: i.models,
        avgScore: i.avgScore,
        examples: i.examples,
        firstSeen: i.firstSeen,
        lastSeen: i.lastSeen,
      }))
    );
  }

  async loadPatterns(): Promise<FailureInsightRow[]> {
    const rows = await this.db.select().from(failureInsights);
    return rows.map(rowToFailureInsight);
  }

  // ---- Leaderboard ----------------------------------------------------------

  async saveLeaderboard(insight: LeaderboardInsightRow): Promise<void> {
    await this.db
      .insert(leaderboardInsights)
      .values({
        id: "singleton",
        generatedAt: insight.generatedAt,
        totalExecutions: insight.totalExecutions,
        worstRoles: insight.worstRoles,
        worstModels: insight.worstModels,
      })
      .onConflictDoUpdate({
        target: leaderboardInsights.id,
        set: {
          generatedAt: insight.generatedAt,
          totalExecutions: insight.totalExecutions,
          worstRoles: insight.worstRoles,
          worstModels: insight.worstModels,
          updatedAt: new Date(),
        },
      });
  }

  async loadLeaderboard(): Promise<LeaderboardInsightRow | undefined> {
    const rows = await this.db
      .select()
      .from(leaderboardInsights)
      .where(eq(leaderboardInsights.id, "singleton"))
      .limit(1);
    if (rows.length === 0) return undefined;
    return rowToLeaderboard(rows[0]);
  }
}

export interface FailureInsightRow {
  id?: string;
  pattern: string;
  frequency: number;
  agentRoles: string[];
  providers: string[];
  models: string[];
  avgScore: number;
  examples: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface LeaderboardInsightRow {
  generatedAt: string;
  totalExecutions: number;
  worstRoles: Array<{ role: string; avgScore: number; sampleSize: number }>;
  worstModels: Array<{ provider: string; model: string; avgScore: number; sampleSize: number }>;
}

function rowToFailureInsight(row: typeof failureInsights.$inferSelect): FailureInsightRow {
  return {
    id: row.id,
    pattern: row.pattern,
    frequency: row.frequency,
    agentRoles: (row.agentRoles as string[]) ?? [],
    providers: (row.providers as string[]) ?? [],
    models: (row.models as string[]) ?? [],
    avgScore: row.avgScore,
    examples: (row.examples as string[]) ?? [],
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
  };
}

function rowToLeaderboard(row: typeof leaderboardInsights.$inferSelect): LeaderboardInsightRow {
  return {
    generatedAt: row.generatedAt,
    totalExecutions: row.totalExecutions,
    worstRoles: (row.worstRoles as LeaderboardInsightRow["worstRoles"]) ?? [],
    worstModels: (row.worstModels as LeaderboardInsightRow["worstModels"]) ?? [],
  };
}

// PgInsightsStore: PostgreSQL-backed failure pattern and leaderboard persistence.
// Replaces file-based InsightsStore from @max/autonomy.
