// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workspace-goal judging — the production consumer of the goal-judge.
 *
 * In this system a "goal" is the workspace's user request (there is no
 * separate goal store — the dashboard derives goals from workspace objects
 * for the same reason). When a run finishes, the goal is judged against the
 * run's REAL outcome evidence and the four-verdict judgement is attached to
 * the workspace metadata, where `GET /workspaces/{id}` and the dashboard
 * already read everything else.
 *
 * The judge here is deterministic run-outcome mapping (hermes verdict
 * vocabulary): a failed run is `failed`; a review score decides
 * achieved / partially_achieved on the same 0..10 axis the review agent
 * already uses; an unreviewed completed run is honestly
 * `partially_achieved` (work happened, but nobody graded it). The
 * `blocked` verdict is reserved for explicit escalation flows — a run
 * outcome alone never claims it. Injection through `judgeGoal` keeps the
 * fail-closed schema validation: an invalid derived verdict degrades to
 * the keyword judge instead of being trusted.
 */

import type { Workspace } from "@max/core"
import {
  judgeGoal,
  type GoalEvidence,
  type GoalJudgeFn,
  type GoalJudgeResult,
} from "./goal-judge.js"

/** Review score (0..10) at or above which a goal counts as achieved. */
export const GOAL_ACHIEVED_REVIEW_SCORE = 7
/** At or above which a goal counts as partially achieved. Below → failed. */
export const GOAL_PARTIAL_REVIEW_SCORE = 4

/** The subset of Workspace the judge reads — trivially fakeable in tests. */
export type WorkspaceGoalInput = Pick<
  Workspace,
  "userRequest" | "status" | "results" | "review" | "error"
> & {
  metadata?: Record<string, unknown>
}

/** Shape persisted under `workspace.metadata.goalJudgement`. */
export interface StoredGoalJudgement extends GoalJudgeResult {
  judgedAt: string
}

/**
 * Factual evidence lines from the run — what actually happened, no outcome
 * adjectives (the judge derives those). Included so the stored judgement's
 * `reason` can be audited against what the judge saw.
 */
export function workspaceGoalEvidence(ws: WorkspaceGoalInput): GoalEvidence {
  const records: string[] = []
  records.push(`run status: ${ws.status}`)
  for (const r of ws.results) {
    records.push(`agent ${r.agentRole} produced output (${r.output.length} chars)`)
  }
  if (ws.review) {
    records.push(
      `review score ${ws.review.score}/10, issues: ${ws.review.issues.length}, ` +
        `suggestions: ${ws.review.suggestions.length}`,
    )
  }
  if (ws.error) {
    records.push(`run error: ${ws.error}`)
  }
  return { records }
}

/**
 * Deterministic run-outcome judge. Verdict priority:
 *   failed run → failed; review score → achieved / partially_achieved /
 *   failed on the 0..10 axis; otherwise completed-unreviewed →
 *   partially_achieved. Confidence reflects how direct the evidence is.
 */
export function workspaceOutcomeJudge(ws: WorkspaceGoalInput): GoalJudgeFn {
  return () => {
    if (ws.status === "failed") {
      return {
        verdict: "failed",
        reason: ws.error ? `run failed: ${ws.error}` : "run failed without an error record",
        confidence: 0.9,
      }
    }
    if (ws.review) {
      const score = ws.review.score
      if (score >= GOAL_ACHIEVED_REVIEW_SCORE) {
        return {
          verdict: "achieved",
          reason: `review score ${score}/10 >= ${GOAL_ACHIEVED_REVIEW_SCORE}`,
          confidence: 0.85,
        }
      }
      if (score >= GOAL_PARTIAL_REVIEW_SCORE) {
        return {
          verdict: "partially_achieved",
          reason:
            `review score ${score}/10 between ` +
            `${GOAL_PARTIAL_REVIEW_SCORE} and ${GOAL_ACHIEVED_REVIEW_SCORE}`,
          confidence: 0.8,
        }
      }
      return {
        verdict: "failed",
        reason: `review score ${score}/10 < ${GOAL_PARTIAL_REVIEW_SCORE}`,
        confidence: 0.85,
      }
    }
    return {
      verdict: "partially_achieved",
      reason: "run completed without a review verdict — work happened, ungraded",
      confidence: 0.5,
    }
  }
}

/**
 * Judge the workspace's goal from its run outcome. Returns undefined when
 * there is nothing evaluable (empty user request) — no judgement is
 * invented, and callers should attach nothing.
 */
export async function judgeWorkspaceGoal(
  ws: WorkspaceGoalInput,
): Promise<GoalJudgeResult | undefined> {
  const result = await judgeGoal(
    { goal: ws.userRequest, evidence: workspaceGoalEvidence(ws) },
    workspaceOutcomeJudge(ws),
  )
  if (!result.evaluated) return undefined
  return result
}

/**
 * Convenience for callers persisting the outcome: the workspace with
 * `metadata.goalJudgement` set, or the input unchanged when not
 * evaluable. Callers own the save — this never writes.
 */
export async function withGoalJudgement<W extends WorkspaceGoalInput>(ws: W): Promise<W> {
  const judgement = await judgeWorkspaceGoal(ws)
  if (!judgement) return ws
  const stored: StoredGoalJudgement = { ...judgement, judgedAt: new Date().toISOString() }
  return { ...ws, metadata: { ...(ws.metadata ?? {}), goalJudgement: stored } }
}
