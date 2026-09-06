import { and, eq } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { computeCost, type AgentRole } from "@max/core"
import { metrics } from "../schema.js"

/**
 * Mirrors @max/evolution's MetricRecord (z.infer<typeof MetricRecordSchema>)
 * field-for-field so PgMetricsStore is structurally assignable to the
 * evolution package's MetricsStoreLike (EvolutionFacade metricsStore opt).
 * agentRole is the @max/core AgentRole union, and cache/retry counters are
 * non-optional (the zod schema defaults them to 0).
 */
interface MetricRecord {
  taskId: string
  agentId: string
  agentRole: AgentRole
  provider: string
  model: string
  executionTime: number
  tokenInput: number
  tokenOutput: number
  cacheReadTokens: number
  cacheCreationTokens: number
  reviewScore?: number
  userAccepted?: boolean
  retryCount: number
  error?: string
  timestamp: string
}

/**
 * PostgreSQL-backed metrics store.
 * API-compatible with MetricsStore from @max/evolution.
 */
export class PgMetricsStore {
  constructor(private db: PostgresJsDatabase) {}

  async record(record: MetricRecord): Promise<void> {
    await this.db
      .insert(metrics)
      .values({
        taskId: record.taskId,
        agentId: record.agentId,
        agentRole: record.agentRole,
        provider: record.provider,
        model: record.model,
        executionTime: String(record.executionTime),
        tokenInput: record.tokenInput,
        tokenOutput: record.tokenOutput,
        cacheReadTokens: record.cacheReadTokens ?? 0,
        cacheCreationTokens: record.cacheCreationTokens ?? 0,
        reviewScore: record.reviewScore != null ? String(record.reviewScore) : null,
        userAccepted: record.userAccepted ?? null,
        retryCount: record.retryCount,
        error: record.error ?? null,
        timestamp: record.timestamp,
      })
      .onConflictDoUpdate({
        target: metrics.taskId,
        set: {
          agentId: record.agentId,
          agentRole: record.agentRole,
          provider: record.provider,
          model: record.model,
          executionTime: String(record.executionTime),
          tokenInput: record.tokenInput,
          tokenOutput: record.tokenOutput,
          cacheReadTokens: record.cacheReadTokens ?? 0,
          cacheCreationTokens: record.cacheCreationTokens ?? 0,
          reviewScore: record.reviewScore != null ? String(record.reviewScore) : null,
          userAccepted: record.userAccepted ?? null,
          retryCount: record.retryCount,
          error: record.error ?? null,
          timestamp: record.timestamp,
        },
      })
  }

  async get(taskId: string, tenantId?: string): Promise<MetricRecord | undefined> {
    const tenantFilter = tenantId ? eq(metrics.tenantId, tenantId) : undefined
    const where = tenantFilter
      ? and(eq(metrics.taskId, taskId), tenantFilter)
      : eq(metrics.taskId, taskId)
    const rows = await this.db.select().from(metrics).where(where).limit(1)
    if (rows.length === 0) return undefined
    return rowToMetric(rows[0])
  }

  async listAll(opts: { tenantId?: string } = {}): Promise<MetricRecord[]> {
    // Signature matches the file-backed MetricsStore in @max/evolution so
    // this class is structurally assignable to it (EvolutionFacade opts).
    // Tenant scope: an explicit tenantId returns only that tenant's rows;
    // no tenantId returns everything (dev mode), mirroring metrics-store.ts.
    const where = opts.tenantId ? eq(metrics.tenantId, opts.tenantId) : undefined
    const rows = await this.db.select().from(metrics).where(where)
    return rows.map(rowToMetric)
  }

  async listForRole(role: string, tenantId?: string): Promise<MetricRecord[]> {
    const where = tenantId
      ? and(eq(metrics.agentRole, role), eq(metrics.tenantId, tenantId))
      : eq(metrics.agentRole, role)
    const rows = await this.db.select().from(metrics).where(where)
    return rows.map(rowToMetric)
  }

  static estimateCostUSD(record: MetricRecord): number {
    // Delegates to `@max/core`'s computeCost — keeps the price table in one
    // place across both file-backed and Postgres-backed metric stores. Cache
    // read/write tokens are included when present on the record.
    return computeCost(
      {
        input: record.tokenInput,
        output: record.tokenOutput,
        cacheRead: record.cacheReadTokens ?? 0,
        cacheCreation: record.cacheCreationTokens ?? 0,
      },
      undefined,
      record.provider,
      record.model,
    )
  }
}

function rowToMetric(row: typeof metrics.$inferSelect): MetricRecord {
  return {
    taskId: row.taskId,
    agentId: row.agentId,
    // The DB column is free-text; rows written by the evolution engine
    // always carry a valid AgentRole. Cast rather than widen the type.
    agentRole: row.agentRole as AgentRole,
    provider: row.provider,
    model: row.model,
    executionTime: Number(row.executionTime),
    tokenInput: row.tokenInput,
    tokenOutput: row.tokenOutput,
    cacheReadTokens: row.cacheReadTokens ?? 0,
    cacheCreationTokens: row.cacheCreationTokens ?? 0,
    reviewScore: row.reviewScore != null ? Number(row.reviewScore) : undefined,
    userAccepted: row.userAccepted ?? undefined,
    retryCount: row.retryCount,
    error: row.error ?? undefined,
    timestamp: row.timestamp,
  }
}
