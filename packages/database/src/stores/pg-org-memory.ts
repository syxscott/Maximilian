import { eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { orgEvents } from "../schema.js";

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

  async listAll(): Promise<OrganizationEvent[]> {
    const rows = await this.db
      .select()
      .from(orgEvents)
      .orderBy(desc(orgEvents.at));
    return rows.map(rowToEvent);
  }

  async timeline(subject?: string): Promise<OrganizationEvent[]> {
    if (subject) {
      const rows = await this.db
        .select()
        .from(orgEvents)
        .where(eq(orgEvents.subject, subject))
        .orderBy(desc(orgEvents.at));
      return rows.map(rowToEvent);
    }
    return this.listAll();
  }

  async countByType(): Promise<Record<string, number>> {
    const rows = await this.db.select().from(orgEvents);
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.type] = (counts[row.type] ?? 0) + 1;
    }
    return counts;
  }
}

function rowToEvent(row: typeof orgEvents.$inferSelect): OrganizationEvent {
  return {
    id: row.id,
    type: row.type as OrgEventType,
    subject: row.subject,
    payload: (row.payload as Record<string, unknown>) ?? {},
    at: row.at.toISOString(),
  };
}
