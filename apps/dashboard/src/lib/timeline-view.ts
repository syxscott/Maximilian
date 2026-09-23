// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Timeline view layer (ZCode v4 borrowing: conversationFindIndex,
 * turn navigator, conversationShareMarkdown). Pure functions over the
 * timeline items produced by ConversationTimeline's buildTimelineItems.
 */

import type { TimelineItem } from "@/components/ConversationTimeline"

/** Items matching a case-insensitive query across title/detail/errors. */
export function filterByQuery(items: TimelineItem[], query: string): TimelineItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true
    if (item.error?.toLowerCase().includes(q)) return true
    if (item.agentRole?.toLowerCase().includes(q)) return true
    return item.toolCalls?.some(
      (call) =>
        call.tool.toLowerCase().includes(q) ||
        JSON.stringify(call.input ?? "")
          .toLowerCase()
          .includes(q),
    )
  })
}

/** Indices of matching items — the turn navigator's stop list. */
export function matchIndices(items: TimelineItem[], query: string): number[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: number[] = []
  items.forEach((item, i) => {
    if (filterByQuery([item], q).length > 0) out.push(i)
  })
  return out
}

/**
 * Windowing: render at most the newest `visibleCount` items; older ones
 * are materialized by the "load earlier" affordance. Returns the window
 * plus how many items are hidden above it.
 */
export function windowItems(
  items: TimelineItem[],
  visibleCount: number,
): { window: TimelineItem[]; hiddenAbove: number } {
  if (items.length <= visibleCount) return { window: items, hiddenAbove: 0 }
  return {
    window: items.slice(items.length - visibleCount),
    hiddenAbove: items.length - visibleCount,
  }
}

/** The task-id groups in stream order (turn navigator's anchors). */
export function turnAnchors(items: TimelineItem[]): number[] {
  return items.map((item, i) => (item.kind === "task" ? i : -1)).filter((i) => i >= 0)
}

/** Next/previous turn anchor index from a current index (-1 = none yet). */
export function adjacentAnchor(anchors: number[], current: number, direction: 1 | -1): number {
  if (anchors.length === 0) return -1
  if (current === -1) return direction === 1 ? anchors[0]! : anchors[anchors.length - 1]!
  const position = anchors.indexOf(current)
  if (position === -1) {
    const later = anchors.find((a) => a > current)
    return direction === 1
      ? (later ?? anchors[anchors.length - 1]!)
      : (anchors.filter((a) => a < current).at(-1) ?? anchors[0]!)
  }
  const next = position + direction
  if (next < 0 || next >= anchors.length) return current
  return anchors[next]!
}

/** Flatten one item to markdown lines (share export). */
function itemToMarkdown(item: TimelineItem): string[] {
  const lines: string[] = []
  switch (item.kind) {
    case "user":
      lines.push("## Request", "", item.title, "")
      break
    case "task": {
      lines.push(`### ${item.agentRole ?? "agent"} · ${item.taskId ?? ""}`, "")
      for (const call of item.toolCalls ?? []) {
        const suffix = call.ok === false ? " — failed" : ""
        lines.push(`- \`${call.tool}\`${suffix}`)
      }
      if (item.status === "failed" && item.error) lines.push("", `> failed: ${item.error}`)
      if (item.status === "skipped" && item.error) lines.push("", `> skipped: ${item.error}`)
      lines.push("")
      break
    }
    case "review":
      lines.push(`## Review — score ${item.score ?? "—"}`, "")
      break
    case "failed":
      lines.push("## Workspace failed", "", "```", item.title, "```", "")
      break
    default:
      break
  }
  return lines
}

/** Export the whole timeline as a shareable markdown document. */
export function toShareMarkdown(items: TimelineItem[], workspaceTitle?: string | null): string {
  const header = [
    `# Maximilian run${workspaceTitle ? ` — ${workspaceTitle}` : ""}`,
    "",
    `_${items.length} timeline entries_`,
    "",
  ]
  return [...header, ...items.flatMap(itemToMarkdown)].join("\n")
}
