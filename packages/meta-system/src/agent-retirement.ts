/**
 * 6.6 — AgentRetirementEngine
 *
 * Decision rule (over recent N=100 executions per blueprint):
 *   - usageCount < minUsageToKeep (default 2), OR
 *   - avgScore < minScoreToKeep (default 4.0)
 *
 * Output: RetirementDecision[]
 * Side effect: marks blueprint.retiredAt on the supplied BlueprintStore.
 */

import {
  RetirementDecisionSchema,
  RETIREMENT_THRESHOLDS,
  type RetirementDecision,
  type RetirementReason,
} from "./types.js";
import type { ExecutionRecord } from "@max/autonomy";

export interface RetirementDeps {
  /** Lookback window. Defaults to RETIREMENT_THRESHOLDS.lookback (100). */
  lookback?: number;
  /** Minimum usageCount in the lookback window. Defaults to 2. */
  minUsageToKeep?: number;
  /** Minimum avgScore to keep. Defaults to 4.0. */
  minScoreToKeep?: number;
  /** Optional side-effect: retire a blueprint id in a store. */
  retireBlueprint?: (blueprintId: string) => Promise<void>;
}

export class AgentRetirementEngine {
  constructor(private deps: RetirementDeps = {}) {}

  async evaluate(
    blueprintId: string,
    role: string,
    executions: ExecutionRecord[]
  ): Promise<RetirementDecision | undefined> {
    const lookback = this.deps.lookback ?? RETIREMENT_THRESHOLDS.lookback;
    const minUsage = this.deps.minUsageToKeep ?? RETIREMENT_THRESHOLDS.minUsageToKeep;
    const minScore = this.deps.minScoreToKeep ?? RETIREMENT_THRESHOLDS.minScoreToKeep;

    const recent = executions
      .filter((e) => e.blueprintId === blueprintId)
      .slice(-lookback);

    if (recent.length === 0) {
      // No recent usage at all → retire for low_usage.
      return this.buildDecision(blueprintId, role, "low_usage", {
        usageCount: 0,
        avgScore: 0,
        sampleSize: 0,
      });
    }

    const usageCount = recent.length;
    const scored = recent
      .map((e) => e.review?.score)
      .filter((s): s is number => s !== undefined);
    const avgScore =
      scored.length > 0 ? scored.reduce((a, b) => a + b, 0) / scored.length : 0;

    if (usageCount < minUsage) {
      return this.buildDecision(blueprintId, role, "low_usage", {
        usageCount,
        avgScore,
        sampleSize: recent.length,
      });
    }

    if (avgScore < minScore) {
      return this.buildDecision(blueprintId, role, "low_score", {
        usageCount,
        avgScore,
        sampleSize: recent.length,
      });
    }

    return undefined;
  }

  async evaluateAll(
    blueprintIds: string[],
    executions: ExecutionRecord[]
  ): Promise<RetirementDecision[]> {
    const decisions: RetirementDecision[] = [];
    for (const id of blueprintIds) {
      const role = id.replace(/^bp-/, "").split("-")[0] ?? id;
      const d = await this.evaluate(id, role, executions);
      if (d) {
        decisions.push(d);
        if (this.deps.retireBlueprint) {
          await this.deps.retireBlueprint(id);
        }
      }
    }
    return decisions;
  }

  private buildDecision(
    blueprintId: string,
    role: string,
    reason: RetirementReason,
    metrics: { usageCount: number; avgScore: number; sampleSize: number }
  ): RetirementDecision {
    return RetirementDecisionSchema.parse({
      blueprintId,
      role,
      reason,
      metrics,
      decidedAt: new Date().toISOString(),
    });
  }
}
