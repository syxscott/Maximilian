/**
 * 5.8 — AutonomyOrchestrator
 *
 * Top-level facade that ties the closed loop together. After each
 * workspace completes, this orchestrator runs:
 *
 *   1. Save execution records per task
 *   2. Run ReviewIntelligence to produce structured reviews
 *   3. Run FailurePatternAnalyzer
 *   4. For each role with poor performance, run EvolutionPlanner
 *   5. For each plan, run CandidateGenerator
 *   6. Periodically (or on-demand) run PromotionEngine.decide
 *
 * It does NOT modify the existing Runtime / DAGS / Evolution code.
 */

import { randomUUID } from "node:crypto";
import type { Workspace, Result, Task } from "@max/core";
import type { AgentBlueprint, Blueprint, DAGS } from "@max/dags";
import { ExecutionStore } from "./execution-store.js";
import { ReviewIntelligence } from "./review-intelligence.js";
import { FailurePatternAnalyzer, InsightsStore } from "./insights-store.js";
import { EvolutionPlanner } from "./evolution-planner.js";
import { CandidateGenerator } from "./candidate-generator.js";
import { PromotionEngine } from "./promotion-engine.js";
import {
  type ExecutionRecord,
  type StructuredReview,
  type EvolutionPlan,
  type CandidateVersion,
  type PromotionRecord,
} from "./types.js";

export interface AutonomyDeps {
  dags: DAGS;
  review: ReviewIntelligence;
  executionStore: ExecutionStore;
  insightsStore: InsightsStore;
  failureAnalyzer: FailurePatternAnalyzer;
  planner: EvolutionPlanner;
  candidateGenerator: CandidateGenerator;
  promotionEngine: PromotionEngine;
}

export interface ObserveResult {
  executions: ExecutionRecord[];
  reviews: StructuredReview[];
  plans: EvolutionPlan[];
  candidates: CandidateVersion[];
  promotions: PromotionRecord[];
}

export class AutonomyOrchestrator {
  constructor(private deps: AutonomyDeps) {}

  /**
   * Observe a completed workspace and trigger the closed loop.
   * Safe to call multiple times for the same workspace (idempotent
   * on executionId).
   */
  async observe(workspace: Workspace): Promise<ObserveResult> {
    const executions: ExecutionRecord[] = [];
    const reviews: StructuredReview[] = [];
    const plans: EvolutionPlan[] = [];
    const candidates: CandidateVersion[] = [];
    const promotions: PromotionRecord[] = [];

    // Cache role -> blueprint to avoid repeated full scans
    const blueprintCache = new Map<string, Blueprint>();
    const resolveCachedBlueprint = async (role: string): Promise<Blueprint | undefined> => {
      if (blueprintCache.has(role)) return blueprintCache.get(role)!;
      const bp = await this.resolveBlueprint(role);
      if (bp) blueprintCache.set(role, bp);
      return bp;
    };

    // 1. Per-task execution records.
    const taskRecords = await Promise.all(
      (workspace.plan?.tasks ?? []).map(async (task) => {
        const result = workspace.results.find((r) => r.taskId === task.id);
        const exec = await this.buildExecutionRecord(workspace, task, result);
        await this.deps.executionStore.save(exec);
        return exec;
      })
    );
    executions.push(...taskRecords);

    // 2. Structured reviews per non-review task.
    const reviewable = executions.filter(
      (exec) => exec.agentRole !== "reviewer" && exec.agentRole !== "review"
    );
    const reviewResults = await Promise.all(
      reviewable.map(async (exec) => {
        try {
          const artifacts = this.collectArtifacts(workspace, exec);
          if (artifacts.length === 0) return null;
          const review = await this.deps.review.review({
            taskId: exec.taskId,
            workspaceId: exec.workspaceId,
            artifacts,
            userRequest: workspace.userRequest,
          });
          exec.review = review;
          await this.deps.executionStore.save(exec);
          return review;
        } catch (err) {
          console.error(`[AutonomyOrchestrator] review failed for ${exec.taskId}:`, err);
          return null;
        }
      })
    );
    reviews.push(...(reviewResults.filter(Boolean) as StructuredReview[]));

    // 3. Failure pattern mining (shared single listAll call).
    const allExecutions = await this.deps.executionStore.listAll();
    await Promise.all([
      this.deps.failureAnalyzer.analyze(allExecutions),
      this.deps.failureAnalyzer.leaderboardInsight(allExecutions),
    ]);

    // 4. Evolution planning per role.
    const insights = await this.deps.insightsStore.loadPatterns();
    const roleResults = await Promise.all(
      uniqueRoles(executions)
        .filter((role) => role !== "reviewer" && role !== "review")
        .map(async (role) => {
          const roleExecs = executions.filter((e) => e.agentRole === role);
          const roleReviews = reviews.filter((r) =>
            roleExecs.some((e) => e.taskId === r.taskId)
          );
          const blueprint = await resolveCachedBlueprint(role);
          if (!blueprint) return null;
          const plan = this.deps.planner.plan({
            role,
            currentVersion: blueprint.version,
            executions: roleExecs,
            reviews: roleReviews,
            failureInsights: insights,
            userFeedback: roleExecs.flatMap((e) => e.userFeedback.map((f) => f.text)),
          });
          if (plan) {
            await this.deps.planner.savePlan(plan);
            return plan;
          }
          return null;
        })
    );
    plans.push(...(roleResults.filter(Boolean) as EvolutionPlan[]));

    // 5. Candidate generation.
    const candidateResults = await Promise.all(
      plans.map(async (plan) => {
        const blueprint = await resolveCachedBlueprint(plan.agentRole);
        if (!blueprint) return null;
        return this.deps.candidateGenerator.generate(plan, blueprint);
      })
    );
    candidates.push(...candidateResults.filter(Boolean) as CandidateVersion[]);

    // 6. Promotion decisions (best-effort, may skip if sample too small).
    for (const candidate of candidates) {
      const blueprint = await resolveCachedBlueprint(candidate.agentRole);
      if (!blueprint) continue;
      const decision = await this.deps.promotionEngine.decide(
        candidate,
        blueprint.id,
        executions
      );
      if (decision.record) promotions.push(decision.record);
    }

    return { executions, reviews, plans, candidates, promotions };
  }

