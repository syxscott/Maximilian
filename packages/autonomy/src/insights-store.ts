/**
 * 5.3 — FailurePatternAnalyzer + InsightsStore
 *
 * Mines recent executions to surface recurring failure patterns.
 * Persists to <rootDir>/insights/.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  FailureInsightSchema,
  LeaderboardInsightSchema,
  type FailureInsight,
  type LeaderboardInsight,
  type ExecutionRecord,
} from "./types.js";
import type { ExecutionStore } from "./execution-store.js";

export class InsightsStore {
  constructor(private rootDir: string) {}

  private dir(): string {
    return path.join(this.rootDir, "insights");
  }

  private patternsFile(): string {
    return path.join(this.dir(), "failure-patterns.json");
  }

  private leaderboardFile(): string {
    return path.join(this.dir(), "leaderboard-insights.json");
  }

  async savePatterns(insights: FailureInsight[]): Promise<void> {
    await fs.mkdir(this.dir(), { recursive: true });
    const validated = insights.map((i) => FailureInsightSchema.parse(i));
    await fs.writeFile(this.patternsFile(), JSON.stringify(validated, null, 2), "utf-8");
  }

  async loadPatterns(): Promise<FailureInsight[]> {
    try {
      const raw = await fs.readFile(this.patternsFile(), "utf-8");
      const arr = JSON.parse(raw) as unknown[];
      return arr.map((x) => FailureInsightSchema.parse(x));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async saveLeaderboard(insight: LeaderboardInsight): Promise<void> {
    await fs.mkdir(this.dir(), { recursive: true });
    const validated = LeaderboardInsightSchema.parse(insight);
    await fs.writeFile(this.leaderboardFile(), JSON.stringify(validated, null, 2), "utf-8");
  }

  async loadLeaderboard(): Promise<LeaderboardInsight | undefined> {
    try {
      const raw = await fs.readFile(this.leaderboardFile(), "utf-8");
      return LeaderboardInsightSchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }
}

export class FailurePatternAnalyzer {
  constructor(private store: InsightsStore) {}

  /**
   * Look at the most recent `lookback` executions and surface the
   * most frequent failure patterns.
   */
  async analyze(executions: ExecutionStore | ExecutionRecord[], lookback = 50): Promise<FailureInsight[]> {
    const all = Array.isArray(executions) ? executions : await executions.listAll();
    const recent = all.slice(-lookback);

    const byPattern = new Map<string, ExecutionRecord[]>();
    for (const e of recent) {
      const patterns = e.review?.failurePatterns ?? [];
      for (const p of patterns) {
        if (!p) continue;
        const arr = byPattern.get(p) ?? [];
        arr.push(e);
        byPattern.set(p, arr);
      }
    }

    const out: FailureInsight[] = [];
    for (const [pattern, group] of byPattern.entries()) {
      const scores = group
        .map((g) => g.review?.score ?? 0)
        .filter((s) => s > 0);
      const avgScore = scores.length > 0
        ? scores.reduce((a, s) => a + s, 0) / scores.length
        : 0;
      const firstSeen = group
        .map((g) => g.startedAt)
        .sort()[0]!;
      const lastSeen = group
        .map((g) => g.startedAt)
        .sort()
        .reverse()[0]!;

      out.push(
        FailureInsightSchema.parse({
          pattern,
          frequency: group.length,
          agentRoles: Array.from(new Set(group.map((g) => g.agentRole))),
          providers: Array.from(
            new Set(
              group
                .map((g) => g.modelAssignment?.provider)
                .filter((p): p is string => !!p)
            )
          ),
          models: Array.from(
            new Set(
              group
                .map((g) => g.modelAssignment?.model)
                .filter((m): m is string => !!m)
            )
          ),
          avgScore,
          examples: group.slice(0, 3).map((g) => g.id),
          firstSeen,
          lastSeen,
        })
      );
    }

    out.sort((a, b) => b.frequency - a.frequency);
    await this.store.savePatterns(out);
    return out;
  }

  /**
   * Mine a leaderboard-style insight: worst roles and worst models.
   */
  async leaderboardInsight(executions: ExecutionStore | ExecutionRecord[]): Promise<LeaderboardInsight> {
    const all = Array.isArray(executions) ? executions : await executions.listAll();
    const totalExecutions = all.length;

    const byRole = groupBy(all, (e) => e.agentRole);
    const byModel = groupBy(
      all.filter((e) => e.modelAssignment),
      (e) => `${e.modelAssignment!.provider}|${e.modelAssignment!.model}`
    );

    const worstRoles = Array.from(byRole.entries())
      .map(([role, group]) => ({
        role,
        avgScore: avg(group.map((g) => g.review?.score).filter((s): s is number => s !== undefined)),
        sampleSize: group.length,
      }))
      .filter((r) => r.sampleSize > 0)
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, 5);

    const worstModels = Array.from(byModel.entries())
      .map(([key, group]) => {
        const [provider, model] = key.split("|") as [string, string];
        return {
          provider,
          model,
          avgScore: avg(group.map((g) => g.review?.score).filter((s): s is number => s !== undefined)),
          sampleSize: group.length,
        };
      })
      .filter((r) => r.sampleSize > 0)
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, 5);

    const out: LeaderboardInsight = LeaderboardInsightSchema.parse({
      generatedAt: new Date().toISOString(),
      totalExecutions,
      worstRoles,
      worstModels,
    });
    await this.store.saveLeaderboard(out);
    return out;
  }
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    const cur = m.get(k) ?? [];
    cur.push(x);
    m.set(k, cur);
  }
  return m;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
