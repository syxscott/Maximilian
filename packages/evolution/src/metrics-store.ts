/**
 * Phase 1 — Agent Performance Tracking.
 *
 * Persists one MetricRecord per task execution under <root>/metrics/<taskId>.json.
 * The file is the system-of-record; everything else is a derived view.
 *
 * No DB. No in-memory state beyond the most recently written records.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { computeCost } from "@max/core"
import { MetricRecordSchema, type MetricRecord } from "./types.js"

/**
 * Structural contract for metric stores. The file-backed MetricsStore
 * implements it, and PgMetricsStore (@max/database) is assignable too —
 * production entry points use this type so metrics can live in Postgres.
 * (Typing the option as the concrete class would make that impossible:
 * its private filesystem helpers defeat structural typing.)
 */
export interface MetricsStoreLike {
  record(record: MetricRecord): Promise<void>
  get(taskId: string): Promise<MetricRecord | undefined>
  listAll(opts?: { tenantId?: string }): Promise<MetricRecord[]>
  listForRole(role: string): Promise<MetricRecord[]>
}

export class MetricsStore {
  constructor(private rootDir: string) {}

  private metricsDir(): string {
    return path.join(this.rootDir, "metrics")
  }

  private fileFor(taskId: string): string {
    return path.join(this.metricsDir(), `${taskId}.json`)
  }

  private leaderboardFile(): string {
    return path.join(this.metricsDir(), "leaderboard.json")
  }

  async record(record: MetricRecord): Promise<void> {
    const parsed = MetricRecordSchema.parse(record)
    await fs.mkdir(this.metricsDir(), { recursive: true })
    await fs.writeFile(this.fileFor(parsed.taskId), JSON.stringify(parsed, null, 2), "utf-8")
  }

  async get(taskId: string): Promise<MetricRecord | undefined> {
    try {
      const raw = await fs.readFile(this.fileFor(taskId), "utf-8")
      return MetricRecordSchema.parse(JSON.parse(raw))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw err
    }
  }

  async listAll(opts: { tenantId?: string } = {}): Promise<MetricRecord[]> {
    try {
      const entries = await fs.readdir(this.metricsDir())
      const records: MetricRecord[] = []
      for (const name of entries) {
        if (!name.endsWith(".json") || name === "leaderboard.json") continue
        const raw = await fs.readFile(path.join(this.metricsDir(), name), "utf-8")
        records.push(MetricRecordSchema.parse(JSON.parse(raw)))
      }
      // Tenant scope: when a tenantId is supplied, return only records
      // tagged with that tenant. Legacy records (no tenantId) are only
      // visible when the caller passes no tenantId — i.e. dev mode.
      // This matches the policy enforced in `pg-execution-store.ts`:
      // scoped callers never see unscoped data. Once historical data
      // has been backfilled with `ten-default` (or equivalent) the
      // `tenantId === undefined` branch in dev mode can be removed.
      if (opts.tenantId !== undefined) {
        return records.filter((r) => r.tenantId === opts.tenantId)
      }
      return records
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
      throw err
    }
  }

  async listForRole(role: string): Promise<MetricRecord[]> {
    const all = await this.listAll()
    return all.filter((r) => r.agentRole === role)
  }

  /**
   * Approximate dollar cost from token counts + provider/model rate.
   * Delegates to `@max/core`'s `computeCost` so the price table is in one place
   * (DEFAULT_PRICING in packages/core/src/cost-control.ts). Cache read/write
   * tokens are factored in when the record carries them.
   */
  static estimateCostUSD(record: MetricRecord): number {
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
