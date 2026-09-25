/**
 * Unit tests for the Goals panel's pure model layer (goals-model.ts) — the
 * TUI port of the dashboard's features/goals derivation. Pins the honest
 * semantics: goals are derived from the workspace object, never invented,
 * and garbage input yields an empty view instead of a throw.
 */

import { describe, it, expect } from "vitest"
import {
  dependsOnSummary,
  dependencyDepths,
  deriveGoals,
  failureSummary,
  taskStateColor,
  type GoalTaskView,
} from "../src/components/goals-model"

const COMPLETED_WORKSPACE = {
  id: "ws-1",
  userRequest: "Ship the digest feature",
  status: "completed",
  plan: {
    tasks: [
      { id: "t1", description: "Design the schema", status: "completed", agentRole: "architect" },
      {
        id: "t2",
        description: "Implement it",
        status: "completed",
        agentRole: "coder",
        dependsOn: ["t1"],
      },
      {
        id: "t3",
        description: "Test it",
        status: "completed",
        agentRole: "tester",
        dependsOn: ["t2"],
      },
    ],
  },
  results: [{ ok: true }],
  review: { score: 0.92 },
}

describe("deriveGoals", () => {
  it("derives a completed workspace: 100% via status, review score in milestones", () => {
    const view = deriveGoals(COMPLETED_WORKSPACE)
    expect(view.request).toBe("Ship the digest feature")
    expect(view.status).toBe("completed")
    expect(view.primary).toEqual({
      percent: 100,
      completed: 3,
      total: 3,
      failed: 0,
      basis: "status-completed",
    })
    const review = view.milestones.find((m) => m.key === "review")
    expect(review?.done).toBe(true)
    expect(review?.score).toBe(0.92)
    expect(view.summary.remaining).toBe(0)
    expect(view.sources).toEqual(["userRequest", "plan", "results", "review"])
  })

  it("derives a running workspace from the task ratio", () => {
    const view = deriveGoals({
      userRequest: "Half done",
      status: "running",
      plan: {
        tasks: [
          { id: "a", description: "done", status: "completed", agentRole: "coder" },
          { id: "b", description: "pending", status: "pending", agentRole: "coder" },
          { id: "c", description: "running", status: "running", agentRole: "coder" },
          { id: "d", description: "skipped", status: "skipped", agentRole: "coder" },
        ],
      },
    })
    expect(view.primary.basis).toBe("task-ratio")
    expect(view.primary.percent).toBe(25)
    expect(view.summary).toEqual({ percent: 25, completed: 1, total: 4, failed: 0, remaining: 3 })
    const execution = view.milestones.find((m) => m.key === "execution")
    expect(execution?.done).toBe(false) // two tasks are non-terminal
  })

  it("derives a failed workspace from the failure ratio", () => {
    const view = deriveGoals({
      userRequest: "Doomed run",
      status: "failed",
      plan: {
        tasks: [
          { id: "a", description: "ok", status: "completed", agentRole: "coder" },
          { id: "b", description: "boom", status: "failed", agentRole: "coder" },
        ],
      },
    })
    expect(view.primary.basis).toBe("failure-ratio")
    expect(view.primary.percent).toBe(50)
    expect(view.primary.failed).toBe(1)
  })

  it("yields an honest empty view for null/garbage workspaces (never throws)", () => {
    for (const input of [null, undefined, "nope", 42, { status: "not-a-status" }]) {
      const view = deriveGoals(input)
      expect(view.primary).toEqual({
        percent: 0,
        completed: 0,
        total: 0,
        failed: 0,
        basis: "not-started",
      })
      expect(view.subGoals).toEqual([])
      expect(view.sources).toEqual([])
      expect(view.status).toBe(input === null || input === undefined ? "unknown" : view.status)
      expect(view.milestones.every((m) => !m.done)).toBe(true)
    }
  })

  it("falls back unknown task ids/roles/states defensively", () => {
    const view = deriveGoals({
      userRequest: "Weird plan",
      status: "planning",
      plan: {
        tasks: [{ description: "no id, bad status", status: "WAT" }, "not-an-object", null],
      },
    })
    expect(view.subGoals).toHaveLength(1)
    expect(view.subGoals[0]?.id).toBe("task-1") // index fallback
    expect(view.subGoals[0]?.state).toBe("unknown")
    expect(view.subGoals[0]?.role).toBe("unknown")
    expect(view.primary.basis).toBe("task-ratio")
    expect(view.primary.percent).toBe(0)
  })
})

