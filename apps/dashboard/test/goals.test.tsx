// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the goals feature domain: deriveGoals model-layer unit
 * tests (primary-goal completion per workspace status, sub-goals from
 * plan.tasks, dependency depth chains, milestones, defensive payloads)
 * plus render smoke for GoalTree and GoalSummaryCard. The suite pins
 * the honest-data contract: percentages are plain arithmetic over real
 * workspace objects and the view always discloses its sources.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { render, screen } from "@testing-library/react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import goalsEn from "../src/locales/goals.en-US.json"
import { deriveGoals, dependencyDepths, roleColor } from "../src/features/goals/model"
import { GoalTree } from "../src/features/goals/GoalTree"
import { GoalSummaryCard } from "../src/features/goals/GoalSummaryCard"

beforeAll(() => {
  const existing = getDictionary("en-US") ?? {}
  registerLocale("en-US", { ...existing, ...(goalsEn as Record<string, string>) })
  setLocale("en-US")
})

function task(
  id: string,
  overrides: Partial<{
    agentRole: string
    description: string
    status: string
    dependsOn: string[]
  }> = {},
) {
  return {
    id,
    agentRole: "executor",
    description: `Do ${id}`,
    status: "completed",
    dependsOn: [],
    ...overrides,
  }
}

const ALL_SUCCESS = {
  id: "ws-1",
  userRequest: "Ship the export feature",
  status: "completed",
  plan: {
    id: "plan-1",
    workspaceId: "ws-1",
    userRequest: "Ship the export feature",
    rationale: "split by role",
    createdAt: "2026-09-24T00:00:00Z",
    tasks: [
      task("t1", { agentRole: "planner", description: "Draft the plan" }),
      task("t2", { description: "Implement export", dependsOn: ["t1"] }),
      task("t3", { agentRole: "reviewer", description: "Review", dependsOn: ["t2"] }),
    ],
  },
  results: [{ id: "r1", taskId: "t1", output: "plan text" }],
  review: {
    id: "rev-1",
    score: 9.2,
    issues: [],
    suggestions: [],
    summary: "great",
    reviewedAt: "2026-09-24T01:00:00Z",
  },
  createdAt: "2026-09-24T00:00:00Z",
  updatedAt: "2026-09-24T01:00:00Z",
}

// ── Model layer: deriveGoals ────────────────────────────────────────────────

describe("deriveGoals — primary goal completion", () => {
  it("reports 100% from the workspace status when completed", () => {
    const view = deriveGoals(ALL_SUCCESS)
    expect(view.primary).toEqual({
      percent: 100,
      completed: 3,
      total: 3,
      failed: 0,
      basis: "status-completed",
    })
    expect(view.status).toBe("completed")
    expect(view.request).toBe("Ship the export feature")
    // Every real source contributed — the UI discloses all four.
    expect(view.sources).toEqual(["userRequest", "plan", "results", "review"])
  })

  it("derives running progress as completed tasks / total", () => {
    const running = {
      ...ALL_SUCCESS,
      status: "running",
      plan: {
        ...ALL_SUCCESS.plan,
        tasks: [
          task("t1", { status: "completed" }),
          task("t2", { status: "completed" }),
          task("t3", { status: "running" }),
          task("t4", { status: "pending" }),
        ],
      },
      review: undefined,
    }
    const view = deriveGoals(running)
    expect(view.primary).toEqual({
      percent: 50,
      completed: 2,
      total: 4,
      failed: 0,
      basis: "task-ratio",
    })
    expect(view.sources).toEqual(["userRequest", "plan", "results"])
  })

  it("derives failed progress as the failed-task ratio", () => {
    const failed = {
      userRequest: "Ship it",
      status: "failed",
      plan: {
        tasks: [
          task("t1", { status: "completed" }),
          task("t2", { status: "failed" }),
          task("t3", { status: "failed" }),
          task("t4", { status: "pending" }),
        ],
      },
      results: [],
    }
    const view = deriveGoals(failed)
    expect(view.primary).toEqual({
      percent: 50,
      completed: 1,
      total: 4,
      failed: 2,
      basis: "failure-ratio",
    })
  })

  it("keeps a failed workspace without a plan at an honest 0%", () => {
    const view = deriveGoals({ userRequest: "Ship it", status: "failed", results: [] })
    expect(view.primary).toEqual({
      percent: 0,
      completed: 0,
      total: 0,
      failed: 0,
      basis: "failure-ratio",
    })
    expect(view.subGoals).toEqual([])
    expect(view.sources).toEqual(["userRequest"])
  })
})

