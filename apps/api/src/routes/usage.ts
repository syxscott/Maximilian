/**
 * Usage routes ? aggregate views over the per-task metric records collected
 * by the EvolutionEngine (token counts, cache hits, cost, success rate).
 *
 * Endpoints
 *   GET  /api/obs/usage/summary?range=today|1d|7d|14d|30d|custom[&groupBy=session|agentRole]
 *   GET  /api/obs/usage/daily?range=...[&groupBy=session|agentRole]
 *
 * Both reuse the file-backed MetricsStore (when no Postgres) and the
 * PgMetricsStore (when DATABASE_URL is set); the API layer treats them
 * identically via EvolutionFacade.metrics. The optional `groupBy` dimension
 * returns a per-session / per-role decomposition derived from the same single
 * `metrics.listAll` scan the summary already performs (token-monitor
 * sessionUsageArchive borrowing) — no second scan that could drift from the
 * totals.
 */

import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import { z } from "zod"
import { getLogger } from "@max/telemetry"
import { ErrorSchema } from "../schemas.js"
import { getFreshInputTokens } from "@max/providers"
import { DEFAULT_PRICING } from "@max/core"
import { MetricsStore, type EvolutionFacade, type MetricRecord } from "@max/evolution"
import { PaginationQuerySchema, paginate, type PaginationQuery } from "../lib/pagination.js"

const log = getLogger("usage")

export type UsageRangePreset = "today" | "1d" | "7d" | "14d" | "30d" | "all"

const DAY_MS = 24 * 60 * 60 * 1000

export interface ResolvedUsageRange {
  /** Unix ms; records with timestamp < this are excluded. */
  startMs: number
  /** Unix ms; records with timestamp >= this are excluded. */
  endMs: number
  /** Inclusive list of ISO dates (`YYYY-MM-DD`) between start/endMs. */
  days: string[]
}