  // --------------------------------------------------------------------------

  private async buildExecutionRecord(
    workspace: Workspace,
    task: Task,
    result: Result | undefined
  ): Promise<ExecutionRecord> {
    const id = `exec-${workspace.id}-${task.id}-${randomUUID().slice(0, 4)}`;
    return {
      id,
      taskId: task.id,
      workspaceId: workspace.id,
      agentRole: task.agentRole,
      blueprintId: (result?.metadata?.blueprintId as string) ?? undefined,
      blueprintVersion: (result?.metadata?.blueprintVersion as string) ?? undefined,
      graphId: undefined,
      modelAssignment: result?.metadata?.provider
        ? {
            provider: String(result.metadata.provider),
            model: String(result.metadata.model ?? ""),
          }
        : undefined,
      artifacts: this.collectArtifactNames(workspace, task),
      userFeedback: [],
      startedAt: task.startedAt ?? new Date().toISOString(),
      completedAt: task.completedAt ?? new Date().toISOString(),
      durationMs: result?.durationMs,
      status: task.status === "completed" ? "completed" : task.status === "failed" ? "failed" : "pending",
      error: task.error,
    };
  }

  private collectArtifacts(
    workspace: Workspace,
    exec: ExecutionRecord
  ): Array<{ role: string; content: string }> {
    const out: Array<{ role: string; content: string }> = [];
    const result = workspace.results.find((r) => r.taskId === exec.taskId);
    if (result) {
      out.push({ role: result.agentRole, content: result.output });
    }
    return out;
  }

  private collectArtifactNames(workspace: Workspace, task: Task): string[] {
    return workspace.results
      .filter((r) => r.taskId === task.id)
      .flatMap((r) => {
        const meta = (r.metadata ?? {}) as { artifacts?: string[] };
        return meta.artifacts ?? [];
      });
  }

  private async resolveBlueprint(role: string): Promise<AgentBlueprint | undefined> {
    const candidates = await this.deps.dags.store.findByRole(role);
    return candidates[0];
  }
}

function uniqueRoles(records: ExecutionRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.agentRole)));
}
