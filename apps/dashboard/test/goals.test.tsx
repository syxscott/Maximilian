// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the goals feature domain: deriveGoals model-layer unit
 * tests (primary-goal completion per workspace status, sub-goals from
 * plan.tasks, dependency depth chains, milestones, defensive payloads)
 * plus render smoke for GoalTree, GoalSummaryCard and the evolution
 * 视角 GoalEvolutionPanel. The suite pins the honest-data contract:
 * percentages are plain arithmetic over real workspace objects, the
 * view always discloses its sources, and the evolution section only
 * ever shows metrics the leaderboard actually reported — degrading
 * explicitly when the engine is unavailable. The ai-elements mount
 * round covers the summary card's DonutStat ring + StatCard strip and
 * the goal tree's failed-sub-goal DeltaBadge count.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"
import { render, screen, waitFor, within, act } from "@testing-library/react"
import type { RenderResult } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"

import goalsEn from "../src/locales/goals.en-US.json"
import aiEn from "../src/locales/ai-elements.en-US.json"
import {
  deriveGoals,
  dependencyDepths,
  roleColor,
  matchRoleEntries,
  normalizeAcceptance,
  parseRoleDetail,
} from "../src/features/goals/model"
import { GoalTree } from "../src/features/goals/GoalTree"
import { GoalSummaryCard } from "../src/features/goals/GoalSummaryCard"
import { GoalEvolutionPanel } from "../src/features/goals/GoalEvolutionPanel"
import {
  getEvolutionAgentsByRole,
  getEvolutionLeaderboard,
  getEvolutionVersionsByRoleDecisions,
} from "../src/api-generated"
import {
  WORKSPACE_DOCK_STORAGE_KEY,
  WorkspaceDockSidebar,
  createWorkspaceDockModel,
  useWorkspaceDockStore,
} from "../src/components/layout/WorkspaceDockSidebar"
import type { Workspace } from "../src/api"

vi.mock("../src/api-generated", () => ({
  getEvolutionLeaderboard: vi.fn(),
  getEvolutionAgentsByRole: vi.fn(),
  getEvolutionVersionsByRoleDecisions: vi.fn(),
}))

// The dock-wiring round mounts the whole WorkspaceDockSidebar; every sibling
// leaf is stubbed so the suite exercises ONLY the goals leaf's wiring (the
// deliverables leaf gets the same treatment in deliverables-deep.test.tsx).
// chatApi.getWorkspace is stubbed so the deliverables leaf's fetch degrades
// instead of hitting the network.
vi.mock("../src/api", () => ({
  chatApi: { getWorkspace: vi.fn() },
  systemApi: { vaultStatus: vi.fn(), oracleLessons: vi.fn() },
}))
vi.mock("@/components/AgentPanel", () => ({ AgentPanel: () => null }))
vi.mock("@/components/TaskPanel", () => ({ TaskPanel: () => null }))
vi.mock("@/components/SubagentsPanel", () => ({ SubagentsPanel: () => null }))
vi.mock("@/features/trajectory", () => ({ TrajectoryPanel: () => null }))
vi.mock("@/components/FileChangesPanel", () => ({ FileChangesPanel: () => null }))
vi.mock("@/components/SessionsPanel", () => ({ SessionsPanel: () => null }))
vi.mock("@/components/ArtifactsExplorer", () => ({ ArtifactsExplorer: () => null }))
vi.mock("@/components/ReviewPanel", () => ({ ReviewPanel: () => null }))
vi.mock("@/components/OutputPanel", () => ({ OutputPanel: () => null }))
vi.mock("@/features/session-query", () => ({ SessionSearchPanel: () => null }))

const mockedLeaderboard = vi.mocked(getEvolutionLeaderboard)
const mockedAgentsByRole = vi.mocked(getEvolutionAgentsByRole)
const mockedDecisionsByRole = vi.mocked(getEvolutionVersionsByRoleDecisions)

/** The ai-elements dictionary is a nested tree; flatten to dotted keys. */
function flattenAi(tree: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === "object") {
      Object.assign(out, flattenAi(value as Record<string, unknown>, dotted))
    } else {
      out[dotted] = String(value)
    }
  }
  return out
}

