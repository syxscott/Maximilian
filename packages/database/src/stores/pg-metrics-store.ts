import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { computeCost } from "@max/core";
import { metrics } from "../schema.js";

interface MetricRecord {
  taskId: string;
  agentId: string;
  agentRole: string;
  provider: string;
  model: string;
  executionTime: number;
  tokenInput: number;
  tokenOutput: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  reviewScore?: number;
  userAccepted?: boolean;
  retryCount: number;
  error?: string;
  timestamp: string;
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
      });
  }

  async get(taskId: string, tenantId?: string): Promise<MetricRecord | undefined> {
    const tenantFilter = tenantId ? eq(metrics.tenantId, tenantId) : undefined;
    const where = tenantFilter
      ? and(eq(metrics.taskId, taskId), tenantFilter)
      : eq(metrics.taskId, taskId);
    const rows = await this.db
      .select()
      .from(metrics)
      .where(where)
      .limit(1);
    if (rows.length === 0) return undefined;
    return rowToMetric(rows[0]);
  }

  async listAll(tenantId?: string): Promise<MetricRecord[]> {
    // When tenantId is provided, filter by it. When undefined, return only
    // legacy records with no tenantId (NULL) for backward compatibility.
    const where = tenantId
      ? eq(metrics.tenantId, tenantId)
      : isNull(metrics.tenantId);
    const rows = await this.db.select().from(metrics).where(where);
    return rows.map(rowToMetric);
  }

  async listForRole(role: string, tenantId?: string): Promise<MetricRecord[]> {
    const where = tenantId
      ? and(eq(metrics.agentRole, role), eq(metrics.tenantId, tenantId))
      : eq(metrics.agentRole, role);
    const rows = await this.db.select().from(metrics).where(where);
    return rows.map(rowToMetric);
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
    );
  }
}

function rowToMetric(row: typeof metrics.$inferSelect): MetricRecord {
  return {
    taskId: row.taskId,
    agentId: row.agentId,
    agentRole: row.agentRole,
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
  };
}
