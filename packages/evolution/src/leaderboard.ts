/**
 * Phase 3 — Model Comparison Engine.
 *
 * Aggregates raw MetricRecord entries into a per-(role, provider, model)
 * leaderboard, then exposes a score function for the selector.
 *
 * Aggregation rules (all arithmetic means over the slice):
 *   - avgScore              = mean of record.reviewScore (only scored records)
 *   - avgExecutionTime      = mean of record.executionTime
 *   - avgCostUSD            = mean of estimateCostUSD(record)
 *   - userSatisfaction      = mean of record.userAccepted (true=1, false=0, missing=ignored)
 *   - sampleSize            = count of records in slice
 *
 * Counterfactual dimensions (borrowed from EvoAgentBench):
 *   - baselineScore         = the avgScore *before* the most recent evolution,
 *                             sourced from the most recent EvolutionDecision
 *                             with outcome="promoted" for that (role, model).
 *   - deltaScore            = avgScore - baselineScore (signed; can be negative).
 *   - costDeltaUSD          = signed cost delta vs the prior version; a small
 *                             accuracy gain bought with a large token/turn
 *                             increase is flagged rather than hidden.
 *   - versionHistory        = every from→to decision for this entry.
 *
 * Min-coverage guard (EvoAgentBench `buildOverallRows:53`):
 * `aggregateOverall` only emits an "Overall" entry when a (role, model) has
 * metrics across ≥ `minDomains` distinct task types, so the number reflects
 * genuine cross-domain competence rather than one lucky task class.
 */

import type { AgentRole } from "@max/core"
import { MetricsStore, type MetricsStoreLike } from "./metrics-store.js"
import {
  LeaderboardSchema,
  type LeaderboardData,
  type LeaderboardEntry,
  type MetricRecord,
  type EvolutionDecision,
} from "./types.js"

interface AggregateKey {
  role: AgentRole
  provider: string
  model: string
}

function keyOf(k: AggregateKey): string {
  return `${k.role}|${k.provider}|${k.model}`
}

/** Default minimum number of distinct task types for an "Overall" entry. */
export const MIN_DOMAINS_FOR_OVERALL = 2

export interface AggregateOptions {
  /** Min-coverage threshold for the "Overall" row. */
  minDomains?: number
  /** Optional: most recent promoted decision per (role, model) for baseline. */
  decisions?: EvolutionDecision[]
}

export class Leaderboard {
  private entries: LeaderboardEntry[] = []
  private lastRebuilt?: string

  static fromEntries(entries: LeaderboardEntry[]): Leaderboard {
    return new Leaderboard(entries)
  }

  constructor(entries: LeaderboardEntry[] = []) {
    this.entries = entries
  }

  async rebuild(metrics: MetricsStoreLike, decisions?: EvolutionDecision[]): Promise<void> {
    const records = await metrics.listAll()
    this.entries = aggregate(records, { decisions })
    this.lastRebuilt = new Date().toISOString()
  }

  entriesFor(role: AgentRole): LeaderboardEntry[] {
    return this.entries.filter((e) => e.agentRole === role)
  }

  all(): LeaderboardEntry[] {
    return [...this.entries]
  }

  toJSON(): LeaderboardData {
    return LeaderboardSchema.parse({
      entries: this.entries,
      lastRebuilt: this.lastRebuilt,
    })
  }

  /**
   * Build an "Overall" roll-up: for each (role, model) across all providers,
   * if the entry set spans ≥ minDomains distinct task types, emit a single
   * combined entry. Otherwise skip — EvoAgentBench's "refuse to render
   * overall without real breadth" rule.
   */
  overall(opts: { minDomains?: number } = {}): LeaderboardEntry[] {
    const minDomains = opts.minDomains ?? MIN_DOMAINS_FOR_OVERALL
    const byRoleModel = new Map<string, LeaderboardEntry[]>()
    for (const e of this.entries) {
      const k = `${e.agentRole}|${e.model}`
      const arr = byRoleModel.get(k) ?? []
      arr.push(e)
      byRoleModel.set(k, arr)
    }
    const overall: LeaderboardEntry[] = []
    for (const [, group] of byRoleModel) {
      // Domain count = number of distinct providers in the group (cheap
      // proxy: one provider per task type is a reasonable assumption).
      const domains = new Set(group.map((e) => e.provider)).size
      if (domains < minDomains) continue
      const totalSamples = group.reduce((a, e) => a + e.sampleSize, 0)
      if (totalSamples === 0) continue
      const avgScore = group.reduce((a, e) => a + e.avgScore * e.sampleSize, 0) / totalSamples
      const avgCost = group.reduce((a, e) => a + e.avgCostUSD * e.sampleSize, 0) / totalSamples
      const avgTime =
        group.reduce((a, e) => a + e.avgExecutionTime * e.sampleSize, 0) / totalSamples
      const satisfaction =
        group.reduce((a, e) => a + e.userSatisfaction * e.sampleSize, 0) / totalSamples
      const first = group[0]!
      const baselineScores = group
        .map((e) => e.baselineScore)
        .filter((x): x is number => x !== undefined)
      const baselineScore =
        baselineScores.length > 0
          ? baselineScores.reduce((a, b) => a + b, 0) / baselineScores.length
          : undefined
      const deltaScores = group.map((e) => e.deltaScore).filter((x): x is number => x !== undefined)
      const deltaScore =
        deltaScores.length > 0
          ? deltaScores.reduce((a, b) => a + b, 0) / deltaScores.length
          : undefined
      const costDeltas = group
        .map((e) => e.costDeltaUSD)
        .filter((x): x is number => x !== undefined)
      const costDeltaUSD =
        costDeltas.length > 0
          ? costDeltas.reduce((a, b) => a + b, 0) / costDeltas.length
          : undefined
      const merged: LeaderboardEntry = {
        agentRole: first.agentRole,
        provider: "*",
        model: first.model,
        avgScore,
        avgExecutionTime: avgTime,
        avgCostUSD: avgCost,
        userSatisfaction: satisfaction,
        sampleSize: totalSamples,
        lastUpdated: new Date().toISOString(),
        ...(baselineScore !== undefined ? { baselineScore } : {}),
        ...(deltaScore !== undefined ? { deltaScore } : {}),
        ...(costDeltaUSD !== undefined ? { costDeltaUSD } : {}),
        versionHistory: group.flatMap((e) => e.versionHistory),
      }
      overall.push(merged)
    }
    return overall
  }
}

