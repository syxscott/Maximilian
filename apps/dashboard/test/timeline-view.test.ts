// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Timeline view-layer tests over the turn-unit pipeline: the anchors,
 * the turn navigator and the windowing operate on the turn groups the
 * pipeline produces (buildTurnFlowItems → groupUnitsByTurn) — the same
 * shapes ConversationTimeline renders.
 */
import { describe, it, expect } from "vitest"
import { adjacentAnchor, turnAnchors, windowItems } from "../src/lib/timeline-view"
import {
  buildTurnFlowItems,
  groupUnitsByTurn,
  type TurnModel,
} from "../src/components/conversation/model"
import type { RuntimeEvent, Workspace } from "../src/api"

const ev = (over: Record<string, unknown>): RuntimeEvent =>
  ({ type: "unknown", ...over }) as RuntimeEvent

const ws = (over: Partial<Workspace> = {}): Workspace => ({
  id: "w1",
  userRequest: "Build the login page",
  status: "completed",
  results: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
})

/** The fixture the old flat-item tests exercised, compiled by the pipeline:
 * user request → backend task (paired tool call) → failed frontend task →
 * workspace review verdict. */
function fixtureTurns(): TurnModel[] {
  const events: RuntimeEvent[] = [
    ev({ type: "task-start", taskId: "t1", agentRole: "backend" }),
    ev({ type: "tool-start", taskId: "t1", toolName: "edit", input: { file_path: "/login.ts" } }),
    ev({ type: "tool-end", taskId: "t1", toolName: "edit", ok: true, durationMs: 12 }),
    ev({ type: "task-complete", taskId: "t1" }),
    ev({ type: "task-failed", taskId: "t2", agentRole: "frontend", error: "timeout on /cart" }),
  ]
  return groupUnitsByTurn(
    buildTurnFlowItems(events, ws({ status: "completed", review: { score: 8 } as never })),
  )
}

describe("turnAnchors (pipeline turns)", () => {
  it("anchors on task turns only, in display order", () => {
    const turns = fixtureTurns()
    expect(turns.map((t) => t.turnId)).toEqual(["user", "task-t1", "task-t2", "review"])
    expect(turnAnchors(turns)).toEqual([1, 2])
  })

  it("yields no anchors without task turns", () => {
    const turns = groupUnitsByTurn(buildTurnFlowItems([], ws()))
    expect(turns.map((t) => t.turnId)).toEqual(["user"])
    expect(turnAnchors(turns)).toEqual([])
  })
})

describe("adjacentAnchor", () => {
  it("steps both directions and clamps at the ends", () => {
    const anchors = turnAnchors(fixtureTurns())
    expect(adjacentAnchor(anchors, -1, 1)).toBe(1)
    expect(adjacentAnchor(anchors, 1, 1)).toBe(2)
    expect(adjacentAnchor(anchors, 2, 1)).toBe(2)
    expect(adjacentAnchor(anchors, 2, -1)).toBe(1)
  })

  it("snaps to the nearest anchor from an off-anchor position", () => {
    const anchors = [1, 2]
    expect(adjacentAnchor(anchors, 0, 1)).toBe(1)
    expect(adjacentAnchor(anchors, 3, -1)).toBe(2)
    expect(adjacentAnchor([], -1, 1)).toBe(-1)
  })
})

describe("windowItems (turn window)", () => {
  it("keeps the newest N turns and reports the hidden count", () => {
    const many = groupUnitsByTurn(
      buildTurnFlowItems(
        Array.from({ length: 120 }, (_, i) =>
          ev({ type: "task-complete", taskId: `t${i}` }),
        ) as RuntimeEvent[],
        null,
      ),
    )
    expect(many).toHaveLength(120)
    const { window, hiddenAbove } = windowItems(many, 50)
    expect(window).toHaveLength(50)
    expect(hiddenAbove).toBe(70)
    expect(window[0]?.taskId).toBe("t70")
    expect(window.at(-1)?.taskId).toBe("t119")
  })

  it("returns everything when under the window size", () => {
    const turns = fixtureTurns()
    expect(windowItems(turns, 50)).toEqual({ window: turns, hiddenAbove: 0 })
  })
})

describe("pipeline grouping (migrated buildTimelineItems semantics)", () => {
  it("groups paired tool calls under their task and closes the turn", () => {
    const turns = fixtureTurns()
    const t1 = turns.find((t) => t.taskId === "t1")
    expect(t1?.status).toBe("completed")
    const tools = t1?.units.filter((u) => u.kind === "tool") ?? []
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ tool: "edit", state: "ok", durationMs: 12 })
    const t2 = turns.find((t) => t.taskId === "t2")
    expect(t2?.status).toBe("failed")
    expect(t2?.units.find((u) => u.kind === "task-status")).toMatchObject({
      status: "failed",
      error: "timeout on /cart",
    })
  })

  it("appends the review verdict with its score", () => {
    const turns = fixtureTurns()
    expect(turns.at(-1)).toMatchObject({ turnId: "review" })
    expect(turns.at(-1)?.units[0]).toMatchObject({ kind: "review", score: 8 })
  })
})
