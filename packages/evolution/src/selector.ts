/**
 * Phase 4 — Auto Model Selection.
 *
 *   score = qualityScore * (1 - latencyPenalty) * (1 - costPenalty)
 *
 *     qualityScore   = avgScore / 10
 *     latencyPenalty = min(avgExecutionTime / MAX_LATENCY_MS, 1) * 0.30
 *     costPenalty    = min(avgCostUSD      / MAX_COST_USD,    1) * 0.20
 *
 * If no history exists, fall back to a registry-provided default.
 * If history exists but is below MIN_SAMPLES, treat the entry as
 * "promising but uncertain" with a 10% penalty.
 */

import type { AgentRole } from "@max/core";
import type { Provider } from "@max/providers";
import type { LeaderboardEntry, ModelSelection } from "./types.js";
import type { Leaderboard } from "./leaderboard.js";

export interface SelectorConfig {
  maxLatencyMs: number;          // default 30_000
  maxCostUSD: number;            // default 0.50
  minSamples: number;            // default 5
  latencyWeight: number;         // default 0.30
  costWeight: number;            // default 0.20
}

export const DEFAULT_SELECTOR_CONFIG: SelectorConfig = {
  maxLatencyMs: 30_000,
  maxCostUSD: 0.5,
  minSamples: 5,
  latencyWeight: 0.3,
  costWeight: 0.2,
};

export interface CandidateProvider {
  provider: Provider;
}

export class ModelSelector {
  constructor(
    private config: SelectorConfig = DEFAULT_SELECTOR_CONFIG,
    private candidates: CandidateProvider[] = []
  ) {}

  setCandidates(candidates: CandidateProvider[]): void {
    this.candidates = candidates;
  }

  scoreEntry(entry: LeaderboardEntry): number {
    const quality = entry.avgScore / 10;
    const latencyP =
      Math.min(entry.avgExecutionTime / this.config.maxLatencyMs, 1) * this.config.latencyWeight;
    const costP =
      Math.min(entry.avgCostUSD / this.config.maxCostUSD, 1) * this.config.costWeight;
    const samplePenalty = entry.sampleSize < this.config.minSamples ? 0.1 : 0;
    return quality * (1 - latencyP) * (1 - costP) - samplePenalty;
  }

  select(
    role: AgentRole,
    board: Leaderboard,
    fallback?: { provider: Provider }
  ): ModelSelection {
    const entries = board.entriesFor(role);
    if (entries.length === 0) {
      if (!fallback) throw new Error(`No leaderboard data and no fallback for role ${role}`);
      return {
        provider: fallback.provider.id,
        model: fallback.provider.defaultModel,
        score: 0,
        reason: "No history yet — using default provider.",
      };
    }

    const scored = entries.map((e) => ({ entry: e, score: this.scoreEntry(e) }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    return {
      provider: best.entry.provider,
      model: best.entry.model,
      score: best.score,
      reason: buildReason(role, best.entry, this.config),
    };
  }
}

function buildReason(
  role: AgentRole,
  entry: LeaderboardEntry,
  cfg: SelectorConfig
): string {
  const parts: string[] = [];
  parts.push(`Highest composite score for ${role} tasks`);
  parts.push(`(score ${entry.avgScore.toFixed(1)}/10 over ${entry.sampleSize} tasks)`);
  if (entry.sampleSize < cfg.minSamples) {
    parts.push("low sample size — uncertainty penalty applied");
  }
  return parts.join("; ") + ".";
}
