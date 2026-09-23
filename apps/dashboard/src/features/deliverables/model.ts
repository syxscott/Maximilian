// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the deliverables feature domain (deepseek
 * ui-deliverables borrowing: final task outputs are first-class,
 * listable, and exportable — never buried in chat prose). Input is a
 * Workspace-shaped payload (passthrough JSON in practice; fields may be
 * missing) → typed view models out. Everything here is unit-testable and
 * free of network / DOM dependencies except the clipboard guard.
 */

/** Collapsed rows preview this many lines before the "expand" toggle. */
export const DELIVERABLE_PREVIEW_LINES = 12

export interface DeliverableView {
  taskId: string
  agentRole: string
  output: string
  metadata: Record<string, unknown> | null
}

export interface RoleGroup {
  role: string
  items: DeliverableView[]
}

export interface DeliverableStats {
  /** Non-empty outputs, i.e. what the panel lists. */
  total: number
  /** Distinct tasks contributing a deliverable. */
  tasks: number
  /** Distinct agent roles. */
  roles: number
  /** Total output size in characters (for the header summary). */
  chars: number
}

export interface ReviewSummaryView {
  score: number | null
  issues: number
  suggestions: number
  summary: string
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/** Defensive workspace → deliverable rows. Blank outputs are dropped. */
export function toDeliverableViews(workspace: unknown): DeliverableView[] {
  if (workspace == null || typeof workspace !== "object") return []
  const results = (workspace as { results?: unknown }).results
  if (!Array.isArray(results)) return []
  const views: DeliverableView[] = []
  for (const item of results) {
    if (item == null || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    // A deliverable IS its output: rows without one are not deliverables.
    if (!hasText(row.output)) continue
    views.push({
      taskId: str(row.taskId),
      agentRole: str(row.agentRole, "unknown"),
      output: row.output,
      metadata:
        row.metadata != null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null,
    })
  }
  return views
}

/** Group rows by agent role, preserving first-seen role order. */
export function groupByRole(views: DeliverableView[]): RoleGroup[] {
  const groups = new Map<string, DeliverableView[]>()
  for (const view of views) {
    const bucket = groups.get(view.agentRole)
    if (bucket) bucket.push(view)
    else groups.set(view.agentRole, [view])
  }
  return [...groups.entries()].map(([role, items]) => ({ role, items }))
}

/** Header summary counts. */
export function deliverableStats(views: DeliverableView[]): DeliverableStats {
  return {
    total: views.length,
    tasks: new Set(views.map((v) => v.taskId).filter((id) => id.length > 0)).size,
    roles: new Set(views.map((v) => v.agentRole)).size,
    chars: views.reduce((sum, v) => sum + v.output.length, 0),
  }
}

export interface PreviewedOutput {
  text: string
  hidden: number
}

/** Head-truncate output to `max` lines for the collapsed view. */
export function previewLines(
  output: string,
  max: number = DELIVERABLE_PREVIEW_LINES,
): PreviewedOutput {
  const lines = output.split("\n")
  if (lines.length <= max) return { text: output, hidden: 0 }
  return { text: lines.slice(0, max).join("\n"), hidden: lines.length - max }
}

/** Defensive workspace.review → summary view. Null when no review. */
export function reviewSummary(workspace: unknown): ReviewSummaryView | null {
  if (workspace == null || typeof workspace !== "object") return null
  const review = (workspace as { review?: unknown }).review
  if (review == null || typeof review !== "object") return null
  const row = review as Record<string, unknown>
  return {
    score: typeof row.score === "number" && Number.isFinite(row.score) ? row.score : null,
    issues: Array.isArray(row.issues) ? row.issues.length : 0,
    suggestions: Array.isArray(row.suggestions) ? row.suggestions.length : 0,
    summary: str(row.summary),
  }
}

// ── Markdown export (pure, clipboard-free) ──────────────────────────────────

function fence(output: string): string {
  // A fence inside the output must not break the block — use the longest
  // run of backticks found plus one.
  const runs = output.match(/`+/g) ?? []
  let longest = 0
  for (const run of runs) longest = Math.max(longest, run.length)
  const fenceToken = "`".repeat(Math.max(3, longest + 1))
  return `${fenceToken}\n${output}\n${fenceToken}`
}

/**
 * Render the whole deliverable set as one Markdown document: a header
 * with the originating request, per-role sections with per-task fenced
 * outputs, and the review verdict when one exists. Pure — the component
 * only hands the result to the clipboard.
 */
export function toDeliverablesMarkdown(workspace: unknown): string {
  const views = toDeliverableViews(workspace)
  const record =
    workspace != null && typeof workspace === "object" ? (workspace as Record<string, unknown>) : {}
  const parts: string[] = []

  const request = hasText(record.userRequest) ? record.userRequest : null
  parts.push("# Deliverables")
  parts.push("")
  if (request) {
    parts.push(`> ${request.replace(/\n/g, "\n> ")}`)
    parts.push("")
  }
  if (views.length > 0) {
    parts.push(statsLine(views))
    parts.push("")
  }

  for (const group of groupByRole(views)) {
    parts.push(`## ${group.role}`)
    parts.push("")
    for (const item of group.items) {
      const label = item.taskId || "task"
      parts.push(`### ${label}`)
      parts.push("")
      parts.push(fence(item.output))
      parts.push("")
    }
  }

  const review = reviewSummary(workspace)
  if (review) {
    parts.push("## Review")
    parts.push("")
    const scoreLine = review.score !== null ? `Score: ${review.score}` : null
    const countsLine = `Issues: ${review.issues} · Suggestions: ${review.suggestions}`
    parts.push(scoreLine ? `${scoreLine} — ${countsLine}` : countsLine)
    if (review.summary) {
      parts.push("")
      parts.push(review.summary)
    }
    parts.push("")
  }

  return parts.join("\n").trimEnd() + "\n"
}

/** One-line stats summary used under the markdown header. */
function statsLine(views: DeliverableView[]): string {
  const stats = deliverableStats(views)
  return `_${stats.total} deliverable(s) across ${stats.roles} role(s), ${stats.tasks} task(s)._`
}

// ── Clipboard (isolated so components stay testable) ────────────────────────

/** Structural clipboard shape — loose so garbage runtimes degrade cleanly. */
export interface ClipboardLike {
  clipboard?: { writeText?: unknown } | null
}

/** Clipboard availability — the export button degrades to a manual hint. */
export function canUseClipboard(nav: ClipboardLike | undefined = navigator): boolean {
  return nav != null && nav.clipboard != null && typeof nav.clipboard.writeText === "function"
}

/** Clipboard write — isolated in the model layer; callers handle refusal. */
export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}
