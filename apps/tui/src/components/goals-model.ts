// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the TUI Goals panel — a faithful port of the
 * dashboard's `apps/dashboard/src/features/goals/model.ts` derivation
 * semantics (deepseek ui-goal borrowing, honest-data edition): there is NO
 * independent goals backend. Every "goal" the panel shows is derived from
 * the real workspace object (GET /api/workspaces/{id}):
 *
 *   primary goal  ← the user request, completed per workspace.status
 *                   (completed → 100%, failed → failure ratio of the
 *                   plan's tasks, running → finished tasks / total)
 *   sub-goals     ← plan.tasks (label = description, state, role,
 *                   optional dependsOn chain → indent depth)
 *   milestones    ← plan existence / task execution / review score
 *
 * Input is a passthrough Workspace-shaped payload (fields may be missing or
 * garbage); everything here is defensive and unit-testable. The evolution
 * leaderboard / role-detail halves of the dashboard model are deliberately
 * not ported — the TUI panel does not render them.
 */

/** Terminal plan-task states (mirrors @max/core TaskStatus). */
export type GoalTaskState =
  "pending" | "running" | "completed" | "failed" | "skipped" | "cancelled" | "unknown"

const TASK_STATES: readonly GoalTaskState[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]

const WORKSPACE_STATUSES: readonly string[] = [
  "pending",
  "planning",
  "running",
  "completed",
  "failed",
]

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** How the headline percent was derived — disclosed in the UI. */
export type GoalProgressBasis =
  | "status-completed" // workspace.status === "completed" → 100%
  | "failure-ratio" // workspace.status === "failed" → failed tasks / total
  | "task-ratio" // otherwise → completed tasks / total
  | "not-started" // no (usable) plan → 0%

export interface GoalProgress {
  percent: number
  completed: number
  total: number
  failed: number
  basis: GoalProgressBasis
}

export interface GoalTaskView {
  id: string
  /** The plan task's description — the sub-goal as the planner wrote it. */
  label: string
  state: GoalTaskState
  role: string
  /** Declared dependencies (raw ids, as present in the plan). */
  dependsOn: string[]
  /** Indent depth from the dependsOn chain (0 = root; cycle-safe). */
  depth: number
}

export type GoalMilestoneKey = "plan" | "execution" | "review"

export interface GoalMilestoneView {
  key: GoalMilestoneKey
  done: boolean
  /** Review score — only the review milestone carries one. */
  score: number | null
  /** Task count — only the plan milestone carries one. */
  taskCount: number | null
}

export interface GoalSummaryView {
  percent: number
  completed: number
  total: number
  failed: number
  /** Plain arithmetic: total − completed. No ETA is derived from it. */
  remaining: number
}

export interface GoalsView {
  /** Which workspace objects actually contributed — shown in the UI. */
  sources: GoalSourceKey[]
  /** The user request — the primary goal text. */
  request: string
  /** Workspace status, or "unknown" when absent/garbage. */
  status: string
  primary: GoalProgress
  subGoals: GoalTaskView[]
  milestones: GoalMilestoneView[]
  summary: GoalSummaryView
}

export type GoalSourceKey = "userRequest" | "plan" | "results" | "review"

function taskState(value: unknown): GoalTaskState {
  return typeof value === "string" && (TASK_STATES as readonly string[]).includes(value)
    ? (value as GoalTaskState)
    : "unknown"
}

interface RawTask {
  id: string
  description: string
  state: GoalTaskState
  role: string
  dependsOn: string[]
}

/** Defensive plan.tasks → raw rows (ids fall back to their index). */
function rawTasks(plan: unknown): RawTask[] {
  if (plan == null || typeof plan !== "object") return []
  const tasks = (plan as { tasks?: unknown }).tasks
  if (!Array.isArray(tasks)) return []
  const rows: RawTask[] = []
  tasks.forEach((item, index) => {
    if (item == null || typeof item !== "object") return
    const row = item as Record<string, unknown>
    const deps = Array.isArray(row.dependsOn)
      ? row.dependsOn.filter((d): d is string => typeof d === "string")
      : []
    rows.push({
      id: str(row.id) || `task-${index + 1}`,
      description: str(row.description),
      state: taskState(row.status),
      role: str(row.agentRole, "unknown"),
      dependsOn: deps,
    })
  })
  return rows
}

/**
 * Indent depth from the dependsOn chain: a task sits one level deeper than
 * its deepest dependency. Unknown dependency ids are ignored; cycles are cut
 * (depth 0 at the revisit). Ported verbatim from the dashboard model.
 */
export function dependencyDepths(tasks: RawTask[]): Map<string, number> {
  const byId = new Map<string, RawTask>()
  for (const task of tasks) byId.set(task.id, task)
  const depths = new Map<string, number>()

  const resolve = (id: string, seen: Set<string>): number => {
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    const task = byId.get(id)
    if (!task || seen.has(id)) return 0
    seen.add(id)
    let depth = 0
    for (const dep of task.dependsOn) {
      if (!byId.has(dep)) continue // unknown dependency: no indent
      depth = Math.max(depth, resolve(dep, seen) + 1)
    }
    seen.delete(id)
    depths.set(id, depth)
    return depth
  }

  for (const task of tasks) resolve(task.id, new Set())
  return depths
}

function workspaceStatus(value: unknown): string {
  return typeof value === "string" && WORKSPACE_STATUSES.includes(value) ? value : "unknown"
}

/**
 * Derive the whole goal view from a workspace payload. Never throws; a
 * null/garbage workspace yields an honest empty view (0%, no sub-goals, no
 * milestones done, sources: []). Ported verbatim from the dashboard's
 * features/goals model so the TUI and the dashboard can never disagree
 * about what a workspace's goals are.
 */
export function deriveGoals(workspace: unknown): GoalsView {
  const record =
    workspace != null && typeof workspace === "object" ? (workspace as Record<string, unknown>) : {}

  const request = str(record.userRequest)
  const status = workspaceStatus(record.status)
  const plan = record.plan != null && typeof record.plan === "object" ? record.plan : null
  const tasks = rawTasks(plan)
  const depths = dependencyDepths(tasks)

  const results = Array.isArray(record.results) ? record.results : []
  const review = record.review != null && typeof record.review === "object" ? record.review : null
  const reviewScore = review ? finiteNumber((review as Record<string, unknown>).score) : null

  const completed = tasks.filter((t) => t.state === "completed").length
  const failed = tasks.filter((t) => t.state === "failed").length
  const total = tasks.length

  let percent = 0
  let basis: GoalProgressBasis = "not-started"
  if (status === "completed") {
    percent = 100
    basis = "status-completed"
  } else if (status === "failed") {
    percent = total > 0 ? clampPercent((failed / total) * 100) : 0
    basis = "failure-ratio"
  } else if (total > 0) {
    percent = clampPercent((completed / total) * 100)
    basis = "task-ratio"
  }

  const primary: GoalProgress = { percent, completed, total, failed, basis }

  const subGoals: GoalTaskView[] = tasks.map((task) => ({
    id: task.id,
    label: task.description,
    state: task.state,
    role: task.role,
    dependsOn: task.dependsOn,
    depth: depths.get(task.id) ?? 0,
  }))

  const terminalStates: readonly GoalTaskState[] = ["completed", "failed", "skipped", "cancelled"]
  const allTerminal = total > 0 && tasks.every((t) => terminalStates.includes(t.state))
  const milestones: GoalMilestoneView[] = [
    { key: "plan", done: plan != null && total > 0, score: null, taskCount: total },
    { key: "execution", done: allTerminal || status === "completed", score: null, taskCount: null },
    { key: "review", done: review != null, score: reviewScore, taskCount: null },
  ]

  const summary: GoalSummaryView = {
    percent,
    completed,
    total,
    failed,
    remaining: Math.max(0, total - completed),
  }

  const sources: GoalSourceKey[] = []
  if (request) sources.push("userRequest")
  if (plan != null) sources.push("plan")
  if (results.length > 0) sources.push("results")
  if (review != null) sources.push("review")

  return { sources, request, status, primary, subGoals, milestones, summary }
}

/** Deterministic dot color for a plan-task state (the panel just paints it). */
export function taskStateColor(state: GoalTaskState): string {
  switch (state) {
    case "completed":
      return "green"
    case "failed":
      return "red"
    case "running":
      return "cyan"
    case "pending":
      return "yellow"
    default: // skipped / cancelled / unknown
      return "gray"
  }
}

/**
 * The dependency chain as one display string ("t1 → t2"), for the "↳
 * depends:" line under an indented sub-goal. Non-string / unknown ids are
 * not the panel's problem here — what the plan declared is what shows. null
 * when the task declares no dependencies (no line is rendered).
 */
export function dependsOnSummary(task: Pick<GoalTaskView, "dependsOn">): string | null {
  const deps = Array.isArray(task?.dependsOn)
    ? task.dependsOn.filter((d): d is string => typeof d === "string" && d.length > 0)
    : []
  return deps.length > 0 ? deps.join(" → ") : null
}

/**
 * Error summary for the failed sub-goals line: id + best-available label
 * for every task in state "failed", in plan order. null when nothing
 * failed (the panel hides the line entirely — no "0 failed" noise).
 * Defensive: a garbage array yields null rather than a throw.
 */
export interface FailureSummary {
  count: number
  /** `${id} ${label}`-style entries, label falling back to the id. */
  entries: string[]
}

export function failureSummary(subGoals: GoalTaskView[]): FailureSummary | null {
  const rows = Array.isArray(subGoals) ? subGoals : []
  const entries: string[] = []
  for (const task of rows) {
    if (task == null || typeof task !== "object" || task.state !== "failed") continue
    const id = typeof task.id === "string" && task.id.length > 0 ? task.id : "?"
    const label = typeof task.label === "string" && task.label.length > 0 ? task.label : id
    entries.push(`${id} ${label}`)
  }
  return entries.length > 0 ? { count: entries.length, entries } : null
}
