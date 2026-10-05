// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workspace-goal judging tests: the deterministic run-outcome judge covers
 * all verdict branches (failed run, review-score bands, unreviewed
 * completion), the fail-closed path returns nothing for empty goals, and
 * the metadata attach is pure (never saves, never mutates the input).
 */

import { describe, it, expect } from "vitest"
import {
  GOAL_ACHIEVED_REVIEW_SCORE,
  GOAL_PARTIAL_REVIEW_SCORE,
  judgeWorkspaceGoal,
  withGoalJudgement,
  workspaceGoalEvidence,
  type WorkspaceGoalInput,
} from "../src/workspace-goal.js"

function base(overrides: Partial<WorkspaceGoalInput> = {}): WorkspaceGoalInput {
  return {
    id: "ws-1",
    userRequest: "migrate the auth service to the new token format",
    status: "completed",
    results: [{ agentRole: "backend", output: "done: 3 files migrated" }],
    metadata: {},
    ...overrides,
  } as WorkspaceGoalInput
}

describe("workspaceGoalEvidence", () => {
  it("emits factual lines: status, per-agent output, review, error", () => {
    const ws = base({
      results: [
        { agentRole: "backend", output: "abc" },
        { agentRole: "review", output: "long output here" },
      ],
      review: {
        score: 8,
        issues: ["i1"],
        suggestions: ["s1", "s2"],
      },
      error: "step X timed out",
    } as Partial<WorkspaceGoalInput>)
    const lines = workspaceGoalEvidence(ws).records ?? []
    expect(lines[0]).toBe("run status: completed")
    expect(lines).toContain("agent backend produced output (3 chars)")
    expect(lines).toContain("agent review produced output (16 chars)")
    expect(lines.some((l) => l.startsWith("review score 8/10"))).toBe(true)
    expect(lines).toContain("run error: step X timed out")
  })
})

describe("judgeWorkspaceGoal", () => {
  it("failed run → failed, reason carries the error", async () => {
    const j = await judgeWorkspaceGoal(base({ status: "failed", error: "planner exploded" }))
    expect(j?.verdict).toBe("failed")
    expect(j?.source).toBe("judge")
    expect(j?.reason).toContain("planner exploded")
  })

  it("review score bands: >=7 achieved, 4..6 partially, <4 failed", async () => {
    const high = await judgeWorkspaceGoal(
      base({
        review: { score: GOAL_ACHIEVED_REVIEW_SCORE, issues: [], suggestions: [] },
      } as Partial<WorkspaceGoalInput>),
    )
    expect(high?.verdict).toBe("achieved")

    const mid = await judgeWorkspaceGoal(
      base({
        review: { score: GOAL_PARTIAL_REVIEW_SCORE, issues: [], suggestions: [] },
      } as Partial<WorkspaceGoalInput>),
    )
    expect(mid?.verdict).toBe("partially_achieved")

    const low = await judgeWorkspaceGoal(
      base({
        review: { score: GOAL_PARTIAL_REVIEW_SCORE - 0.5, issues: [], suggestions: [] },
      } as Partial<WorkspaceGoalInput>),
    )
    expect(low?.verdict).toBe("failed")
  })

  it("completed without review → honestly partially_achieved (ungraded)", async () => {
    const j = await judgeWorkspaceGoal(base())
    expect(j?.verdict).toBe("partially_achieved")
    expect(j?.reason).toContain("ungraded")
    expect(j?.confidence).toBeLessThan(0.8)
  })

  it("empty user request → nothing evaluable, no judgement invented", async () => {
    const j = await judgeWorkspaceGoal(base({ userRequest: "   " }))
    expect(j).toBeUndefined()
  })

  it("judgements validate against the goal-judge schema (source stamped)", async () => {
    const j = await judgeWorkspaceGoal(
      base({ review: { score: 9, issues: [], suggestions: [] } } as Partial<WorkspaceGoalInput>),
    )
    expect(j).toMatchObject({
      verdict: "achieved",
      source: "judge",
      evaluated: true,
    })
    expect(j?.confidence).toBeGreaterThanOrEqual(0)
    expect(j?.confidence).toBeLessThanOrEqual(1)
    expect(j?.reason.length).toBeGreaterThan(0)
  })
})

describe("withGoalJudgement", () => {
  it("attaches a stamped judgement into metadata without mutating input", async () => {
    const ws = base({
      review: { score: 8, issues: [], suggestions: [] },
    } as Partial<WorkspaceGoalInput>)
    const out = await withGoalJudgement(ws)
    expect(out).not.toBe(ws)
    const stored = out.metadata?.goalJudgement as {
      verdict: string
      judgedAt: string
      source: string
    }
    expect(stored.verdict).toBe("achieved")
    expect(stored.source).toBe("judge")
    expect(new Date(stored.judgedAt).getTime()).not.toBeNaN()
    expect(ws.metadata?.goalJudgement).toBeUndefined()
  })

  it("returns the input unchanged when nothing is evaluable", async () => {
    const ws = base({ userRequest: "" })
    const out = await withGoalJudgement(ws)
    expect(out).toBe(ws)
    expect(out.metadata?.goalJudgement).toBeUndefined()
  })

  it("preserves existing metadata keys", async () => {
    const ws = base({ metadata: { tenantId: "t1", jobId: "j1" } })
    const out = await withGoalJudgement(ws)
    expect(out.metadata?.tenantId).toBe("t1")
    expect(out.metadata?.jobId).toBe("j1")
    expect(out.metadata?.goalJudgement).toBeDefined()
  })
})