beforeAll(() => {
  // The dock-wiring round mounts the whole WorkspaceDockSidebar, whose leaf
  // headers translate registry title keys from many domains — register the
  // aggregated dictionaries exactly like main.tsx first, then overlay.
  applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
  const existing = getDictionary("en-US") ?? {}
  registerLocale("en-US", {
    ...existing,
    ...(goalsEn as Record<string, string>),
    ...flattenAi(aiEn as Record<string, unknown>),
  })
  setLocale("en-US")
})

/** React-query provider wrapper — the evolution panel queries on mount. */
function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  mockedLeaderboard.mockReset().mockResolvedValue({ entries: [] })
  mockedAgentsByRole.mockReset()
  mockedDecisionsByRole.mockReset()
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
    renderWithClient(<GoalTree workspace={ALL_SUCCESS} />)
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
    const first = renderWithClient(<GoalTree workspace={null} />)
    expect(screen.getByTestId("goals-empty")).toBeTruthy()
    first.unmount()

    renderWithClient(
      <GoalTree workspace={{ userRequest: "Only a request", status: "planning", results: [] }} />,
    )
    expect(screen.queryByTestId("goals-empty")).toBeNull()
    expect(screen.getByTestId("goals-no-plan")).toBeTruthy()
    expect(screen.getByTestId("goal-primary").textContent).toContain("Only a request")
  })

  it("GoalSummaryCard shows percent, done/total, failed and remaining as StatCards", () => {
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
    // Each count renders as an ai-elements StatCard (label + value tile).
    expect(screen.getByTestId("goal-summary-completed")).toHaveTextContent("1/4")
    expect(screen.getByTestId("goal-summary-failed")).toHaveTextContent("1")
    expect(screen.getByTestId("goal-summary-remaining")).toHaveTextContent("3")
    expect(screen.getByTestId("goal-summary-card").textContent).toContain("no ETA is estimated")
  })

  it("GoalSummaryCard mounts a DonutStat ring whose fill matches the percent", () => {
    const midway = {
      userRequest: "Ship it",
      status: "running",
      plan: { tasks: [task("t1", { status: "completed" }), task("t2", { status: "pending" })] },
      results: [],
    }
    render(<GoalSummaryCard workspace={midway} />)
    const ring = screen.getByLabelText("Overall goal progress ring")
    expect(ring.getAttribute("role")).toBe("meter")
    expect(ring.getAttribute("aria-valuenow")).toBe("50")
  })

  it("GoalSummaryCard StatCard trends: failed reads down, clean runs read flat", () => {
    const failing = {
      userRequest: "Ship it",
      status: "running",
      plan: {
        tasks: [task("t1", { status: "completed" }), task("t2", { status: "failed" })],
      },
      results: [],
    }
    const mounted = render(<GoalSummaryCard workspace={failing} />)
    expect(
      within(screen.getByTestId("goal-summary-failed")).getByLabelText("Trending down"),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("goal-summary-completed")).getByLabelText("Flat trend"),
    ).toBeInTheDocument()
    mounted.unmount()

    render(
      <GoalSummaryCard
        workspace={{
          userRequest: "Clean",
          status: "running",
          plan: { tasks: [task("t1", { status: "completed" })] },
          results: [],
        }}
      />,
    )
    expect(
      within(screen.getByTestId("goal-summary-failed")).getByLabelText("Flat trend"),
    ).toBeInTheDocument()
  })

  it("GoalTree flags failed sub-goals with a DeltaBadge carrying the failure count", () => {
    const failing = {
      userRequest: "Ship it",
      status: "failed",
      plan: {
        tasks: [
          task("t1", { status: "completed" }),
          task("t2", { status: "failed" }),
          task("t3", { status: "failed" }),
        ],
      },
      results: [],
    }
    renderWithClient(<GoalTree workspace={failing} />)
    const badge = screen.getByTestId("goals-failed-delta")
    // Signed reading: two failures = "-2" (a loss, not a gain).
    expect(badge.textContent).toBe("-2")
    expect(badge.getAttribute("title")).toBe("2 failed sub-goal(s)")
    expect(within(badge).getByLabelText("decrease")).toBeInTheDocument()
  })

  it("GoalTree renders no failure badge when nothing failed", () => {
    renderWithClient(<GoalTree workspace={ALL_SUCCESS} />)
    expect(screen.queryByTestId("goals-failed-delta")).toBeNull()
  })
})

