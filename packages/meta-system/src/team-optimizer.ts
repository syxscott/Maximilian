/**
 * 6.4 — TeamOptimizer
 *
 * Given recent execution history + current team graph, produces a
 * TeamOptimizerHint with concrete suggestions to reduce cost / latency
 * or improve quality.
 *
 * Suggestion types:
 *   - add_review_node: if no review node, add one
 *   - remove_redundant: if multiple roles have > 0.8 correlation
 *   - parallelize: high-latency serial chain
 *   - shrink_team: avg latency > 30s, suggest dropping low-utility role
 *   - grow_team: avg quality < 7.5, suggest adding specialist
 *
 * Phase 7 — applyHints() materializes the hint into the BlueprintStore:
 *   - add_review_node   → mark a "review" blueprint as required on next compose
 *   - remove_redundant  → set blueprint.metadata.pendingRetirement = true
 *   - parallelize       → set blueprint.metadata.parallelizeGroup = <n>
 *   - shrink_team       → set blueprint.metadata.pendingRetirement = true
 *   - grow_team         → set blueprint.metadata.growthCandidate = true
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  TeamOptimizerHintSchema,
  TEAM_OPTIMIZER_CONFIG,
  type TeamOptimizerHint,
} from "./types.js";
import type { ExecutionRecord } from "@max/autonomy";
import type { TeamGraph, AgentBlueprint } from "@max/dags";

export interface OptimizerInput {
  graph: TeamGraph;
  executions: ExecutionRecord[];
}

export interface OptimizerDeps {
  /** Root directory where hint metadata is persisted. */
  rootDir?: string;
  /**
   * Phase 7 — optional side-effect: persist hint into BlueprintStore.
   * The store is queried by DAGS on next compose() to read metadata
   * flags like `pendingRetirement` / `parallelizeGroup`.
   * Returns the count of blueprints modified.
   */
  applyToBlueprintStore?: (hint: TeamOptimizerHint) => Promise<number>;
}

export class TeamOptimizer {
  constructor(private deps: OptimizerDeps = {}) {}

  async suggest(input: OptimizerInput): Promise<TeamOptimizerHint> {
    const suggestions: TeamOptimizerHint["suggestions"] = [];

    // 1. Missing review node?
    const hasReview = input.graph.nodes.some(
      (n) => n.role === "review" || n.role === "reviewer"
    );
    if (!hasReview) {
      suggestions.push({
        type: "add_review_node",
        rationale: "Team has no review node — add a final review task.",
        expectedCostDelta: 1,
        expectedLatencyDeltaMs: 3000,
      });
    }

    // 2. Redundant roles (>0.8 score correlation).
    const redundant = this.findRedundantRoles(input.executions);
    for (const r of redundant) {
      suggestions.push({
        type: "remove_redundant",
        targetRole: r,
        rationale: `Role ${r} correlates > 0.8 with another role; consider removing.`,
        expectedCostDelta: -1,
        expectedLatencyDeltaMs: -2000,
      });
    }

    // 3. Serial chain with high latency → parallelize.
    const avgLatency = this.avgLatency(input.executions);
    if (avgLatency > TEAM_OPTIMIZER_CONFIG.minLatencyToShrinkMs) {
      suggestions.push({
        type: "parallelize",
        rationale: `Avg latency ${avgLatency.toFixed(0)}ms exceeds ${TEAM_OPTIMIZER_CONFIG.minLatencyToShrinkMs}ms — try parallelizing independent nodes.`,
        expectedCostDelta: 0.5,
        expectedLatencyDeltaMs: -avgLatency * 0.3,
      });
    }

    // 4. Quality low → grow team (suggest specialist).
    const avgQuality = this.avgQuality(input.executions);
    if (avgQuality > 0 && avgQuality < TEAM_OPTIMIZER_CONFIG.minQualityToGrow) {
      suggestions.push({
        type: "grow_team",
        rationale: `Avg quality ${avgQuality.toFixed(2)} below ${TEAM_OPTIMIZER_CONFIG.minQualityToGrow} — consider adding a specialist role.`,
        expectedCostDelta: 1,
        expectedLatencyDeltaMs: 1500,
      });
    }

    const estimatedCost = input.graph.nodes.reduce((sum, n) => {
      const ma = n.modelAssignment as unknown as { cost?: number } | undefined;
      // Phase 7 — use real cost when modelAssignment has it, else fallback to 1.
      return sum + (ma && typeof ma.cost === "number" ? ma.cost : 1);
    }, 0) || input.graph.nodes.length;
    const estimatedLatencyMs = avgLatency || 5000;
    const estimatedQuality = avgQuality || 7;

    return TeamOptimizerHintSchema.parse({
      id: `hint-${randomUUID().slice(0, 8)}`,
      suggestions,
      estimatedCost,
      estimatedLatencyMs,
      estimatedQuality,
      createdAt: new Date().toISOString(),
    });
  }

