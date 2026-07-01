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
 */

import type { AgentRole } from "@max/core";
import { MetricsStore } from "./metrics-store.js";
import {
  LeaderboardSchema,
  type LeaderboardData,
  type LeaderboardEntry,
  type MetricRecord,
} from "./types.js";

interface AggregateKey {
  role: AgentRole;
  provider: string;
  model: string;
}

function keyOf(k: AggregateKey): string {
  return `${k.role}|${k.provider}|${k.model}`;
}

export class Leaderboard {
  private entries: LeaderboardEntry[] = [];
  private lastRebuilt?: string;

  static fromEntries(entries: LeaderboardEntry[]): Leaderboard {
    return new Leaderboard(entries);
  }

  constructor(entries: LeaderboardEntry[] = []) {
    this.entries = entries;
  }

  async rebuild(metrics: MetricsStore): Promise<void> {
    const records = await metrics.listAll();
    this.entries = aggregate(records);
    this.lastRebuilt = new Date().toISOString();
  }

  entriesFor(role: AgentRole): LeaderboardEntry[] {
    return this.entries.filter((e) => e.agentRole === role);
  }

  all(): LeaderboardEntry[] {
    return [...this.entries];
  }

  toJSON(): LeaderboardData {
    return LeaderboardSchema.parse({
      entries: this.entries,
      lastRebuilt: this.lastRebuilt,
    });
  }
}

export function aggregate(records: MetricRecord[]): LeaderboardEntry[] {
  const buckets = new Map<string, MetricRecord[]>();
  for (const r of records) {
    const k = keyOf({ role: r.agentRole, provider: r.provider, model: r.model });
    const arr = buckets.get(k) ?? [];
    arr.push(r);
    buckets.set(k, arr);
  }

  const now = new Date().toISOString();
  const out: LeaderboardEntry[] = [];
  for (const [k, slice] of buckets.entries()) {
    const [role, provider, model] = k.split("|") as [AgentRole, string, string];
    const scored = slice.filter((r) => r.reviewScore !== undefined);
    const accepted = slice.filter((r) => r.userAccepted !== undefined);

    const avgScore = scored.length > 0
      ? scored.reduce((a, r) => a + (r.reviewScore ?? 0), 0) / scored.length
      : 0;
    const avgExecutionTime = slice.reduce((a, r) => a + r.executionTime, 0) / slice.length;
    const avgCostUSD = slice.reduce((a, r) => a + MetricsStore.estimateCostUSD(r), 0) / slice.length;
    const userSatisfaction = accepted.length > 0
      ? accepted.reduce((a, r) => a + (r.userAccepted ? 1 : 0), 0) / accepted.length
      : 0;

    out.push({
      agentRole: role,
      provider,
      model,
      avgScore,
      avgExecutionTime,
      avgCostUSD,
      userSatisfaction,
      sampleSize: slice.length,
      lastUpdated: now,
    });
  }
  return out;
}
