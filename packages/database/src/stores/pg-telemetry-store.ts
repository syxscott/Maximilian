import { eq, desc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { telemetryExecutionTraces, telemetryEvolutionTraces } from "../schema.js";

/**
 * PostgreSQL-backed telemetry store.
 * API-compatible with TelemetryCollector persistence from @max/telemetry.
 *
 * Provides durable storage for execution traces and evolution traces.
 * The in-memory ring-buffer stays in TelemetryCollector; this store
 * replaces the JSONL file persistence layer.
 */
export class PgTelemetryStore {
  constructor(private db: PostgresJsDatabase) {}

  // ---- Execution Traces -----------------------------------------------------

  async saveExecutionTrace(trace: ExecutionTraceRow): Promise<void> {
    await this.db
      .insert(telemetryExecutionTraces)
      .values({
        id: trace.id,
        workspaceId: trace.workspaceId,
        taskId: trace.taskId,
        userPrompt: trace.userPrompt,
        assignedTeamGraph: trace.assignedTeamGraph,
        steps: trace.steps,
        status: trace.status,
        startedAt: trace.startedAt,
        completedAt: trace.completedAt ?? null,
        error: trace.error ?? null,
      })
      .onConflictDoUpdate({
        target: telemetryExecutionTraces.id,
        set: {
          workspaceId: trace.workspaceId,
          taskId: trace.taskId,
          userPrompt: trace.userPrompt,
          assignedTeamGraph: trace.assignedTeamGraph,
          steps: trace.steps,
          status: trace.status,
          completedAt: trace.completedAt ?? null,
          error: trace.error ?? null,
        },
      });
  }

  async listExecutionTraces(): Promise<ExecutionTraceRow[]> {
    const rows = await this.db
      .select()
      .from(telemetryExecutionTraces)
      .orderBy(desc(telemetryExecutionTraces.startedAt));
    return rows.map(rowToExecutionTrace);
  }

  async getExecutionTrace(id: string): Promise<ExecutionTraceRow | undefined> {
    const rows = await this.db
      .select()
      .from(telemetryExecutionTraces)
      .where(eq(telemetryExecutionTraces.id, id))
      .limit(1);
    if (rows.length === 0) return undefined;
    return rowToExecutionTrace(rows[0]);
  }

  // ---- Evolution Traces -----------------------------------------------------

  async saveEvolutionTrace(trace: EvolutionTraceRow): Promise<void> {
    await this.db
      .insert(telemetryEvolutionTraces)
      .values({
        id: trace.id,
        proposalId: trace.proposalId,
        proposalType: trace.proposalType,
        subject: trace.subject,
        snapshotId: trace.snapshotId ?? null,
        simulatedScores: trace.simulatedScores,
        governanceVerdict: trace.governanceVerdict,
        rolloutStatus: trace.rolloutStatus,
        approved: trace.approved,
        recordedAt: trace.recordedAt,
      })
      .onConflictDoUpdate({
        target: telemetryEvolutionTraces.id,
        set: {
          proposalId: trace.proposalId,
          proposalType: trace.proposalType,
          subject: trace.subject,
          snapshotId: trace.snapshotId ?? null,
          simulatedScores: trace.simulatedScores,
          governanceVerdict: trace.governanceVerdict,
          rolloutStatus: trace.rolloutStatus,
          approved: trace.approved,
        },
      });
  }

  async listEvolutionTraces(): Promise<EvolutionTraceRow[]> {
    const rows = await this.db
      .select()
      .from(telemetryEvolutionTraces)
      .orderBy(desc(telemetryEvolutionTraces.recordedAt));
    return rows.map(rowToEvolutionTrace);
  }

  async getEvolutionTrace(id: string): Promise<EvolutionTraceRow | undefined> {
    const rows = await this.db
      .select()
      .from(telemetryEvolutionTraces)
      .where(eq(telemetryEvolutionTraces.id, id))
      .limit(1);
    if (rows.length === 0) return undefined;
    return rowToEvolutionTrace(rows[0]);
  }
}

export interface ExecutionTraceRow {
  id: string;
  workspaceId: string;
  taskId: string;
  userPrompt: string;
  assignedTeamGraph: unknown;
  steps: unknown[];
  status: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface EvolutionTraceRow {
  id: string;
  proposalId: string;
  proposalType: string;
  subject: string;
  snapshotId?: string;
  simulatedScores: unknown;
  governanceVerdict: unknown;
  rolloutStatus: string;
  approved: boolean;
  recordedAt: string;
}

function rowToExecutionTrace(row: typeof telemetryExecutionTraces.$inferSelect): ExecutionTraceRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    taskId: row.taskId,
    userPrompt: row.userPrompt,
    assignedTeamGraph: row.assignedTeamGraph,
    steps: (row.steps as unknown[]) ?? [],
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? undefined,
    error: row.error ?? undefined,
  };
}

function rowToEvolutionTrace(row: typeof telemetryEvolutionTraces.$inferSelect): EvolutionTraceRow {
  return {
    id: row.id,
    proposalId: row.proposalId,
    proposalType: row.proposalType,
    subject: row.subject,
    snapshotId: row.snapshotId ?? undefined,
    simulatedScores: row.simulatedScores,
    governanceVerdict: row.governanceVerdict,
    rolloutStatus: row.rolloutStatus,
    approved: row.approved,
    recordedAt: row.recordedAt,
  };
}

// PgTelemetryStore: PostgreSQL-backed telemetry trace persistence.
// Replaces JSONL file persistence in TelemetryCollector from @max/telemetry.