describe("dependencyDepths (indent depth from the dependsOn chain)", () => {
  it("puts a task one level below its deepest dependency and ignores unknown deps", () => {
    const tasks = [
      { id: "root", description: "", state: "completed" as const, role: "", dependsOn: [] },
      {
        id: "mid",
        description: "",
        state: "completed" as const,
        role: "",
        dependsOn: ["root", "ghost"],
      },
      { id: "leaf", description: "", state: "completed" as const, role: "", dependsOn: ["mid"] },
    ]
    const depths = dependencyDepths(tasks)
    expect(depths.get("root")).toBe(0)
    expect(depths.get("mid")).toBe(1)
    expect(depths.get("leaf")).toBe(2)
  })

  it("cuts dependency cycles instead of spinning (finite depths, revisit = 0)", () => {
    const tasks = [
      { id: "a", description: "", state: "pending" as const, role: "", dependsOn: ["b"] },
      { id: "b", description: "", state: "pending" as const, role: "", dependsOn: ["a"] },
    ]
    const depths = dependencyDepths(tasks)
    // The revisit of "a" inside the cycle resolves to 0, so "b" sits one
    // level below that and "a" one below "b" — finite and stable.
    expect(depths.get("b")).toBe(1)
    expect(depths.get("a")).toBe(2)
  })

  it("survives a self-loop (a task depending on itself) without recursing forever", () => {
    const depths = dependencyDepths([
      { id: "t1", description: "", state: "pending" as const, role: "", dependsOn: ["t1"] },
      { id: "t2", description: "", state: "pending" as const, role: "", dependsOn: ["t1"] },
    ])
    // The revisit of "t1" inside its own chain is cut to 0; the entry leg
    // still counts one level — finite, deterministic, no stack overflow.
    expect(depths.get("t1")).toBe(1)
    expect(depths.get("t2")).toBe(2)
  })
})

describe("failureSummary + dependsOnSummary (deepened panel helpers)", () => {
  const MIXED = deriveGoals({
    userRequest: "r",
    status: "running",
    plan: {
      tasks: [
        { id: "t1", description: "base", status: "completed" },
        { id: "t2", description: "broken step", status: "failed", dependsOn: ["t1"] },
        { id: "t3", description: "", status: "failed", dependsOn: ["t2", "ghost"] },
      ],
    },
  })

  it("lists failed sub-goals in plan order with id + best-available label", () => {
    expect(failureSummary(MIXED.subGoals)).toEqual({
      count: 2,
      entries: ["t2 broken step", "t3 t3"], // empty label falls back to the id
    })
  })

  it("returns null when nothing failed (the error line stays hidden)", () => {
    expect(failureSummary(deriveGoals(COMPLETED_WORKSPACE).subGoals)).toBeNull()
    expect(failureSummary([])).toBeNull()
  })

  it("is defensive against garbage input (never throws)", () => {
    expect(failureSummary(null as unknown as GoalTaskView[])).toBeNull()
    expect(failureSummary([null, 42] as unknown as GoalTaskView[])).toBeNull()
  })

  it("joins the declared dependency chain with arrows; null when there are none", () => {
    expect(dependsOnSummary(MIXED.subGoals[0]!)).toBeNull()
    expect(dependsOnSummary(MIXED.subGoals[1]!)).toBe("t1")
    expect(dependsOnSummary(MIXED.subGoals[2]!)).toBe("t2 → ghost") // declared is shown as-is
    expect(dependsOnSummary({ dependsOn: [1, "", "ok"] as unknown as string[] })).toBe("ok")
  })
})

describe("taskStateColor (state dot mapping)", () => {
  it("maps every task state to a stable color", () => {
    expect(taskStateColor("completed")).toBe("green")
    expect(taskStateColor("failed")).toBe("red")
    expect(taskStateColor("running")).toBe("cyan")
    expect(taskStateColor("pending")).toBe("yellow")
    expect(taskStateColor("skipped")).toBe("gray")
    expect(taskStateColor("cancelled")).toBe("gray")
    expect(taskStateColor("unknown")).toBe("gray")
  })
})
