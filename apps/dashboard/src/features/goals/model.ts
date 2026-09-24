// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the goals feature domain (deepseek ui-goal
 * borrowing, honest-data edition): there is NO independent goals backend
 * — every "goal" the UI shows is derived from real workspace objects.
 *
 *   primary goal  ← the user request, completed per workspace.status
 *                   (completed → 100%, failed → failure ratio of the
 *                   plan's tasks, running → finished tasks / total)
 *   sub-goals     ← plan.tasks (label = description, state, role,
 *                   optional dependsOn chain → indent depth)
 *   milestones    ← plan existence / task execution / review score
 *
 * `deriveGoals` reports which sources actually contributed
 * (`sources`), and `GoalProgress.basis` says how the headline percent
 * was computed, so the UI can disclose the derivation instead of
 * pretending to track a separate goal store. No ETA is ever invented —
 * "remaining" is plain arithmetic (total − completed).
 *
 * Input is a passthrough Workspace-shaped payload (fields may be
 * missing or garbage); everything here is defensive and unit-testable.
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
 * Indent depth from the dependsOn chain: a task sits one level deeper
 * than its deepest dependency. Unknown dependency ids are ignored;
 * cycles are cut (depth 0 at the revisit).
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
 * Derive the whole goal view from a workspace payload. Never throws;
 * a null/garbage workspace yields an honest empty view (0%, no
 * sub-goals, no milestones, sources: []).
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

/**
 * Deterministic color for a role dot: stable hash → hue. Pure so tests
 * can pin the exact value; the component just paints it.
 */
export function roleColor(role: string): string {
  let hash = 0
  for (let i = 0; i < role.length; i++) {
    hash = (hash * 31 + role.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 70% 45%)`
}

// ── Evolution视角: role performance (GET /evolution/leaderboard) ───────────
//
// The goals panel cross-references the plan's agent roles with the
// evolution engine's real per-role metrics. Every input here is a
// passthrough payload — the leaderboard entries carry BOTH spellings in
// the wild (`role`/`agentRole`, `runs`/`sampleSize`,
// `acceptance`/`userSatisfaction`), so the model normalizes defensively
// and never invents a metric it did not receive.

/** One matched role-performance row — null metric = not reported. */
export interface RolePerformanceEntry {
  role: string
  runs: number | null
  avgScore: number | null
  /** Acceptance as a percent (0–100). Fraction inputs (0–1) are scaled. */
  acceptance: number | null
}

/** Fractional acceptance (0..1) is scaled to a percent; percents pass through. */
export function normalizeAcceptance(value: number): number {
  if (value >= 0 && value <= 1) return clampPercent(value * 100)
  return clampPercent(value)
}

function leaderboardRole(entry: Record<string, unknown>): string {
  return str(entry.role) || str(entry.agentRole)
}

/** Defensive entry → matched row (null = role missing / entry garbage). */
function toPerformanceEntry(input: unknown): RolePerformanceEntry | null {
  if (input == null || typeof input !== "object") return null
  const entry = input as Record<string, unknown>
  const role = leaderboardRole(entry)
  if (!role) return null
  const runs = finiteNumber(entry.runs ?? entry.sampleSize)
  const avgScore = finiteNumber(entry.avgScore)
  const acceptance = finiteNumber(entry.acceptance ?? entry.userSatisfaction)
  return {
    role,
    runs,
    avgScore,
    acceptance: acceptance === null ? null : normalizeAcceptance(acceptance),
  }
}

/**
 * Leaderboard entries whose role matches one of the workspace's plan
 * roles, in plan-role order (so the section mirrors the goal tree
 * above it). First entry wins per role — the overall leaderboard is
 * already aggregated. Garbage entries and unmatched roles are skipped;
 * a role without an entry simply does not appear (no fabrication).
 */
export function matchRoleEntries(entries: unknown, roles: unknown): RolePerformanceEntry[] {
  const roleList = Array.isArray(roles)
    ? roles.filter((r): r is string => typeof r === "string" && r.length > 0)
    : []
  if (roleList.length === 0 || !Array.isArray(entries)) return []

  const wanted = new Set(roleList)
  const byRole = new Map<string, RolePerformanceEntry>()
  for (const raw of entries) {
    const entry = toPerformanceEntry(raw)
    if (!entry || !wanted.has(entry.role) || byRole.has(entry.role)) continue
    byRole.set(entry.role, entry)
  }
  return roleList.flatMap((role) => {
    const entry = byRole.get(role)
    return entry ? [entry] : []
  })
}

// ── Evolution视角: lazy role detail (agents/{role} + versions decisions) ───

/**
 * Per-role evolution detail, loaded only when the user expands a role:
 * the profile carries the promoted version chain, the decision log one
 * entry per evolution attempt (promoted OR discarded; the seeded "v1"
 * snapshot is not a decision).
 */
export interface RoleEvolutionDetail {
  currentVersion: string | null
  /** Length of the profile's promoted version chain (null = unknown). */
  versionCount: number | null
  /** Decision-log entries beyond the seed version (null = unknown). */
  decisionCount: number | null
  totalTasks: number | null
}

/** The seed snapshot is the initial prompt, not an evolution decision. */
const SEED_VERSION_ID = "v1"

/**
 * Parse the lazy role-detail pair (agent profile + decision log). Never
 * throws; missing pieces surface as null so the UI can render honest
 * dashes instead of pretending.
 */
export function parseRoleDetail(profile: unknown, decisionLog: unknown): RoleEvolutionDetail {
  const p =
    profile != null && typeof profile === "object" ? (profile as Record<string, unknown>) : {}

  // The decision log arrives either raw (array) or wrapped as the route's
  // `{ role, decisions }` body; anything else = unavailable (null).
  const decisions = Array.isArray(decisionLog)
    ? decisionLog
    : decisionLog != null &&
        typeof decisionLog === "object" &&
        Array.isArray((decisionLog as Record<string, unknown>).decisions)
      ? ((decisionLog as Record<string, unknown>).decisions as unknown[])
      : null

  const currentVersion = str(p.currentVersion) || null
  const versionCount = Array.isArray(p.versions) ? p.versions.length : null
  const decisionCount = decisions
    ? decisions.filter(
        (d) =>
          d != null &&
          typeof d === "object" &&
          typeof (d as Record<string, unknown>).id === "string" &&
          (d as Record<string, unknown>).id !== SEED_VERSION_ID,
      ).length
    : null

  return {
    currentVersion,
    versionCount,
    decisionCount,
    totalTasks: finiteNumber(p.totalTasks),
  }
}
