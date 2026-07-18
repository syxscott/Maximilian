// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Plan Reviewer Gate (borrowed from Kosmos plan_reviewer).
 *
 * Validates Commander.plan output before execution starts.
 * Rejected plans trigger revise -> re-review (up to maxReviseLoops).
 *
 * Kosmos reference:
 *   https://raw.githubusercontent.com/jimmc414/Kosmos/master/kosmos/orchestration/plan_reviewer.py
 *
 * Kosmos 5 dimensions: specificity, relevance, novelty, coverage, feasibility.
 * Maximilian heuristic gate: requires >=3 tasks AND >=2 task types.
 */

export interface PlanReviewScore {
  /** Feasibility of completing within constraints. */
  feasibility: number;
  /** Specificity of task descriptions. */
  specificity: number;
  /** Relevance to user intent. */
  relevance: number;
  /** Novelty vs prior plans. */
  novelty: number;
  /** Test coverage of expected outcomes. */
  coverage: number;
}

export interface PlanReview {
  planId: string;
  scores: PlanReviewScore;
  approved: boolean;
  /** Feedback if rejected. */
  feedback?: string;
  /** Suggested revisions if rejected. */
  suggestions?: string[];
}

/** Minimum thresholds for plan approval. */
const MIN_MEAN_SCORE = 0.7;
const MIN_EACH_SCORE = 0.5;
const MIN_TASKS = 3;
const MIN_TASK_TYPES = 2;
const MAX_REVISE_LOOPS = 2;

function meanScore(scores: PlanReviewScore): number {
  const vals = Object.values(scores);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function countTaskTypes(tasks: Array<{ type?: string }>): number {
  const types = new Set(tasks.map((t) => t.type ?? "default"));
  return types.size;
}

/**
 * Review a plan and decide whether to approve or reject.
 * Returns feedback + suggestions if rejected.
 */
export function reviewPlan(
  plan: { id: string; tasks?: Array<{ type?: string; description?: string }> },
  priorPlans?: PlanReview[],
): PlanReview {
  const tasks = plan.tasks ?? [];

  const scores: PlanReviewScore = {
    feasibility: tasks.length >= MIN_TASKS ? 0.8 : 0.3,
    specificity: tasks.every((t) => t.description && t.description.length > 10) ? 0.8 : 0.4,
    relevance: 0.7,
    novelty: priorPlans && priorPlans.length > 0 ? 0.6 : 0.9,
    coverage: tasks.length >= MIN_TASKS ? 0.7 : 0.3,
  }

  // 修复 Bug 20 — check per-dimension minimum AND overall mean
  const reasons: string[] = []
  const minDimScore = Math.min(...Object.values(scores))
  const minDimKey = Object.keys(scores).find((k) => scores[k as keyof PlanReviewScore] === minDimScore) ?? ""
  if (minDimScore < MIN_EACH_SCORE) {
    reasons.push(`Dimension "${minDimKey}" scored ${minDimScore}, minimum required is ${MIN_EACH_SCORE}`)
  }
  if (meanScore(scores) < MIN_MEAN_SCORE) {
    reasons.push(`Mean score ${meanScore(scores).toFixed(2)} below threshold ${MIN_MEAN_SCORE}`)
  }

  const approved =
    tasks.length >= MIN_TASKS &&
    countTaskTypes(tasks) >= MIN_TASK_TYPES &&
    minDimScore >= MIN_EACH_SCORE &&
    meanScore(scores) >= MIN_MEAN_SCORE

  if (approved) {
    return { planId: plan.id, scores, approved: true };
  }

  const suggestions: string[] = [];
  if (tasks.length < MIN_TASKS) suggestions.push(`Add more tasks (minimum ${MIN_TASKS})`);
  if (countTaskTypes(tasks) < MIN_TASK_TYPES) suggestions.push(`Diversify task types (minimum ${MIN_TASK_TYPES} types)`);
  if (!tasks.every((t) => t.description && t.description.length > 10)) {
    suggestions.push("Enrich task descriptions (>= 10 chars each)");
  }

  return {
    planId: plan.id,
    scores,
    approved: false,
    feedback: `Plan rejected: ${[...reasons, ...suggestions].join("; ")}`,
    suggestions,
  };
}

/**
 * Revise a plan based on reviewer feedback.
 * Returns a revised plan id (or the same id if no revision needed).
 */
export function revisePlan(
  originalPlan: { id: string; tasks: Array<Record<string, unknown>> },
  review: PlanReview,
): { id: string; tasks: Array<Record<string, unknown>> } {
  if (review.approved) return originalPlan;

  // Simple revision: split tasks if too few, add多样性 if needed
  const revisedTasks = [...originalPlan.tasks];
  if (revisedTasks.length < MIN_TASKS) {
    // Duplicate existing tasks with modified descriptions
    while (revisedTasks.length < MIN_TASKS) {
      revisedTasks.push({ ...revisedTasks[0], description: "Refined: " + (revisedTasks[0].description ?? "") });
    }
  }
  return { id: `${originalPlan.id}-revised`, tasks: revisedTasks };
}

export { MAX_REVISE_LOOPS };
