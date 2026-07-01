import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { pendingProposals } from "../schema.js";

/**
 * PostgreSQL-backed pending proposal store.
 * API-compatible with PendingProposalStore from @max/meta-system.
 *
 * Stores HITL-gated proposals awaiting human approval/rejection.
 */
export class PgPendingProposalStore {
  constructor(private db: PostgresJsDatabase) {}

  async save(input: PendingProposalRow): Promise<void> {
    await this.db
      .insert(pendingProposals)
      .values({
        proposalId: input.proposalId,
        proposal: input.proposal,
        simulation: input.simulation,
        score: input.score,
        snapshotId: input.snapshotId ?? null,
        status: input.status,
        requestedAt: input.requestedAt,
        resolvedAt: input.resolvedAt ?? null,
        resolvedBy: input.resolvedBy ?? null,
        resolutionReason: input.resolutionReason ?? null,
      })
      .onConflictDoUpdate({
        target: pendingProposals.proposalId,
        set: {
          proposal: input.proposal,
          simulation: input.simulation,
          score: input.score,
          snapshotId: input.snapshotId ?? null,
          status: input.status,
          resolvedAt: input.resolvedAt ?? null,
          resolvedBy: input.resolvedBy ?? null,
          resolutionReason: input.resolutionReason ?? null,
        },
      });
  }

  async get(proposalId: string): Promise<PendingProposalRow | undefined> {
    const rows = await this.db
      .select()
      .from(pendingProposals)
      .where(eq(pendingProposals.proposalId, proposalId))
      .limit(1);
    if (rows.length === 0) return undefined;
    return rowToPendingProposal(rows[0]);
  }

  async listPending(): Promise<PendingProposalRow[]> {
    const rows = await this.db
      .select()
      .from(pendingProposals)
      .where(eq(pendingProposals.status, "pending_human"));
    return rows.map(rowToPendingProposal);
  }

  async listAll(): Promise<PendingProposalRow[]> {
    const rows = await this.db.select().from(pendingProposals);
    return rows.map(rowToPendingProposal);
  }

  async resolve(
    proposalId: string,
    action: "approved" | "rejected",
    resolvedBy: string,
    reason: string,
  ): Promise<void> {
    await this.db
      .update(pendingProposals)
      .set({
        status: action,
        resolvedAt: new Date().toISOString(),
        resolvedBy,
        resolutionReason: reason,
      })
      .where(eq(pendingProposals.proposalId, proposalId));
  }
}

export interface PendingProposalRow {
  proposalId: string;
  proposal: unknown;
  simulation: unknown;
  score: unknown;
  snapshotId?: string;
  status: string;               // pending_human | approved | rejected
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionReason?: string;
}

function rowToPendingProposal(row: typeof pendingProposals.$inferSelect): PendingProposalRow {
  return {
    proposalId: row.proposalId,
    proposal: row.proposal,
    simulation: row.simulation,
    score: row.score,
    snapshotId: row.snapshotId ?? undefined,
    status: row.status,
    requestedAt: row.requestedAt,
    resolvedAt: row.resolvedAt ?? undefined,
    resolvedBy: row.resolvedBy ?? undefined,
    resolutionReason: row.resolutionReason ?? undefined,
  };
}

// PgPendingProposalStore: PostgreSQL-backed HITL pending proposal persistence.
// Replaces file-based PendingProposalStore from @max/meta-system.
