import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { executions } from "../schema.js";

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
        },
      });
  }

  async get(id: string): Promise<ExecutionRecord | undefined> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(eq(executions.id, id))
      .limit(1);
    if (rows.length === 0) return undefined;
    return rowToExecution(rows[0]);
  }

  async listAll(): Promise<ExecutionRecord[]> {
    const rows = await this.db.select().from(executions);
    return rows.map(rowToExecution);
  }

  async listForWorkspace(workspaceId: string): Promise<ExecutionRecord[]> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(eq(executions.workspaceId, workspaceId));
    return rows.map(rowToExecution);
  }

  async listForRole(role: string): Promise<ExecutionRecord[]> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(eq(executions.agentRole, role));
    return rows.map(rowToExecution);
  }

  async listForBlueprint(blueprintId: string): Promise<ExecutionRecord[]> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(eq(executions.blueprintId, blueprintId));
    return rows.map(rowToExecution);
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

function rowToExecution(row: typeof executions.$inferSelect): ExecutionRecord {
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
  };
}
