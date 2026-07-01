/**
 * 6.8 — SimulationEngine
 *
 * Offline comparison of organization structure A vs B.
 * Predicts: totalEstimatedCost, totalEstimatedLatencyMs, estimatedAvgQuality, riskScore.
 *
 * Inputs (per org):
 *   - team graph (nodes, edges)
 *   - expected per-role cost (per call), latency (ms), quality (0-10)
 *
 * Output: SimulationResult for each org + optional comparison.
 */

import {
  SimulationResultSchema,
  SimulationDeltaSchema,
  type SimulationResult,
  type SimulationDelta,
} from "./types.js";
import type { TeamGraph } from "@max/dags";

export interface RoleProfile {
  costPerCall: number;
  latencyMs: number;
  qualityScore: number;
}

/**
 * Phase 9 — Optional bridge to real benchmark data.
 * When provided, SimulationEngine enriches role profiles with actual
 * quality/cost/latency measurements from benchmark runs, enabling
 * promotion proposals to produce non-zero quality deltas.
 */
export interface BenchmarkBridge {
  getQualityProfile(role: string): Promise<RoleProfile | null>;
}

export interface SimulationInput {
  orgName: string;
  graph: TeamGraph;
  profiles: Record<string, RoleProfile>;  // keyed by role
  /** Serial chain depth; affects latency multiplier. */
  serialDepth?: number;
}

export class SimulationEngine {
  constructor(private benchmarkBridge?: BenchmarkBridge) {}

  async simulate(input: SimulationInput): Promise<SimulationResult> {
    const serialDepth = input.serialDepth ?? input.graph.nodes.length;
    let totalCost = 0;
    let totalLatency = 0;
    let totalQuality = 0;
    let activeNodes = 0;
    const missing: string[] = [];

    for (const node of input.graph.nodes) {
      const profile = input.profiles[node.role];
      if (!profile) {
        missing.push(node.role);
        continue;
      }
      totalCost += profile.costPerCall;
      totalLatency += profile.latencyMs;
      totalQuality += profile.qualityScore;
      activeNodes += 1;
    }

    if (activeNodes === 0) {
      return SimulationResultSchema.parse({
        orgName: input.orgName,
        teamSize: 0,
        totalEstimatedCost: 0,
        totalEstimatedLatencyMs: 0,
        estimatedAvgQuality: 0,
        riskScore: 1,
        simulatedAt: new Date().toISOString(),
      });
    }

    // Serial multiplier: each serial layer adds 30% latency overhead.
    const serialMultiplier = 1 + Math.max(0, serialDepth - 1) * 0.3;
    const estimatedLatencyMs = totalLatency * serialMultiplier;
    const estimatedAvgQuality = totalQuality / activeNodes;

    // Risk: missing role profiles + team size penalty.
    const missingRatio = missing.length / Math.max(1, input.graph.nodes.length);
    const teamSizePenalty = activeNodes > 6 ? 0.1 : 0;
    const riskScore = Math.min(1, missingRatio + teamSizePenalty);

    return SimulationResultSchema.parse({
      orgName: input.orgName,
      teamSize: activeNodes,
      totalEstimatedCost: totalCost,
      totalEstimatedLatencyMs: estimatedLatencyMs,
      estimatedAvgQuality,
      riskScore,
      simulatedAt: new Date().toISOString(),
    });
  }

  async compare(a: SimulationInput, b: SimulationInput): Promise<{
    a: SimulationResult;
    b: SimulationResult;
    recommendation: "A" | "B" | "tie";
    reason: string;
  }> {
    const resA = await this.simulate(a);
    const resB = await this.simulate(b);

    // Score: higher quality wins; lower cost and latency break ties.
    const scoreA = resA.estimatedAvgQuality - resA.totalEstimatedCost * 0.01 - resA.totalEstimatedLatencyMs * 0.0001;
    const scoreB = resB.estimatedAvgQuality - resB.totalEstimatedCost * 0.01 - resB.totalEstimatedLatencyMs * 0.0001;

    let recommendation: "A" | "B" | "tie";
    let reason: string;
    if (Math.abs(scoreA - scoreB) < 0.05) {
      recommendation = "tie";
      reason = `Score A=${scoreA.toFixed(3)} ≈ Score B=${scoreB.toFixed(3)}`;
    } else if (scoreA > scoreB) {
      recommendation = "A";
      reason = `A scores ${scoreA.toFixed(3)} > B ${scoreB.toFixed(3)} (quality − cost − latency)`;
    } else {
      recommendation = "B";
      reason = `B scores ${scoreB.toFixed(3)} > A ${scoreA.toFixed(3)} (quality − cost − latency)`;
    }
    return { a: resA, b: resB, recommendation, reason };
  }

  /**
   * Phase 8.1 — Take over SimulationEngine.
   *
   * Compute the delta between two org states. Every birth / retirement /
   * promotion / merge / split decision must call this and surface the
   * resulting cost/latency/quality/risk delta before any mutation.
   */
  async simulateDelta(
    before: SimulationInput,
    after: SimulationInput
  ): Promise<SimulationDelta> {
    const beforeResult = await this.simulate(before);

    // Phase 9 — enrich "after" profiles with real benchmark data when
    // bridge is available. This models the quality improvement from
    // promoting a capability (experimental → active) using actual
    // benchmark measurements rather than static defaults.
    let afterResult: SimulationResult;
    if (this.benchmarkBridge) {
      const enrichedAfter = await this.enrichWithBridge(after);
      afterResult = await this.simulate(enrichedAfter);
    } else {
      afterResult = await this.simulate(after);
    }

    return SimulationDeltaSchema.parse({
      costDelta: round2(afterResult.totalEstimatedCost - beforeResult.totalEstimatedCost),
      latencyDeltaMs: round2(afterResult.totalEstimatedLatencyMs - beforeResult.totalEstimatedLatencyMs),
      qualityDelta: round2(afterResult.estimatedAvgQuality - beforeResult.estimatedAvgQuality),
      riskDelta: round2(afterResult.riskScore - beforeResult.riskScore),
      before: beforeResult,
      after: afterResult,
      simulatedAt: new Date().toISOString(),
    });
  }

  /**
   * Enrich simulation profiles with real benchmark quality data.
   * For each node in the graph, if the bridge has benchmark data for
   * that role, use it instead of the default profile.
   */
  private async enrichWithBridge(input: SimulationInput): Promise<SimulationInput> {
    const enriched: Record<string, RoleProfile> = { ...input.profiles };
    for (const node of input.graph.nodes) {
      const bridgeProfile = await this.benchmarkBridge!.getQualityProfile(node.role);
      if (bridgeProfile) {
        enriched[node.role] = bridgeProfile;
      }
    }
    return { ...input, profiles: enriched };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