// ── Evolution视角: model layer ──────────────────────────────────────────────

describe("matchRoleEntries — leaderboard entries matched to plan roles", () => {
  it("keeps entries whose role matches the plan roles, in plan-role order", () => {
    const entries = [
      { role: "reviewer", runs: 5, avgScore: 8.8, acceptance: 92 },
      { role: "executor", runs: 12, avgScore: 7.4, acceptance: 81 },
      { role: "planner", runs: 3, avgScore: 9.1, acceptance: 100 },
    ]
    const matched = matchRoleEntries(entries, ["planner", "executor"])
    expect(matched).toEqual([
      { role: "planner", runs: 3, avgScore: 9.1, acceptance: 100 },
      { role: "executor", runs: 12, avgScore: 7.4, acceptance: 81 },
    ])
  })

  it("normalizes the live payload spelling (agentRole/sampleSize/userSatisfaction) and scales fractional acceptance", () => {
    // The backend's LeaderboardEntry carries agentRole + sampleSize +
    // userSatisfaction (0..1); the model maps both spellings honestly.
    const entries = [
      { agentRole: "executor", sampleSize: 7, avgScore: 6.5, userSatisfaction: 0.83 },
    ]
    expect(matchRoleEntries(entries, ["executor"])).toEqual([
      { role: "executor", runs: 7, avgScore: 6.5, acceptance: 83 },
    ])
    expect(normalizeAcceptance(0.83)).toBe(83)
    expect(normalizeAcceptance(92)).toBe(92)
  })

  it("skips garbage entries and keeps missing metrics as null (no fabrication)", () => {
    const entries = [
      null,
      42,
      { runs: 5 }, // no role → unusable
      { role: "executor" }, // role, but no metrics reported
      { role: "", runs: 9 },
    ]
    expect(matchRoleEntries(entries, ["executor"])).toEqual([
      { role: "executor", runs: null, avgScore: null, acceptance: null },
    ])
  })

  it("keeps the first entry per role and omits roles the leaderboard lacks", () => {
    const entries = [
      { role: "executor", runs: 12, avgScore: 7.4, acceptance: 81 },
      { role: "executor", runs: 2, avgScore: 3, acceptance: 40 }, // duplicate → ignored
    ]
    expect(matchRoleEntries(entries, ["executor", "reviewer"])).toEqual([
      { role: "executor", runs: 12, avgScore: 7.4, acceptance: 81 },
    ])
  })

  it("returns [] for garbage inputs (non-array entries, non-string roles)", () => {
    expect(matchRoleEntries("nope", ["executor"])).toEqual([])
    expect(matchRoleEntries([{ role: "executor" }], null)).toEqual([])
    expect(matchRoleEntries([{ role: "executor" }], [1, null, ""])).toEqual([])
    expect(matchRoleEntries([], ["executor"])).toEqual([])
  })
})

describe("parseRoleDetail — lazy profile + decision-log pair", () => {
  it("reads version chain, decision count (seed v1 excluded) and total tasks", () => {
    const profile = { currentVersion: "v3", versions: ["v1", "v2", "v3"], totalTasks: 12 }
    const decisionLog = {
      role: "executor",
      decisions: [
        { id: "v1", reason: "initial" },
        { id: "v2", reason: "Addressed 3 failures" },
        { id: "v3", reason: "Heuristic improvement" },
      ],
    }
    expect(parseRoleDetail(profile, decisionLog)).toEqual({
      currentVersion: "v3",
      versionCount: 3,
      decisionCount: 2,
      totalTasks: 12,
    })
  })

  it("yields nulls (honest dashes) for missing pieces and garbage inputs", () => {
    expect(parseRoleDetail(null, null)).toEqual({
      currentVersion: null,
      versionCount: null,
      decisionCount: null,
      totalTasks: null,
    })
    // A raw decision array (not wrapped in { decisions }) still counts.
    expect(parseRoleDetail({ versions: [] }, [{ id: "v2" }])).toEqual({
      currentVersion: null,
      versionCount: 0,
      decisionCount: 1,
      totalTasks: null,
    })
    expect(
      parseRoleDetail({ currentVersion: "v1" }, { role: "executor", decisions: "junk" }),
    ).toEqual({
      currentVersion: "v1",
      versionCount: null,
      decisionCount: null,
      totalTasks: null,
    })
  })
})