describe("deriveGoals — sub-goals and milestones", () => {
  it("maps plan tasks to sub-goals with label, state and role", () => {
    const view = deriveGoals(ALL_SUCCESS)
    expect(view.subGoals).toEqual([
      {
        id: "t1",
        label: "Draft the plan",
        state: "completed",
        role: "planner",
        dependsOn: [],
        depth: 0,
      },
      {
        id: "t2",
        label: "Implement export",
        state: "completed",
        role: "executor",
        dependsOn: ["t1"],
        depth: 1,
      },
      {
        id: "t3",
        label: "Review",
        state: "completed",
        role: "reviewer",
        dependsOn: ["t2"],
        depth: 2,
      },
    ])
  })

  it("computes dependency depths along the dependsOn chain", () => {
    const rows = [
      { id: "a", description: "a", status: "pending", agentRole: "r", dependsOn: [] },
      { id: "b", description: "b", status: "pending", agentRole: "r", dependsOn: ["a"] },
      { id: "c", description: "c", status: "pending", agentRole: "r", dependsOn: ["b", "a"] },
      // Unknown deps and self-deps do not crash or deepen the chain.
      { id: "d", description: "d", status: "pending", agentRole: "r", dependsOn: ["ghost"] },
      { id: "e", description: "e", status: "pending", agentRole: "r", dependsOn: ["e"] },
    ]
    const depths = dependencyDepths(
      rows.map((r) => ({ ...r, state: "pending" as const, role: "r" })),
    )
    expect(depths.get("a")).toBe(0)
    expect(depths.get("b")).toBe(1)
    expect(depths.get("c")).toBe(2)
    expect(depths.get("d")).toBe(0)
    expect(depths.get("e")).toBe(1)
  })

  it("derives milestones from plan existence, execution and review", () => {
    const view = deriveGoals(ALL_SUCCESS)
    expect(view.milestones).toEqual([
      { key: "plan", done: true, score: null, taskCount: 3 },
      { key: "execution", done: true, score: null, taskCount: null },
      { key: "review", done: true, score: 9.2, taskCount: null },
    ])

    const midway = deriveGoals({
      userRequest: "x",
      status: "running",
      plan: { tasks: [task("t1", { status: "running" })] },
      results: [],
    })
    expect(midway.milestones.map((m) => m.done)).toEqual([true, false, false])

    // A review with a garbage score is still a milestone, without a score.
    const reviewed = deriveGoals({
      userRequest: "x",
      status: "running",
      results: [],
      review: { score: "high" },
    })
    expect(reviewed.milestones[2]).toEqual({
      key: "review",
      done: true,
      score: null,
      taskCount: null,
    })
  })

  it("summarizes with plain arithmetic (remaining = total − completed)", () => {
    const view = deriveGoals({
      userRequest: "x",
      status: "running",
      plan: {
        tasks: [
          task("t1", { status: "completed" }),
          task("t2", { status: "failed" }),
          task("t3", { status: "skipped" }),
          task("t4", { status: "pending" }),
        ],
      },
      results: [],
    })
    expect(view.summary).toEqual({
      percent: 25,
      completed: 1,
      total: 4,
      failed: 1,
      remaining: 3,
    })
  })
})

