import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { governanceConfig } from "../schema.js";

const SINGLETON_ID = "singleton";

/**
 * PostgreSQL-backed governance config store.
 * API-compatible with GovernanceEngine config persistence from @max/meta-system.
 *
 * Stores a single governance configuration row. The engine's check/checkProposal
 * logic remains in the engine class; this store only handles persistence.
 */
export class PgGovernanceConfigStore {
  constructor(private db: PostgresJsDatabase) {}

  async load(): Promise<GovernanceConfigRow | undefined> {
    const rows = await this.db
      .select()
      .from(governanceConfig)
      .where(eq(governanceConfig.id, SINGLETON_ID))
      .limit(1);
    if (rows.length === 0) return undefined;
    return rowToConfig(rows[0]);
  }

  async save(cfg: GovernanceConfigRow): Promise<void> {
    await this.db
      .insert(governanceConfig)
      .values({
        id: SINGLETON_ID,
        maxAgents: cfg.maxAgents,
        maxCapabilities: cfg.maxCapabilities,
        maxDepth: cfg.maxDepth,
        requireReviewForBirth: cfg.requireReviewForBirth,
        minUsageForBirth: cfg.minUsageForBirth,
        hitlRiskThreshold: cfg.hitlRiskThreshold,
        hitlAlwaysForActions: cfg.hitlAlwaysForActions,
      })
      .onConflictDoUpdate({
        target: governanceConfig.id,
        set: {
          maxAgents: cfg.maxAgents,
          maxCapabilities: cfg.maxCapabilities,
          maxDepth: cfg.maxDepth,
          requireReviewForBirth: cfg.requireReviewForBirth,
          minUsageForBirth: cfg.minUsageForBirth,
          hitlRiskThreshold: cfg.hitlRiskThreshold,
          hitlAlwaysForActions: cfg.hitlAlwaysForActions,
          updatedAt: new Date(),
        },
      });
  }
}

export interface GovernanceConfigRow {
  maxAgents: number;
  maxCapabilities: number;
  maxDepth: number;
  requireReviewForBirth: boolean;
  minUsageForBirth: number;
  hitlRiskThreshold: number;
  hitlAlwaysForActions: string[];
}

function rowToConfig(row: typeof governanceConfig.$inferSelect): GovernanceConfigRow {
  return {
    maxAgents: row.maxAgents,
    maxCapabilities: row.maxCapabilities,
    maxDepth: row.maxDepth,
    requireReviewForBirth: row.requireReviewForBirth,
    minUsageForBirth: row.minUsageForBirth,
    hitlRiskThreshold: row.hitlRiskThreshold,
    hitlAlwaysForActions: (row.hitlAlwaysForActions as string[]) ?? ["retire"],
  };
}

// PgGovernanceConfigStore: PostgreSQL-backed governance configuration persistence.
// Replaces file-based config storage in GovernanceEngine from @max/meta-system.