function startOfUtcDay(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export function resolveUsageRange(
  preset: UsageRangePreset,
  nowMs: number = Date.now(),
): ResolvedUsageRange {
  const endMs = nowMs
  if (preset === "all") {
    // No lower bound; empty `days` so daily endpoint doesn't auto-fill.
    return { startMs: 0, endMs, days: [] }
  }
  let startMs: number
  let dayCount: number
  switch (preset) {
    case "today":
      startMs = startOfUtcDay(nowMs)
      dayCount = 1
      break
    case "1d":
      startMs = endMs - DAY_MS
      dayCount = 1
      break
    case "7d":
      startMs = endMs - 7 * DAY_MS
      dayCount = 7
      break
    case "14d":
      startMs = endMs - 14 * DAY_MS
      dayCount = 14
      break
    case "30d":
      startMs = endMs - 30 * DAY_MS
      dayCount = 30
      break
  }
  const days: string[] = []
  for (let i = dayCount - 1; i >= 0; i--) {
    days.push(new Date(endMs - i * DAY_MS).toISOString().slice(0, 10))
  }
  return { startMs, endMs, days }
}

export interface LatencyStats {
  /** p50 (median) latency in ms. */
  p50Ms: number
  /** p95 latency in ms. */
  p95Ms: number
  /** p99 latency in ms. */
  p99Ms: number
  /** Mean latency in ms. */
  avgMs: number
  /** Count of records that contributed to the percentile (excludes failures
   *  where executionTime is 0 or undefined). */
  sampleCount: number
}

export interface UsageSummary {
  range: UsageRangePreset
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  /** input + output + cache_creation (cache_read already inside input for
   *  OpenAI-style providers). Matches the "real" denominator most billing
   *  dashboards use. */
  realTotalTokens: number
  totalCostUsd: number
  /**
   * Real-cost semantics (openclaw borrowing): true only when every request
   * in range had a pricing entry. When false, `totalCostUsd` is a partial
   * sum and dashboards must show cost as unknown instead.
   */
  totalCostUsdKnown: boolean
  /** 0..1 fraction of successful requests (no error field). */
  successRate: number
  /** 0..1 cache hit rate over the full range. */
  cacheHitRate: number
  /** Subset of records that succeeded yet still came back unpriced ? see
   *  `isUnpricedUsage` in @max/providers. Non-zero value indicates the
   *  price table is missing an entry for a model that's actually routed to. */
  unpricedRequestCount: number
  /** Per-task latency distribution. */
  latency: LatencyStats
  /** Per-provider breakdown (mirrors token-monitor per-provider aggregation). */
  byProvider: Array<{
    provider: string
    totalRequests: number
    totalInputTokens: number
    totalOutputTokens: number
    totalCacheReadTokens: number
    totalCostUsd: number
    successRate: number
    cacheHitRate: number
  }>
  /**
   * Per-session rows; present only when `groupBy=session` was requested.
   * Group key is `MetricRecord.taskId` — the session/workspace association
   * key. Rows sum exactly to the summary totals.
   */
  bySession?: UsageBreakdownEntry[]
  /** Per-role rows; present only when `groupBy=agentRole` was requested. */
  byAgentRole?: UsageBreakdownEntry[]
}

/**
 * Decomposition dimension for range queries.
 *
 * (borrowing) token-monitor's sessionUsageArchive keeps one row per session
 * for every native range, so a range view can drill from the total into the
 * sessions that produced it. Maximilian has no separate session archive;
 * `MetricRecord.taskId` plays that role, and the decomposition is computed
 * from the same records list the summary aggregates.
 */
export type UsageGroupBy = "session" | "agentRole"

const USAGE_GROUP_BY_VALUES: readonly UsageGroupBy[] = ["session", "agentRole"]

export interface UsageBreakdownEntry {
  /** Group key: taskId for `session`, role name for `agentRole`. */
  key: string
  agentId: string
  agentRole: string
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  /** Same formula as `UsageSummary.realTotalTokens` (fresh input + output +
   *  cache creation), so entries sum exactly to the summary value. */
  realTotalTokens: number
  totalCostUsd: number
  /** False when any request in this group lacked a pricing entry. */
  totalCostUsdKnown: boolean
  successRate: number
  cacheHitRate: number
}

export type ParsedUsageGroupBy = { ok: true; groupBy?: UsageGroupBy } | { ok: false }

/**
 * Parse the optional `groupBy` query parameter. Absent → no breakdown (the
 * historical response shape); an unknown value is reported as invalid so the
 * route can answer 400 instead of silently ignoring a client typo.
 */
export function parseUsageGroupBy(raw: string | undefined): ParsedUsageGroupBy {
  if (raw === undefined) return { ok: true, groupBy: undefined }
  if ((USAGE_GROUP_BY_VALUES as readonly string[]).includes(raw)) {
    return { ok: true, groupBy: raw as UsageGroupBy }
  }
  return { ok: false }
}

interface BreakdownBucket {
  key: string
  agentId: string
  agentRole: string
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  freshInputTokens: number
  costUsd: number
  successes: number
  unpriced: number
}

/**
 * Aggregate the in-range records into one row per group key.
 *
 * Token/cost/rate formulas mirror `aggregateUsageSummary` exactly, so for
 * either dimension the group rows sum to the summary:
 *   - `realTotalTokens` sums to `summary.realTotalTokens`
 *   - `totalRequests`, `totalInputTokens`, `totalOutputTokens`,
 *     `totalCacheReadTokens`, `totalCacheCreationTokens`, `totalCostUsd`
 *     sum to their summary counterparts.
 * Groups are sorted by tokens (desc) then key (asc) for stable rendering.
 */
export function aggregateUsageBreakdown(
  records: MetricRecord[],
  range: ResolvedUsageRange,
  groupBy: UsageGroupBy,
): UsageBreakdownEntry[] {
  const buckets = new Map<string, BreakdownBucket>()
  for (const r of records) {
    if (!inRange(r, range)) continue
    // A record without its group dimension (legacy/malformed row) still has
    // to land in exactly one bucket: the rows must sum to the summary, and
    // an undefined key would crash the `key.localeCompare` sort below with a
    // 500. Keep it visible as a stable placeholder instead.
    const rawKey = groupBy === "session" ? r.taskId : r.agentRole
    const key = typeof rawKey === "string" && rawKey.length > 0 ? rawKey : "(unknown)"
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        key,
        agentId: r.agentId,
        agentRole: r.agentRole,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        freshInputTokens: 0,
        costUsd: 0,
        successes: 0,
        unpriced: 0,
      }
      buckets.set(key, bucket)
    }
    bucket.requests++
    bucket.inputTokens += r.tokenInput
    bucket.outputTokens += r.tokenOutput
    bucket.cacheReadTokens += r.cacheReadTokens ?? 0
    bucket.cacheCreationTokens += r.cacheCreationTokens ?? 0
    bucket.freshInputTokens += getFreshInputTokens({
      provider: r.provider,
      promptTokens: r.tokenInput,
      cacheReadTokens: r.cacheReadTokens ?? 0,
      cacheCreationTokens: r.cacheCreationTokens ?? 0,
    })
    bucket.costUsd += MetricsStore.estimateCostUSD(r)
    if (!r.error) bucket.successes++
    if (isUnpriced(r, hasExactPricingEntry)) bucket.unpriced++
  }

  return [...buckets.values()]
    .map((b) => ({
      key: b.key,
      agentId: b.agentId,
      agentRole: b.agentRole,
      totalRequests: b.requests,
      totalInputTokens: b.inputTokens,
      totalOutputTokens: b.outputTokens,
      totalCacheReadTokens: b.cacheReadTokens,
      totalCacheCreationTokens: b.cacheCreationTokens,
      realTotalTokens: b.freshInputTokens + b.outputTokens + b.cacheCreationTokens,
      totalCostUsd: b.costUsd,
      totalCostUsdKnown: b.unpriced === 0,
      successRate: b.requests > 0 ? b.successes / b.requests : 0,
      cacheHitRate:
        b.inputTokens + b.cacheCreationTokens > 0
          ? b.cacheReadTokens / (b.inputTokens + b.cacheCreationTokens)
          : 0,
    }))
    .sort((a, b) => b.realTotalTokens - a.realTotalTokens || a.key.localeCompare(b.key))
}

