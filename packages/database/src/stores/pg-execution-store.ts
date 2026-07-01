import { and, eq, isNull, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { executions, executionsArchive } from "../schema.js";

interface ExecutionRecord {
  id: string;
  taskId: string;
  workspaceId: string;
  agentRole: string;
  blueprintId?: string;
  blueprintVersion?: string;
  graphId?: string;
  modelAssignment?: { provider: string; model: string; reason?: string; score?: number };
  artifacts: string[];
  review?: unknown;
  userFeedback: Array<{ at: string; text: string; rating?: number }>;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
  archivedAt?: string;
  archiveBucket?: string;
}

interface ExecutionListOptions {
  includeArchived?: boolean;
}

interface ArchiveResult {
  archived: number;
}

interface RetentionOptions {
  retainDays: number;
}

/**
 * PostgreSQL-backed execution store.
 * API-compatible with ExecutionStore from @max/autonomy.
 */
export class PgExecutionStore {
  constructor(private db: PostgresJsDatabase) {}

  async save(record: ExecutionRecord): Promise<void> {
    await this.db
      .insert(executions)
      .values({
        id: record.id,
        taskId: record.taskId,
        workspaceId: record.workspaceId,
        agentRole: record.agentRole,
        blueprintId: record.blueprintId ?? null,
        blueprintVersion: record.blueprintVersion ?? null,
        graphId: record.graphId ?? null,
        modelAssignment: record.modelAssignment ?? null,
        artifacts: record.artifacts,
        review: record.review ?? null,
        userFeedback: record.userFeedback,
        startedAt: new Date(record.startedAt),
        completedAt: record.completedAt ? new Date(record.completedAt) : null,
        durationMs: record.durationMs != null ? String(record.durationMs) : null,
        status: record.status,
        error: record.error ?? null,
        archivedAt: record.archivedAt ? new Date(record.archivedAt) : null,
      })
      .onConflictDoUpdate({
        target: executions.id,
        set: {
          taskId: record.taskId,
          workspaceId: record.workspaceId,
          agentRole: record.agentRole,
          blueprintId: record.blueprintId ?? null,
          blueprintVersion: record.blueprintVersion ?? null,
          graphId: record.graphId ?? null,
          modelAssignment: record.modelAssignment ?? null,
          artifacts: record.artifacts,
          review: record.review ?? null,
          userFeedback: record.userFeedback,
          completedAt: record.completedAt ? new Date(record.completedAt) : null,
          durationMs: record.durationMs != null ? String(record.durationMs) : null,
          status: record.status,
          error: record.error ?? null,
          archivedAt: record.archivedAt ? new Date(record.archivedAt) : null,
        },
      });
  }

  async get(id: string, options: ExecutionListOptions = {}): Promise<ExecutionRecord | undefined> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(and(eq(executions.id, id), isNull(executions.archivedAt)))
      .limit(1);
    if (rows.length > 0) return rowToExecution(rows[0]);
    if (!options.includeArchived) return undefined;

    const archived = await this.db
      .select()
      .from(executionsArchive)
      .where(eq(executionsArchive.id, id))
      .limit(1);
    return archived[0] ? rowToExecution(archived[0]) : undefined;
  }

  async listAll(options: ExecutionListOptions = {}): Promise<ExecutionRecord[]> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(isNull(executions.archivedAt));
    const out = rows.map(rowToExecution);
    if (!options.includeArchived) return out;

    const archived = await this.db.select().from(executionsArchive);
    return [...out, ...archived.map(rowToExecution)];
  }

  async listForWorkspace(workspaceId: string, options: ExecutionListOptions = {}): Promise<ExecutionRecord[]> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(and(eq(executions.workspaceId, workspaceId), isNull(executions.archivedAt)));
    const out = rows.map(rowToExecution);
    if (!options.includeArchived) return out;

    const archived = await this.db
      .select()
      .from(executionsArchive)
      .where(eq(executionsArchive.workspaceId, workspaceId));
    return [...out, ...archived.map(rowToExecution)];
  }

  async listForRole(role: string, options: ExecutionListOptions = {}): Promise<ExecutionRecord[]> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(and(eq(executions.agentRole, role), isNull(executions.archivedAt)));
    const out = rows.map(rowToExecution);
    if (!options.includeArchived) return out;

    const archived = await this.db
      .select()
      .from(executionsArchive)
      .where(eq(executionsArchive.agentRole, role));
    return [...out, ...archived.map(rowToExecution)];
  }

  async listForBlueprint(blueprintId: string, options: ExecutionListOptions = {}): Promise<ExecutionRecord[]> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(and(eq(executions.blueprintId, blueprintId), isNull(executions.archivedAt)));
    const out = rows.map(rowToExecution);
    if (!options.includeArchived) return out;

    const archived = await this.db
      .select()
      .from(executionsArchive)
      .where(eq(executionsArchive.blueprintId, blueprintId));
    return [...out, ...archived.map(rowToExecution)];
  }

  async archiveOlderThan(cutoff: Date): Promise<ArchiveResult> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(and(lt(executions.startedAt, cutoff), isNull(executions.archivedAt)));
    if (rows.length === 0) return { archived: 0 };

    const archivedAt = new Date();
    await this.db.insert(executionsArchive).values(rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      taskId: row.taskId,
      workspaceId: row.workspaceId,
      agentRole: row.agentRole,
      blueprintId: row.blueprintId,
      blueprintVersion: row.blueprintVersion,
      graphId: row.graphId,
      modelAssignment: row.modelAssignment,
      artifacts: row.artifacts,
      review: row.review,
      userFeedback: row.userFeedback,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      durationMs: row.durationMs,
      status: row.status,
      error: row.error,
      archivedAt,
      archiveBucket: bucketFor(row.startedAt),
    }))).onConflictDoNothing();

    await this.db
      .delete(executions)
      .where(and(lt(executions.startedAt, cutoff), isNull(executions.archivedAt)));

    return { archived: rows.length };
  }

  async archiveByRetention(options: RetentionOptions): Promise<ArchiveResult> {
    return this.archiveOlderThan(cutoffForRetention(options.retainDays));
  }

  async appendUserFeedback(
    executionId: string,
    text: string,
    rating?: number,
  ): Promise<ExecutionRecord> {
    const existing = await this.get(executionId);
    if (!existing) throw new Error(`execution ${executionId} not found`);
    const feedback = [...existing.userFeedback, { at: new Date().toISOString(), text, rating }];
    await this.db
      .update(executions)
      .set({ userFeedback: feedback })
      .where(eq(executions.id, executionId));
    return { ...existing, userFeedback: feedback };
  }
}

function rowToExecution(row: typeof executions.$inferSelect | typeof executionsArchive.$inferSelect): ExecutionRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    workspaceId: row.workspaceId,
    agentRole: row.agentRole,
    blueprintId: row.blueprintId ?? undefined,
    blueprintVersion: row.blueprintVersion ?? undefined,
    graphId: row.graphId ?? undefined,
    modelAssignment: (row.modelAssignment as ExecutionRecord["modelAssignment"]) ?? undefined,
    artifacts: (row.artifacts as string[]) ?? [],
    review: row.review ?? undefined,
    userFeedback: (row.userFeedback as ExecutionRecord["userFeedback"]) ?? [],
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    durationMs: row.durationMs != null ? Number(row.durationMs) : undefined,
    status: row.status as ExecutionRecord["status"],
    error: row.error ?? undefined,
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
