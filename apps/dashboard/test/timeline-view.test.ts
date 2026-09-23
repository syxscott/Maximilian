// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

import { describe, it, expect } from "vitest"
import {
  filterByQuery,
  matchIndices,
  windowItems,
  turnAnchors,
  adjacentAnchor,
  toShareMarkdown,
} from "../src/lib/timeline-view"
import type { TimelineItem } from "../src/components/ConversationTimeline"

const item = (over: Partial<TimelineItem>): TimelineItem => ({
  kind: "task",
  key: Math.random().toString(36).slice(2),
  title: "task",
  toolCalls: [],
  ...over,
})

const FIXTURE: TimelineItem[] = [
  item({ kind: "user", key: "u", title: "Build the login page" }),
  item({
    key: "t1",
    taskId: "t1",
    agentRole: "backend",
    toolCalls: [{ tool: "edit", input: { file_path: "/login.ts" } }],
  }),
  item({
    key: "t2",
    taskId: "t2",
    agentRole: "frontend",
    status: "failed",
    error: "timeout on /cart",
  }),
  item({ kind: "review", key: "r", title: "review", score: 8 }),
]

describe("filterByQuery / matchIndices", () => {
  it("matches across title, error, role and tool payloads", () => {
    expect(filterByQuery(FIXTURE, "login").map((i) => i.key)).toEqual(["u", "t1"])
    expect(filterByQuery(FIXTURE, "timeout").map((i) => i.key)).toEqual(["t2"])
    expect(filterByQuery(FIXTURE, "backend").map((i) => i.key)).toEqual(["t1"])
    expect(filterByQuery(FIXTURE, "")).toHaveLength(4)
    expect(matchIndices(FIXTURE, "login")).toEqual([0, 1])
  })
})

describe("windowItems", () => {
  it("keeps the newest N and reports the hidden count", () => {
    const many = Array.from({ length: 120 }, (_, i) => item({ key: `k${i}` }))
    const { window, hiddenAbove } = windowItems(many, 50)
    expect(window).toHaveLength(50)
    expect(hiddenAbove).toBe(70)
    expect(window[0]?.key).toBe("k70")
    expect(window.at(-1)?.key).toBe("k119")
  })
  it("returns everything when under the window size", () => {
    expect(windowItems(FIXTURE, 50)).toEqual({ window: FIXTURE, hiddenAbove: 0 })
  })
})

describe("turnAnchors / adjacentAnchor", () => {
  it("anchors on task items only and steps both directions", () => {
    const anchors = turnAnchors(FIXTURE)
    expect(anchors).toEqual([1, 2])
    expect(adjacentAnchor(anchors, -1, 1)).toBe(1)
    expect(adjacentAnchor(anchors, 1, 1)).toBe(2)
    expect(adjacentAnchor(anchors, 2, 1)).toBe(2)
    expect(adjacentAnchor(anchors, 2, -1)).toBe(1)
  })
})

describe("toShareMarkdown", () => {
  it("exports a readable markdown document", () => {
    const md = toShareMarkdown(FIXTURE, "login revamp")
    expect(md).toContain("# Maximilian run — login revamp")
    expect(md).toContain("## Request")
    expect(md).toContain("### backend · t1")
    expect(md).toContain("- `edit`")
    expect(md).toContain("> failed: timeout")
    expect(md).toContain("## Review — score 8")
  })
})