export interface DailyUsageEntry {
  date: string // YYYY-MM-DD UTC
  requestCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  totalTokens: number
  totalCostUsd: number
  /**
   * False when ANY request that day lacked a pricing-table entry — the
   * day's cost is a partial estimate (same honesty flag as the summary's
   * `totalCostUsdKnown`). Previously only the summary carried this, so
   * day rows silently showed fabricated-certain numbers.
   */
  totalCostUsdKnown: boolean
}

function dateOf(iso: string): string {
  return iso.slice(0, 10)
}

function inRange(record: MetricRecord, range: ResolvedUsageRange): boolean {
  const t = Date.parse(record.timestamp)
  if (Number.isNaN(t)) return false
  return t >= range.startMs && t < range.endMs
}

export function aggregateUsageSummary(
  records: MetricRecord[],
  range: ResolvedUsageRange,
  preset: UsageRangePreset,
): UsageSummary {
  let totalRequests = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheReadTokens = 0
  let totalCacheCreationTokens = 0
  let totalRealFreshInput = 0
  let totalCostUsd = 0
  let successCount = 0
  let unpricedRequestCount = 0
  const pricingLookup = (provider: string, model: string): boolean =>
    hasExactPricingEntry(provider, model)
  const latencies: number[] = []

  // Per-provider breakdown (mirrors token-monitor per-provider aggregation)
  const byProviderMap = new Map<
    string,
    {
      requests: number
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      costUsd: number
      successes: number
      cacheReadDenom: number
    }
  >()

  for (const r of records) {
    if (!inRange(r, range)) continue
    totalRequests++
    totalInputTokens += r.tokenInput
    totalOutputTokens += r.tokenOutput
    totalCacheReadTokens += r.cacheReadTokens ?? 0
    totalCacheCreationTokens += r.cacheCreationTokens ?? 0

    // fresh input for cache-hit-rate math
    totalRealFreshInput += getFreshInputTokens({
      provider: r.provider,
      promptTokens: r.tokenInput,
      cacheReadTokens: r.cacheReadTokens ?? 0,
      cacheCreationTokens: r.cacheCreationTokens ?? 0,
    })

    // approximate cost - file-backed metrics have the same shape as pg
    totalCostUsd += MetricsStore.estimateCostUSD(r)

    if (!r.error) successCount++
    if (isUnpriced(r, pricingLookup)) unpricedRequestCount++
    // Successful tasks only - failed tasks often have executionTime: 0
    // which would skew the distribution toward zero.
    if (!r.error && r.executionTime > 0) latencies.push(r.executionTime)

    // Per-provider breakdown
    const key = r.provider
    const existing = byProviderMap.get(key) ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
      successes: 0,
      cacheReadDenom: 0,
    }
    existing.requests++
    existing.inputTokens += r.tokenInput
    existing.outputTokens += r.tokenOutput
    existing.cacheReadTokens += r.cacheReadTokens ?? 0
    existing.costUsd += MetricsStore.estimateCostUSD(r)
    if (!r.error) existing.successes++
    existing.cacheReadDenom += r.tokenInput + (r.cacheCreationTokens ?? 0)
    byProviderMap.set(key, existing)
  }

  const latency = computeLatencyStats(latencies)

  // Cache hit rate: cacheRead / (promptTokens + cacheCreation).
  const denom = totalInputTokens + totalCacheCreationTokens
  const cacheHitRate = denom > 0 ? totalCacheReadTokens / denom : 0

  // Build byProvider array
  const byProvider = [...byProviderMap.entries()].map(([provider, s]) => ({
    provider,
    totalRequests: s.requests,
    totalInputTokens: s.inputTokens,
    totalOutputTokens: s.outputTokens,
    totalCacheReadTokens: s.cacheReadTokens,
    totalCostUsd: s.costUsd,
    successRate: s.requests > 0 ? s.successes / s.requests : 0,
    cacheHitRate: s.cacheReadDenom > 0 ? s.cacheReadTokens / s.cacheReadDenom : 0,
  }))

  return {
    range: preset,
    totalRequests,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    realTotalTokens: totalRealFreshInput + totalOutputTokens + totalCacheCreationTokens,
    totalCostUsd,
    /**
     * Real-cost semantics (openclaw usage-tracking borrowing): the summed
     * cost is only trustworthy when every contributing request had a
     * pricing entry. When false, dashboards must render cost as "unknown"
     * rather than silently showing the partial sum.
     */
    totalCostUsdKnown: unpricedRequestCount === 0,
    successRate: totalRequests > 0 ? successCount / totalRequests : 0,
    cacheHitRate,
    unpricedRequestCount,
    latency,
    byProvider,
  }
}