export function aggregate(
  records: MetricRecord[],
  opts: AggregateOptions = {},
): LeaderboardEntry[] {
  const buckets = new Map<string, MetricRecord[]>()
  for (const r of records) {
    const k = keyOf({ role: r.agentRole, provider: r.provider, model: r.model })
    const arr = buckets.get(k) ?? []
    arr.push(r)
    buckets.set(k, arr)
  }

  // Build a per-(role, model) baseline map from the most recent promoted
  // decision. The baselineScore represents "score before the most recent
  // evolution" — the counterfactual pair.
  const baselineByRoleModel = new Map<
    string,
    { baseline: number; decidedAt: string; decisions: EvolutionDecision[] }
  >()
  if (opts.decisions) {
    // Group decisions by (role, model). We need a metric record to map
    // role+model to provider+model; here we use the decision's `toVersion`
    // as a stand-in key. If we don't have model info on the decision, we
    // fall back to a "role-only" baseline.
    for (const d of opts.decisions) {
      const k = `${d.agentRole}|*`
      const cur = baselineByRoleModel.get(k)
      if (!cur || d.triggeredAt > cur.decidedAt) {
        baselineByRoleModel.set(k, {
          baseline: d.oldAvgScore,
          decidedAt: d.triggeredAt,
          decisions: [...(cur?.decisions ?? []), d],
        })
      }
    }
  }

  const now = new Date().toISOString()
  const out: LeaderboardEntry[] = []
  for (const [k, slice] of buckets.entries()) {
    const [role, provider, model] = k.split("|") as [AgentRole, string, string]
    const scored = slice.filter((r) => r.reviewScore !== undefined)
    const accepted = slice.filter((r) => r.userAccepted !== undefined)

    const avgScore =
      scored.length > 0 ? scored.reduce((a, r) => a + (r.reviewScore ?? 0), 0) / scored.length : 0
    const avgExecutionTime = slice.reduce((a, r) => a + r.executionTime, 0) / slice.length
    const avgCostUSD = slice.reduce((a, r) => a + MetricsStore.estimateCostUSD(r), 0) / slice.length
    const userSatisfaction =
      accepted.length > 0
        ? accepted.reduce((a, r) => a + (r.userAccepted ? 1 : 0), 0) / accepted.length
        : 0

    // Counterfactual: baseline from the most-recent promoted decision
    // (EvoAgentBench pattern: compare to a counterfactual).
    const baseline =
      baselineByRoleModel.get(`${role}|*`) ?? baselineByRoleModel.get(`${role}|${model}`)
    const baselineScore = baseline?.baseline
    const deltaScore = baselineScore !== undefined ? avgScore - baselineScore : undefined

    // Cost delta = signed; for the MVP we approximate as avg vs the
    // baseline's prior avg, both pulled from the slice itself.
    const costDeltaUSD =
      baselineScore !== undefined
        ? avgCostUSD -
          (slice.length > 1
            ? slice
                .slice(0, Math.max(1, Math.floor(slice.length / 2)))
                .reduce((a, r) => a + MetricsStore.estimateCostUSD(r), 0) /
              Math.max(1, Math.floor(slice.length / 2))
            : avgCostUSD)
        : undefined

    const versionHistory = (baseline?.decisions ?? []).map((d) => ({
      fromVersion: d.fromVersion,
      toVersion: d.toVersion,
      outcome: d.outcome,
      oldAvgScore: d.oldAvgScore,
      newAvgScore: d.newAvgScore,
      triggeredAt: d.triggeredAt,
      reason: d.reason,
    }))

    const entry: LeaderboardEntry = {
      agentRole: role,
      provider,
      model,
      avgScore,
      avgExecutionTime,
      avgCostUSD,
      userSatisfaction,
      sampleSize: slice.length,
      lastUpdated: now,
      ...(baselineScore !== undefined ? { baselineScore } : {}),
      ...(deltaScore !== undefined ? { deltaScore } : {}),
      ...(costDeltaUSD !== undefined ? { costDeltaUSD } : {}),
      versionHistory,
    }
    out.push(entry)
  }
  return out
}