// ── Evolution视角: render smoke ─────────────────────────────────────────────

describe("GoalEvolutionPanel render smoke", () => {
  it("renders real matched metrics in plan-role order and lazily loads detail on click", async () => {
    const user = userEvent.setup()
    mockedLeaderboard.mockResolvedValue({
      entries: [
        { agentRole: "reviewer", sampleSize: 5, avgScore: 8.8, userSatisfaction: 0.92 },
        { agentRole: "executor", sampleSize: 12, avgScore: 7.44, userSatisfaction: 0.81 },
      ],
    })
    mockedAgentsByRole.mockResolvedValue({
      currentVersion: "v3",
      versions: ["v1", "v2", "v3"],
      totalTasks: 12,
    })
    mockedDecisionsByRole.mockResolvedValue({
      role: "executor",
      decisions: [{ id: "v1" }, { id: "v2" }, { id: "v3" }],
    })

    renderWithClient(<GoalEvolutionPanel roles={["planner", "executor"]} />)

    // Planner has no leaderboard entry → only executor appears (no made-up row).
    await waitFor(() => expect(screen.getByTestId("goal-evolution-rows")).toBeTruthy())
    expect(screen.getByTestId("goal-evolution-role-executor").textContent).toContain("executor")
    expect(screen.getByTestId("goal-evolution-role-executor").textContent).toContain("12")
    expect(screen.getByTestId("goal-evolution-role-executor").textContent).toContain("7.4")
    expect(screen.getByTestId("goal-evolution-role-executor").textContent).toContain("81%")
    expect(screen.queryByTestId("goal-evolution-role-planner")).toBeNull()

    // Detail is lazy: nothing fetched before the click, fetched after.
    expect(mockedAgentsByRole).not.toHaveBeenCalled()
    await user.click(screen.getByTestId("goal-evolution-role-executor"))
    await waitFor(() => expect(screen.getByTestId("goal-evolution-detail")).toBeTruthy())
    expect(mockedAgentsByRole).toHaveBeenCalledWith("executor", expect.anything())
    expect(mockedDecisionsByRole).toHaveBeenCalledWith("executor", expect.anything())
    expect(screen.getByTestId("goal-evolution-detail").textContent).toContain("v3")
    expect(screen.getByTestId("goal-evolution-detail").textContent).toContain("3") // promoted versions
    expect(screen.getByTestId("goal-evolution-detail").textContent).toContain("2") // decisions (v1 excluded)
  })

  it("degrades honestly: unavailable when the engine is off, empty when nothing matches", async () => {
    // Evolution disabled / route unreachable → explicit degraded note.
    mockedLeaderboard.mockRejectedValue(new Error("503 evolution disabled"))
    const failed = renderWithClient(<GoalEvolutionPanel roles={["executor"]} />)
    await waitFor(() => expect(screen.getByTestId("goal-evolution-unavailable")).toBeTruthy())
    failed.unmount()

    // Engine answered but no entry matches this workspace's roles.
    mockedLeaderboard.mockResolvedValue({
      entries: [{ role: "planner", runs: 3, avgScore: 9.1, acceptance: 100 }],
    })
    renderWithClient(<GoalEvolutionPanel roles={["executor"]} />)
    await waitFor(() => expect(screen.getByTestId("goal-evolution-empty")).toBeTruthy())
    expect(screen.queryByTestId("goal-evolution-rows")).toBeNull()
  })

  it("GoalTree embeds the role-performance section under the sub-goals for planned workspaces", async () => {
    mockedLeaderboard.mockResolvedValue({
      entries: [{ role: "executor", runs: 12, avgScore: 7.4, acceptance: 81 }],
    })
    const mounted = renderWithClient(<GoalTree workspace={ALL_SUCCESS} />)
    await waitFor(() => expect(screen.getByTestId("goal-evolution-rows")).toBeTruthy())
    expect(screen.getByTestId("goal-evolution-panel").textContent).toContain("Role performance")
    mounted.unmount()

    // No plan → no section at all (nothing to match, no speculative fetch).
    mockedLeaderboard.mockClear()
    renderWithClient(
      <GoalTree workspace={{ userRequest: "Request only", status: "planning", results: [] }} />,
    )
    expect(screen.queryByTestId("goal-evolution-panel")).toBeNull()
    expect(mockedLeaderboard).not.toHaveBeenCalled()
  })
})

