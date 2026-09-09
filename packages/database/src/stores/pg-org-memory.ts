import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { orgEvents, orgEventsArchive } from "../schema.js";

type OrgEventType =
  | "capability_proposed" | "capability_promoted" | "capability_deprecated" | "capability_retired"
  | "agent_born" | "agent_retired" | "agent_merged" | "agent_split"
  | "team_optimized" | "governance_violation"
  | "proposal_rejected_by_human" | "proposal_approved_by_human";

interface OrganizationEvent {
  id: string;
  type: OrgEventType;
  subject: string;
  payload: Record<string, unknown>;
  at: string;
  archivedAt?: string;
  archiveBucket?: string;
}

interface OrgEventListOptions {
  includeArchived?: boolean;
}

interface ArchiveResult {
  archived: number;
}

interface RetentionOptions {
  retainDays: number;
}

/**
 * PostgreSQL-backed organization memory.
 * API-compatible with OrganizationMemory from @max/meta-system.
 */
export class PgOrgMemory {
  constructor(private db: PostgresJsDatabase) {}

  async record(
    type: OrgEventType,
    subject: string,
    payload: Record<string, unknown> = {},
  ): Promise<OrganizationEvent> {
    const id = `evt-${randomUUID()}`;
    const now = new Date();
    await this.db.insert(orgEvents).values({
      id,
      type,
      subject,
      payload,
      at: now,
    });
    return { id, type, subject, payload, at: now.toISOString() };
  }

  async listAll(options: OrgEventListOptions = {}): Promise<OrganizationEvent[]> {
    const rows = await this.db
      .select()
      .from(orgEvents)
      .where(isNull(orgEvents.archivedAt))
      .orderBy(desc(orgEvents.at));
    const out = rows.map(rowToEvent);
    if (!options.includeArchived) return out;

    const archived = await this.db
      .select()
      .from(orgEventsArchive)
      .orderBy(desc(orgEventsArchive.at));
    return [...out, ...archived.map(rowToEvent)].sort((a, b) => b.at.localeCompare(a.at));
  }

  async timeline(subject?: string, options: OrgEventListOptions = {}): Promise<OrganizationEvent[]> {
    if (subject) {
      const rows = await this.db
        .select()
        .from(orgEvents)
        .where(and(eq(orgEvents.subject, subject), isNull(orgEvents.archivedAt)))
        .orderBy(desc(orgEvents.at));
      const out = rows.map(rowToEvent);
      if (!options.includeArchived) return out;

      const archived = await this.db
        .select()
        .from(orgEventsArchive)
        .where(eq(orgEventsArchive.subject, subject))
        .orderBy(desc(orgEventsArchive.at));
      return [...out, ...archived.map(rowToEvent)].sort((a, b) => b.at.localeCompare(a.at));
    }
    return this.listAll(options);
  }

  async countByType(options: OrgEventListOptions = {}): Promise<Record<string, number>> {
    const rows = await this.listAll(options);
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.type] = (counts[row.type] ?? 0) + 1;
    }
    return counts;
  }

  async archiveOlderThan(cutoff: Date): Promise<ArchiveResult> {
    const archivedAt = new Date();
    const rows = await this.db.transaction(async (tx) => {
      // SELECT FOR UPDATE SKIP LOCKED prevents two workers from selecting
      // the same rows to archive, avoiding duplicate processing.
      const rows = await tx
        .select()
        .from(orgEvents)
        .where(and(lt(orgEvents.at, cutoff), isNull(orgEvents.archivedAt)))
        .for("update", { skipLocked: true });

      if (rows.length === 0) return [];

      await tx
        .insert(orgEventsArchive)
        .values(rows.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          type: row.type,
          subject: row.subject,
          payload: row.payload,
          at: row.at,
          archivedAt,
          archiveBucket: bucketFor(row.at),
        })))
        .onConflictDoNothing();

      // Delete only the rows we selected, not any new rows that might have
      // been inserted during this transaction with matching conditions.
      await tx
        .delete(orgEvents)
        .where(inArray(orgEvents.id, rows.map((r) => r.id)));

      return rows;
    });

    return { archived: rows.length };
  }

  async archiveByRetention(options: RetentionOptions): Promise<ArchiveResult> {
    return this.archiveOlderThan(cutoffForRetention(options.retainDays));
  }
}

function rowToEvent(row: typeof orgEvents.$inferSelect | typeof orgEventsArchive.$inferSelect): OrganizationEvent {
  return {
    id: row.id,
    type: row.type as OrgEventType,
    subject: row.subject,
    payload: (row.payload as Record<string, unknown>) ?? {},
    at: row.at.toISOString(),
    archivedAt: row.archivedAt?.toISOString(),
    archiveBucket: "archiveBucket" in row ? row.archiveBucket : undefined,
  };
}

function cutoffForRetention(retainDays: number): Date {
  return new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000);
}

function bucketFor(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
