import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { capabilities } from "../schema.js";

/**
 * PostgreSQL-backed capability registry.
 * API-compatible with CapabilityRegistry from @max/meta-system.
 *
 * Manages capability lifecycle: proposed -> experimental -> active -> deprecated -> retired.
 */
export class PgCapabilityStore {
  constructor(private db: PostgresJsDatabase) {}

  async get(id: string): Promise<CapabilityRow | undefined> {
    const rows = await this.db
      .select()
      .from(capabilities)
      .where(eq(capabilities.id, id))
      .limit(1);
    if (rows.length === 0) return undefined;
    return rowToCapability(rows[0]);
  }

  async save(record: CapabilityRow): Promise<void> {
    await this.db
      .insert(capabilities)
      .values({
        id: record.id,
        displayName: record.displayName,
        description: record.description,
        status: record.status,
        proposalId: record.proposalId ?? null,
        promotedAt: record.promotedAt ?? null,
        retiredAt: record.retiredAt ?? null,
        usageCount: record.usageCount,
        totalExecutions: record.totalExecutions,
        avgScore: record.avgScore,
        avgDurationMs: record.avgDurationMs,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      })
      .onConflictDoUpdate({
        target: capabilities.id,
        set: {
          displayName: record.displayName,
          description: record.description,
          status: record.status,
          proposalId: record.proposalId ?? null,
          promotedAt: record.promotedAt ?? null,
          retiredAt: record.retiredAt ?? null,
          usageCount: record.usageCount,
          totalExecutions: record.totalExecutions,
          avgScore: record.avgScore,
          avgDurationMs: record.avgDurationMs,
          updatedAt: record.updatedAt,
        },
      });
  }

  async listAll(): Promise<CapabilityRow[]> {
    const rows = await this.db.select().from(capabilities);
    return rows.map(rowToCapability);
  }

  async listByStatus(status: string): Promise<CapabilityRow[]> {
    const rows = await this.db
      .select()
      .from(capabilities)
      .where(eq(capabilities.status, status));
    return rows.map(rowToCapability);
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(capabilities).where(eq(capabilities.id, id));
  }
}

export interface CapabilityRow {
  id: string;
  displayName: string;
  description: string;
  status: string;               // proposed | experimental | active | deprecated | retired
  proposalId?: string;
  promotedAt?: string;
  retiredAt?: string;
  usageCount: number;
  totalExecutions: number;
  avgScore: number;
  avgDurationMs: number;
  createdAt: string;
  updatedAt: string;
}

function rowToCapability(row: typeof capabilities.$inferSelect): CapabilityRow {
  return {
    id: row.id,
    displayName: row.displayName,
    description: row.description,
    status: row.status,
    proposalId: row.proposalId ?? undefined,
    promotedAt: row.promotedAt ?? undefined,
    retiredAt: row.retiredAt ?? undefined,
    usageCount: row.usageCount,
    totalExecutions: row.totalExecutions,
    avgScore: row.avgScore,
    avgDurationMs: row.avgDurationMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// PgCapabilityStore: PostgreSQL-backed capability lifecycle persistence.
// Replaces file-based CapabilityRegistry from @max/meta-system.