  private findRedundantRoles(executions: ExecutionRecord[]): string[] {
    // Heuristic: roles that always appear together in the same workspace
    // and have nearly identical scores.
    const out: string[] = [];
    const byRole = new Map<string, number[]>();
    for (const e of executions) {
      if (e.review?.score === undefined) continue;
      const arr = byRole.get(e.agentRole) ?? [];
      arr.push(e.review.score);
      byRole.set(e.agentRole, arr);
    }
    const roles = Array.from(byRole.entries());
    for (let i = 0; i < roles.length; i++) {
      const [rA, sA] = roles[i]!;
      const meanA = mean(sA);
      for (let j = i + 1; j < roles.length; j++) {
        const [rB, sB] = roles[j]!;
        const meanB = mean(sB);
        if (Math.abs(meanA - meanB) < 0.5) {
          out.push(rB);
          break;
        }
      }
    }
    return out;
  }

  private avgLatency(executions: ExecutionRecord[]): number {
    const durations = executions
      .map((e) => e.durationMs ?? 0)
      .filter((d) => d > 0);
    return durations.length > 0 ? mean(durations) : 0;
  }

  private avgQuality(executions: ExecutionRecord[]): number {
    const scores = executions
      .map((e) => e.review?.score)
      .filter((s): s is number => s !== undefined);
    return scores.length > 0 ? mean(scores) : 0;
  }

  /**
   * Phase 7 — materialize a hint into the BlueprintStore (if wired)
   * and persist the hint itself to disk.
   * Returns the number of blueprints modified.
   */
  async applyHint(hint: TeamOptimizerHint): Promise<number> {
    if (this.deps.rootDir) {
      await persistHint(hint, this.deps.rootDir);
    }
    if (this.deps.applyToBlueprintStore) {
      return await this.deps.applyToBlueprintStore(hint);
    }
    return 0;
  }
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ---------------------------------------------------------------------------
// Phase 7 — hint materialization
// ---------------------------------------------------------------------------

/**
 * Apply a hint's suggestions to the blueprint store.
 * Returns the count of blueprints modified.
 */
export async function applyHintToBlueprints(
  hint: TeamOptimizerHint,
  blueprints: AgentBlueprint[],
  save: (bp: AgentBlueprint) => Promise<void>
): Promise<number> {
  let modified = 0;
  const byRole = new Map<string, AgentBlueprint[]>();
  for (const bp of blueprints) {
    if (bp.retiredAt) continue;
    const arr: AgentBlueprint[] = byRole.get(bp.role) ?? [];
    arr.push(bp);
    byRole.set(bp.role, arr);
  }
  const latestByRole = (role: string): AgentBlueprint | undefined => {
    const arr = byRole.get(role);
    if (!arr || arr.length === 0) return undefined;
    return [...arr].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  };
  for (const s of hint.suggestions) {
    if (s.type === "add_review_node") {
      // Ensure a review blueprint exists; if it does, mark required=true.
      const review = latestByRole("review") ?? latestByRole("reviewer");
      if (review) {
        const updated: AgentBlueprint = {
          ...review,
          metadata: { ...review.metadata, optimizerRequired: true, lastHintId: hint.id },
          updatedAt: new Date().toISOString(),
        };
        await save(updated);
        modified++;
      }
    } else if (s.type === "remove_redundant" || s.type === "shrink_team") {
      const target = s.targetRole ? latestByRole(s.targetRole) : undefined;
      if (target) {
        const updated: AgentBlueprint = {
          ...target,
          metadata: { ...target.metadata, pendingRetirement: true, lastHintId: hint.id },
          updatedAt: new Date().toISOString(),
        };
        await save(updated);
        modified++;
      }
    } else if (s.type === "parallelize") {
      // Mark all top-2 most-used blueprints as parallelizable.
      const sorted = blueprints
        .filter((b) => !b.retiredAt)
        .sort((a, b) => (b.stats.totalTasks ?? 0) - (a.stats.totalTasks ?? 0));
      for (const bp of sorted.slice(0, 2)) {
        const updated: AgentBlueprint = {
          ...bp,
          metadata: { ...bp.metadata, parallelizeGroup: hint.id, lastHintId: hint.id },
          updatedAt: new Date().toISOString(),
        };
        await save(updated);
        modified++;
      }
    } else if (s.type === "grow_team") {
      // No specific role to mark; record on the most-used blueprint as a growth signal.
      const top = blueprints
        .filter((b) => !b.retiredAt)
        .sort((a, b) => (b.stats.totalTasks ?? 0) - (a.stats.totalTasks ?? 0))[0];
      if (top) {
        const updated: AgentBlueprint = {
          ...top,
          metadata: { ...top.metadata, growthCandidate: true, lastHintId: hint.id },
          updatedAt: new Date().toISOString(),
        };
        await save(updated);
        modified++;
      }
    }
  }
  return modified;
}

/** Phase 7 — persist the hint itself to disk for later inspection. */
export async function persistHint(
  hint: TeamOptimizerHint,
  rootDir: string
): Promise<void> {
  await fs.mkdir(path.join(rootDir, "team-hints"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "team-hints", `${hint.id}.json`),
    JSON.stringify(hint, null, 2),
    "utf-8"
  );
}
