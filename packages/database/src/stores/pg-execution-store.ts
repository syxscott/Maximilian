import { and, eq, isNull, lt, or } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { executions, executionsArchive } from "../schema.js"

interface ExecutionRecord {
  id: string
  tenantId?: string
  taskId: string
  workspaceId: string
  agentRole: string
  blueprintId?: string
  blueprintVersion?: string
  graphId?: string
  modelAssignment?: { provider: string; model: string; reason?: string; score?: number }
  artifacts: string[]
  review?: unknown
  userFeedback: Array<{ at: string; text: string; rating?: number }>
  startedAt: string
  completedAt?: string
  durationMs?: number
  status: "pending" | "running" | "completed" | "failed"
  error?: string
  archivedAt?: string
  archiveBucket?: string
}

interface ExecutionListOptions {
  includeArchived?: boolean
  tenantId?: string
}

interface ArchiveResult {
  archived: number
}

interface RetentionOptions {
  retainDays: number
}

/**
 * PostgreSQL-backed execution store.
 * API-compatible with ExecutionStore from @max/autonomy.
 *
 * Tenant isolation: when `tenantId` is provided in list/get options, queries
 * filter on `executions.tenantId`. Records without a tenantId (legacy data
 * created before multi-tenant support) remain visible to all callers — this
 * matches the filesystem ExecutionStore behaviour.
 */
export class PgExecutionStore {
  constructor(private db: PostgresJsDatabase) {}

  async save(record: ExecutionRecord): Promise<void> {
    await this.db
      .insert(executions)
      .values({
        id: record.id,
        tenantId: record.tenantId ?? null,
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
          tenantId: record.tenantId ?? null,
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
      })
  }

  async get(id: string, tenantId?: string): Promise<ExecutionRecord | undefined> {
    const tenantFilter = tenantId
      ? or(eq(executions.tenantId, tenantId), isNull(executions.tenantId))
      : undefined
    const liveWhere = tenantFilter
      ? and(eq(executions.id, id), isNull(executions.archivedAt), tenantFilter)
      : and(eq(executions.id, id), isNull(executions.archivedAt))
    const rows = await this.db.select().from(executions).where(liveWhere).limit(1)
    if (rows.length > 0) return rowToExecution(rows[0])
    // Always check archive — get has no includeArchived flag, it's a direct lookup
    const archiveWhere = tenantId
      ? and(eq(executionsArchive.id, id), or(eq(executionsArchive.tenantId, tenantId), isNull(executionsArchive.tenantId)))
      : eq(executionsArchive.id, id)
    const archived = await this.db.select().from(executionsArchive).where(archiveWhere).limit(1)
    return archived[0] ? rowToExecution(archived[0]) : undefined
  }

  async listAll(tenantId?: string): Promise<ExecutionRecord[]> {
    const tenantFilter = tenantId
      ? or(eq(executions.tenantId, tenantId), isNull(executions.tenantId))
      : undefined
    const liveWhere = tenantFilter
      ? and(isNull(executions.archivedAt), tenantFilter)
      : isNull(executions.archivedAt)
    const rows = await this.db.select().from(executions).where(liveWhere)
    return rows.map(rowToExecution)
  }

  async listForWorkspace(workspaceId: string, tenantId?: string): Promise<ExecutionRecord[]> {
    const tenantFilter = tenantId
      ? or(eq(executions.tenantId, tenantId), isNull(executions.tenantId))
      : undefined
    const liveWhere = tenantFilter
      ? and(eq(executions.workspaceId, workspaceId), isNull(executions.archivedAt), tenantFilter)
      : and(eq(executions.workspaceId, workspaceId), isNull(executions.archivedAt))
    const rows = await this.db.select().from(executions).where(liveWhere)
    return rows.map(rowToExecution)
  }

  async listForRole(role: string, tenantId?: string): Promise<ExecutionRecord[]> {
    const tenantFilter = tenantId
      ? or(eq(executions.tenantId, tenantId), isNull(executions.tenantId))
      : undefined
    const liveWhere = tenantFilter
      ? and(eq(executions.agentRole, role), isNull(executions.archivedAt), tenantFilter)
      : and(eq(executions.agentRole, role), isNull(executions.archivedAt))
    const rows = await this.db.select().from(executions).where(liveWhere)
    return rows.map(rowToExecution)
  }

  async listForBlueprint(blueprintId: string, tenantId?: string): Promise<ExecutionRecord[]> {
    const tenantFilter = tenantId
      ? or(eq(executions.tenantId, tenantId), isNull(executions.tenantId))
      : undefined
    const liveWhere = tenantFilter
      ? and(eq(executions.blueprintId, blueprintId), isNull(executions.archivedAt), tenantFilter)
      : and(eq(executions.blueprintId, blueprintId), isNull(executions.archivedAt))
    const rows = await this.db.select().from(executions).where(liveWhere)
    return rows.map(rowToExecution)
  }

  async archiveOlderThan(cutoff: Date): Promise<ArchiveResult> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(and(lt(executions.startedAt, cutoff), isNull(executions.archivedAt)))
    if (rows.length === 0) return { archived: 0 }

    const archivedAt = new Date()
    await this.db
      .insert(executionsArchive)
      .values(
        rows.map((row) => ({
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
        })),
      )
      .onConflictDoNothing()

    await this.db
      .delete(executions)
      .where(and(lt(executions.startedAt, cutoff), isNull(executions.archivedAt)))

    return { archived: rows.length }
  }

  async archiveByRetention(options: RetentionOptions): Promise<ArchiveResult> {
    return this.archiveOlderThan(cutoffForRetention(options.retainDays))
  }

  async appendUserFeedback(
    executionId: string,
    text: string,
    rating?: number,
    tenantId?: string,
  ): Promise<ExecutionRecord> {
    const existing = await this.get(executionId, tenantId)
    if (!existing) throw new Error(`execution ${executionId} not found`)
    const feedback = [...existing.userFeedback, { at: new Date().toISOString(), text, rating }]
    // When tenantId is provided, only match that tenant — do NOT expose legacy
    // NULL-tenantId records to all callers (cross-tenant write leak).
    const tenantFilter = tenantId ? eq(executions.tenantId, tenantId) : undefined
    const where = tenantFilter
      ? and(eq(executions.id, executionId), tenantFilter)
      : eq(executions.id, executionId)
    await this.db.update(executions).set({ userFeedback: feedback }).where(where)
    return { ...existing, userFeedback: feedback }
  }
}

function rowToExecution(
  row: typeof executions.$inferSelect | typeof executionsArchive.$inferSelect,
): ExecutionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId ?? undefined,
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
  }
}

function cutoffForRetention(retainDays: number): Date {
  return new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000)
}

function bucketFor(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}