/**
 * Compute p50/p95/p99 + mean from a list of latency samples.
 * Uses nearest-rank method (NIST recommended): the percentile for rank k
 * of N sorted samples is samples[ceil(k/100 * N) - 1].
 * Returns zeros if the input is empty.
 */
export function computeLatencyStats(samples: number[]): LatencyStats {
  if (samples.length === 0) {
    return { p50Ms: 0, p95Ms: 0, p99Ms: 0, avgMs: 0, sampleCount: 0 }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const N = sorted.length
  const pct = (p: number): number => {
    const rank = Math.ceil((p / 100) * N)
    return sorted[Math.min(Math.max(rank - 1, 0), N - 1)]
  }
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    p50Ms: pct(50),
    p95Ms: pct(95),
    p99Ms: pct(99),
    avgMs: sum / N,
    sampleCount: N,
  }
}

export function aggregateDailyUsage(
  records: MetricRecord[],
  range: ResolvedUsageRange,
  pricingLookup: (provider: string, model: string) => boolean = () => true,
): DailyUsageEntry[] {
  const byDay = new Map<string, DailyUsageEntry>()
  const entryFor = (day: string): DailyUsageEntry => ({
    date: day,
    requestCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    totalCostUsdKnown: true,
  })
  for (const day of range.days) {
    byDay.set(day, entryFor(day))
  }
  for (const r of records) {
    if (!inRange(r, range)) continue
    const day = dateOf(r.timestamp)
    let entry = byDay.get(day)
    if (!entry) {
      // Range was "all" or we got a record outside the predicted days list ?
      // still keep it so the dashboard doesn't miss outliers.
      entry = entryFor(day)
      byDay.set(day, entry)
    }
    entry.requestCount++
    entry.totalInputTokens += r.tokenInput
    entry.totalOutputTokens += r.tokenOutput
    entry.totalCacheReadTokens += r.cacheReadTokens ?? 0
    entry.totalCacheCreationTokens += r.cacheCreationTokens ?? 0
    entry.totalTokens += r.tokenInput + r.tokenOutput
    entry.totalCostUsd += MetricsStore.estimateCostUSD(r)
    if (isUnpriced(r, pricingLookup)) entry.totalCostUsdKnown = false
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * True when the price table has no entry for (provider, model) and no
 * provider-wide "*" wildcard either ? i.e. the cost was computed from the
 * global fallback. In that case the dashboard should flag the row so
 * operators know to add a real entry.
 */
function hasExactPricingEntry(provider: string, model: string): boolean {
  const exact = DEFAULT_PRICING.find((p) => p.provider === provider && p.model === model)
  if (exact) return true
  const providerWildcard = DEFAULT_PRICING.find((p) => p.provider === provider && p.model === "*")
  return Boolean(providerWildcard)
}

function isUnpriced(
  record: MetricRecord,
  pricingLookup: (provider: string, model: string) => boolean,
): boolean {
  const cacheRead = record.cacheReadTokens ?? 0
  const cacheCreation = record.cacheCreationTokens ?? 0
  const hasTokens =
    record.tokenInput > 0 || record.tokenOutput > 0 || cacheRead > 0 || cacheCreation > 0
  if (!hasTokens) return false
  if (record.error) return false
  return !pricingLookup(record.provider, record.model)
}

interface UsageRouteDeps {
  evolution?: EvolutionFacade
}

function parsePreset(raw: string | undefined): UsageRangePreset {
  switch (raw) {
    case "today":
    case "1d":
    case "7d":
    case "14d":
    case "30d":
    case "all":
      return raw
    default:
      return "7d"
  }
}

// ?? Subscription-style rolling windows (cc-switch tray borrowing) ?????????

export type UsageWindowKey = "5h" | "24h" | "7d" | "30d"

export interface UsageWindowBucket {
  window: UsageWindowKey
  /** Window length in ms. */
  spanMs: number
  /** Start of the window (nowMs - spanMs). */
  startMs: number
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /**
   * Strict real-cost semantics: `null` when ANY request in the window
   * lacks a pricing entry — an unpriced request makes the whole window's
   * total unknown, never "silently partial".
   */
  costUsd: number | null
  unpricedRequests: number
}

const USAGE_WINDOWS: Array<{ key: UsageWindowKey; spanMs: number }> = [
  { key: "5h", spanMs: 5 * 60 * 60 * 1000 },
  { key: "24h", spanMs: 24 * 60 * 60 * 1000 },
  { key: "7d", spanMs: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", spanMs: 30 * 24 * 60 * 60 * 1000 },
]

export function computeUsageWindows(
  records: MetricRecord[],
  nowMs: number = Date.now(),
): UsageWindowBucket[] {
  return USAGE_WINDOWS.map(({ key, spanMs }) => {
    const startMs = nowMs - spanMs
    let requests = 0
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let costUsd = 0
    let unpricedRequests = 0
    for (const r of records) {
      const ts = Date.parse(r.timestamp)
      if (!Number.isFinite(ts) || ts < startMs || ts > nowMs) continue
      requests += 1
      inputTokens += r.tokenInput
      outputTokens += r.tokenOutput
      cacheReadTokens += r.cacheReadTokens ?? 0
      if (isUnpriced(r, pricingLookupForWindow)) {
        unpricedRequests += 1
      } else {
        costUsd += MetricsStore.estimateCostUSD(r)
      }
    }
    return {
      window: key,
      spanMs,
      startMs,
      requests,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      costUsd: unpricedRequests > 0 ? null : costUsd,
      unpricedRequests,
    }
  })
}

const pricingLookupForWindow = (provider: string, model: string): boolean =>
  hasExactPricingEntry(provider, model)

// ?? OpenAPI route definitions ?????????????????????????????????????????????

export const usageSummaryRoute = createRoute({
  method: "get",
  path: "/obs/usage/summary",
  tags: ["usage"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.unknown(),
        },
      },
      description: "Usage summary; `groupBy=session|agentRole` adds a matching breakdown array",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid groupBy value",
    },
    503: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Evolution disabled",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export const usageDailyRoute = createRoute({
  method: "get",
  path: "/obs/usage/daily",
  tags: ["usage"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.unknown(),
        },
      },
      description: "Daily usage; `groupBy=session|agentRole` adds a range-wide breakdown array",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid groupBy value",
    },
    503: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Evolution disabled",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export const usageWindowsRoute = createRoute({
  method: "get",
  path: "/obs/usage/windows",
  tags: ["usage"],
  responses: {
    200: {
      content: { "application/json": { schema: z.unknown() } },
      description: "Rolling usage windows (5h/24h/7d/30d)",
    },
    503: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Evolution disabled",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export const usageLatencyRoute = createRoute({
  method: "get",
  path: "/obs/usage/latency",
  tags: ["usage"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Latency stats" },
    503: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Evolution disabled",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export function usageRoutes(deps: UsageRouteDeps) {
  const { evolution } = deps

  function parsePagination(c: Context): PaginationQuery {
    const raw = c.req.query()
    const parsed = PaginationQuerySchema.safeParse({
      cursor: raw.cursor,
      limit: raw.limit,
    })
    if (!parsed.success) return { cursor: undefined, limit: 20 }
    return parsed.data
  }

  /**
   * Resolve `groupBy` once per request; an invalid value is a client error,
   * not a silent fallback (a typo would otherwise hide the whole drill-down).
   */
  function groupByFrom(c: Context): ParsedUsageGroupBy {
    return parseUsageGroupBy(c.req.query("groupBy"))
  }

  function invalidGroupBy(c: Context, raw: string) {
    return c.json(
      {
        error: "invalid_group_by",
        code: "invalid_group_by",
        details: { groupBy: raw, allowed: USAGE_GROUP_BY_VALUES },
      },
      400,
    )
  }

  return {
    summary: async (c: Context) => {
      if (!evolution) {
        return c.json({ error: "evolution_disabled" }, 503)
      }
      const grouped = groupByFrom(c)
      if (!grouped.ok) return invalidGroupBy(c, c.req.query("groupBy") ?? "")
      const preset = parsePreset(c.req.query("range"))
      const range = resolveUsageRange(preset)
      try {
        const tenantId = c.get("tenantId" as never) as string | undefined
        const records = await evolution.metrics.listAll({ tenantId })
        const summary = aggregateUsageSummary(records, range, preset)
        if (grouped.groupBy) {
          const rows = aggregateUsageBreakdown(records, range, grouped.groupBy)
          if (grouped.groupBy === "session") summary.bySession = rows
          else summary.byAgentRole = rows
        }
        return c.json(summary)
      } catch (err) {
        log.error({ err }, "usage summary failed")
        return c.json({ error: "internal_error" }, 500)
      }
    },

    latency: async (c: Context) => {
      if (!evolution) {
        return c.json({ error: "evolution_disabled" }, 503)
      }
      const preset = parsePreset(c.req.query("range"))
      const range = resolveUsageRange(preset)
      try {
        const tenantId = c.get("tenantId" as never) as string | undefined
        const records = await evolution.metrics.listAll({ tenantId })
        const samples = records
          .filter((r) => inRange(r, range))
          .filter((r) => !r.error && r.executionTime > 0)
          .map((r) => r.executionTime)
        return c.json({
          range: preset,
          ...computeLatencyStats(samples),
        })
      } catch (err) {
        log.error({ err }, "usage latency failed")
        return c.json({ error: "internal_error" }, 500)
      }
    },

    daily: async (c: Context) => {
      if (!evolution) {
        return c.json({ error: "evolution_disabled" }, 503)
      }
      const grouped = groupByFrom(c)
      if (!grouped.ok) return invalidGroupBy(c, c.req.query("groupBy") ?? "")
      const preset = parsePreset(c.req.query("range"))
      const range = resolveUsageRange(preset)
      try {
        const tenantId = c.get("tenantId" as never) as string | undefined
        const records = await evolution.metrics.listAll({ tenantId })
        const daily = aggregateDailyUsage(records, range, hasExactPricingEntry)
        const page = paginate(daily, parsePagination(c), (d) => d.date)
        const body: {
          range: UsageRangePreset
          daily: DailyUsageEntry[]
          nextCursor: string | undefined
          total: number
          bySession?: UsageBreakdownEntry[]
          byAgentRole?: UsageBreakdownEntry[]
        } = {
          range: preset,
          daily: page.items,
          nextCursor: page.nextCursor,
          total: page.total,
        }
        if (grouped.groupBy) {
          const rows = aggregateUsageBreakdown(records, range, grouped.groupBy)
          if (grouped.groupBy === "session") body.bySession = rows
          else body.byAgentRole = rows
        }
        return c.json(body)
      } catch (err) {
        log.error({ err }, "usage daily failed")
        return c.json({ error: "internal_error" }, 500)
      }
    },

    windows: async (c: Context) => {
      if (!evolution) {
        return c.json({ error: "evolution_disabled" }, 503)
      }
      try {
        const tenantId = c.get("tenantId" as never) as string | undefined
        const records = await evolution.metrics.listAll({ tenantId })
        return c.json({ windows: computeUsageWindows(records) })
      } catch (err) {
        log.error({ err }, "usage windows failed")
        return c.json({ error: "internal_error" }, 500)
      }
    },
  }
}