// ── Dock wiring: the goals leaf receives the real workspace ─────────────────
//
// WorkspaceDockSidebar renders the goals leaf as GoalTree + GoalSummaryCard
// with the workspace prop handed straight through. The dock-integration suite
// only ever mounts the sidebar with a null workspace (empty states); these
// tests pin the real-data side of that wiring: a workspace-bearing sidebar
// renders the DERIVED goal view (ring, request, basis) inside the dock leaf,
// for both goal components, and re-derives when the workspace changes.

describe("WorkspaceDockSidebar wiring — the goals leaf", () => {
  const resetDock = () => {
    try {
      localStorage.removeItem(WORKSPACE_DOCK_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    useWorkspaceDockStore.setState({ model: createWorkspaceDockModel(), maximizedId: null })
  }

  // Reset BEFORE each test only: RTL cleanup unmounts the previous tree
  // after afterEach hooks run, so resetting there would update a still-
  // mounted subscriber outside act.
  beforeEach(() => {
    resetDock()
    mockedLeaderboard.mockResolvedValue({ entries: [] })
  })

  it("renders the derived goal view of the real workspace inside the goals leaf", async () => {
    // act-wrapped: the dock store's async rehydration settles after the
    // synchronous render and must not update outside act.
    await act(async () => {
      renderWithClient(
        <WorkspaceDockSidebar workspace={ALL_SUCCESS as unknown as Workspace} events={[]} />,
      )
      // Let react-query's macrotask-batched notifications settle inside act.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const leaf = screen.getByTestId("dock-panel-goals")
    // Both leaf children are the real goal components...
    expect(leaf.querySelector("[data-testid='goal-tree']")).toBeTruthy()
    expect(leaf.querySelector("[data-testid='goal-summary-card']")).toBeTruthy()
    // ...showing the workspace's real derivation: the request as the primary
    // goal, the 100% status-completed ring, and the matching summary headline.
    expect(leaf.querySelector("[data-testid='goal-progress-ring']")?.textContent).toContain("100%")
    expect(leaf.querySelector("[data-testid='goal-primary']")?.textContent).toContain(
      "Ship the export feature",
    )
    expect(leaf.querySelector("[data-testid='goal-summary-percent']")?.textContent).toBe(
      "100% overall",
    )
    // Sub-goals from the plan render inside the leaf too (dependency depth attr).
    expect(leaf.querySelector("[data-testid='subgoal-t2']")?.getAttribute("data-depth")).toBe("1")
  })

  it("re-derives the leaf when the workspace prop changes (running → task ratio)", async () => {
    const running = {
      ...ALL_SUCCESS,
      status: "running",
      review: undefined,
      plan: {
        ...ALL_SUCCESS.plan,
        tasks: [
          task("t1", { status: "completed" }),
          task("t2", { status: "pending" }),
          task("t3", { status: "pending" }),
          task("t4", { status: "pending" }),
        ],
      },
    }
    let mounted: RenderResult
    await act(async () => {
      mounted = renderWithClient(
        <WorkspaceDockSidebar workspace={running as unknown as Workspace} events={[]} />,
      )
      // Let react-query's macrotask-batched notifications settle inside act.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByTestId("goal-progress-ring").textContent).toContain("25%")
    await act(async () => {
      mounted!.rerender(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <WorkspaceDockSidebar
            workspace={{ ...running, status: "failed" } as unknown as Workspace}
            events={[]}
          />
        </QueryClientProvider>,
      )
    })
    // Same tasks, failed status → the failure-ratio basis (0 of 4 completed,
    // 0 failed → honest 0%), re-derived from the new payload.
    expect(screen.getByTestId("goal-progress-ring").textContent).toContain("0%")
  })
})