describe("deriveGoals — defensive payloads", () => {
  it("yields an honest empty view for null / garbage workspaces", () => {
    for (const garbage of [null, undefined, 42, "ws", [], { plan: "nope" }]) {
      const view = deriveGoals(garbage)
      expect(view.sources).toEqual([])
      expect(view.request).toBe("")
      expect(view.status).toBe("unknown")
      expect(view.primary).toEqual({
        percent: 0,
        completed: 0,
        total: 0,
        failed: 0,
        basis: "not-started",
      })
      expect(view.subGoals).toEqual([])
      expect(view.summary.remaining).toBe(0)
    }
  })

  it("tolerates broken plan task rows (missing id, bad status, junk entries)", () => {
    const view = deriveGoals({
      userRequest: "x",
      status: "running",
      plan: {
        tasks: [
          null,
          7,
          { description: "no id, bad status", status: "whenever", dependsOn: "t1" },
          { id: "ok", description: "fine", status: "completed" },
        ],
      },
      results: "nope",
    })
    expect(view.subGoals).toEqual([
      {
        id: "task-3",
        label: "no id, bad status",
        state: "unknown",
        role: "unknown",
        dependsOn: [],
        depth: 0,
      },
      {
        id: "ok",
        label: "fine",
        state: "completed",
        role: "unknown",
        dependsOn: [],
        depth: 0,
      },
    ])
    expect(view.summary).toEqual({
      percent: 50,
      completed: 1,
      total: 2,
      failed: 0,
      remaining: 1,
    })
  })

  it("normalizes unknown workspace statuses to unknown", () => {
    const view = deriveGoals({ userRequest: "x", status: "time-traveling" })
    expect(view.status).toBe("unknown")
    expect(view.primary.basis).toBe("not-started")
  })

  it("colors roles deterministically", () => {
    expect(roleColor("planner")).toBe(roleColor("planner"))
    expect(roleColor("planner")).toMatch(/^hsl\(\d+ 70% 45%\)$/)
    expect(roleColor("reviewer")).not.toBe(roleColor("planner"))
  })
})

// ── Render smoke ────────────────────────────────────────────────────────────

describe("goals render smoke", () => {
  it("GoalTree renders the ring, source disclosure, milestones and indented sub-goals", () => {
    render(<GoalTree workspace={ALL_SUCCESS} />)
    expect(screen.getByTestId("goal-tree")).toBeTruthy()
    expect(screen.getByTestId("goal-sources").textContent).toBe(
      "Data source: user request · plan · task results · review",
    )
    // Primary goal ring: 100% and the request as label.
    expect(screen.getByTestId("goal-progress-ring").textContent).toContain("100%")
    expect(screen.getByTestId("goal-primary").textContent).toContain("Ship the export feature")
    expect(screen.getByTestId("goal-primary").textContent).toContain(
      "Progress: workspace status is completed → 100%",
    )
    // Milestones all done; the review milestone carries the score badge.
    expect(screen.getByTestId("goal-milestone-plan").getAttribute("data-done")).toBe("true")
    expect(screen.getByTestId("goal-milestone-execution").getAttribute("data-done")).toBe("true")
    expect(screen.getByTestId("goal-milestone-review").getAttribute("data-done")).toBe("true")
    expect(screen.getByTestId("goal-milestone-review").textContent).toContain("score 9.2")
    // Sub-goals list with dependency indent depth attributes.
    expect(screen.getByTestId("subgoal-t1").getAttribute("data-depth")).toBe("0")
    expect(screen.getByTestId("subgoal-t2").getAttribute("data-depth")).toBe("1")
    expect(screen.getByTestId("subgoal-t3").getAttribute("data-depth")).toBe("2")
    expect(screen.getByTestId("subgoal-t3").textContent).toContain("depends on: t2")
  })

  it("GoalTree degrades to the empty state and the no-plan hint", () => {
    const first = render(<GoalTree workspace={null} />)
    expect(screen.getByTestId("goals-empty")).toBeTruthy()
    first.unmount()

    render(
      <GoalTree workspace={{ userRequest: "Only a request", status: "planning", results: [] }} />,
    )
    expect(screen.queryByTestId("goals-empty")).toBeNull()
    expect(screen.getByTestId("goals-no-plan")).toBeTruthy()
    expect(screen.getByTestId("goal-primary").textContent).toContain("Only a request")
  })

  it("GoalSummaryCard shows percent, done/total, failed and remaining — nothing else", () => {
    const midway = {
      userRequest: "Ship it",
      status: "running",
      plan: {
        tasks: [
          task("t1", { status: "completed" }),
          task("t2", { status: "failed" }),
          task("t3", { status: "pending" }),
          task("t4", { status: "pending" }),
        ],
      },
      results: [],
    }
    render(<GoalSummaryCard workspace={midway} />)
    expect(screen.getByTestId("goal-summary-card")).toBeTruthy()
    expect(screen.getByTestId("goal-summary-percent").textContent).toBe("25% overall")
    expect(screen.getByTestId("goal-summary-completed").textContent).toBe("1/4")
    expect(screen.getByTestId("goal-summary-failed").textContent).toBe("1")
    expect(screen.getByTestId("goal-summary-remaining").textContent).toBe("3")
    expect(screen.getByTestId("goal-summary-card").textContent).toContain("no ETA is estimated")
  })
})
