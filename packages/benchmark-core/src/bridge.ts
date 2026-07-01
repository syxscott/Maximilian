/**
 * Phase 9 — Bridge to SimulationEngine.
 *
 * Maps benchmark results to the RoleProfile interface used by
 * SimulationEngine. This allows real benchmark quality/cost/latency
 * data to feed into the simulation pipeline, solving the Promotion
 * auto-approve issue (Phase 8) by providing actual quality deltas.
 *
 * RoleProfile is declared locally to avoid a circular dependency
 * with @max/meta-system.
 */

import type { BenchmarkResult } from "./types.js";

/**
 * Matches the RoleProfile interface from @max/meta-system/src/simulation.ts.
 * Declared locally to avoid circular dependency.
 */
export interface RoleProfile {
  costPerCall: number;
  latencyMs: number;
  qualityScore: number; // 0–10 scale
}

/** Cost per token in arbitrary units (tunable). */
const COST_PER_TOKEN = 0.00001;

/**
 * Convert a single BenchmarkResult to a RoleProfile.
 *
 * Mapping:
 *   - costPerCall = tokenUsage.total * COST_PER_TOKEN
 *   - latencyMs   = result.latencyMs
 *   - qualityScore = result.quality * 10  (benchmark 0–1 → simulation 0–10)
 */
export function toRoleProfile(result: BenchmarkResult): RoleProfile {
  return {
    costPerCall: round4(result.tokenUsage.total * COST_PER_TOKEN),
    latencyMs: result.latencyMs,
    qualityScore: round2(result.quality * 10),
  };
}

/**
 * Aggregate multiple benchmark results into a single RoleProfile.
 * Averages cost, latency, and quality across all results.
 */
export function aggregateToRoleProfile(results: BenchmarkResult[]): RoleProfile {
  if (results.length === 0) {
    return { costPerCall: 0, latencyMs: 0, qualityScore: 0 };
  }

  const totalCost = results.reduce((s, r) => s + r.tokenUsage.total * COST_PER_TOKEN, 0);
  const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0);
  const totalQuality = results.reduce((s, r) => s + r.quality * 10, 0);

  return {
    costPerCall: round4(totalCost / results.length),
    latencyMs: round2(totalLatency / results.length),
    qualityScore: round2(totalQuality / results.length),
  };
}

/**
 * Compare two sets of benchmark results (e.g. baseline vs maximilian)
 * and produce a delta suitable for SimulationEngine.simulateDelta().
 *
 * Returns a SimulationDelta-compatible object (declared locally).
 */
export function computeBenchmarkDelta(
  baseline: BenchmarkResult[],
  maximilian: BenchmarkResult[]
): {
  costDelta: number;
  latencyDeltaMs: number;
  qualityDelta: number;
  riskDelta: number;
} {
  const baseProfile = aggregateToRoleProfile(baseline);
  const maxProfile = aggregateToRoleProfile(maximilian);

  return {
    costDelta: round4(maxProfile.costPerCall - baseProfile.costPerCall),
    latencyDeltaMs: round2(maxProfile.latencyMs - baseProfile.latencyMs),
    qualityDelta: round2(maxProfile.qualityScore - baseProfile.qualityScore),
    riskDelta: 0, // Risk is computed by SimulationEngine, not here.
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
