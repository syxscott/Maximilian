// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Render-stability tests (OpenHands messages.tsx borrowing): a streaming
 * append re-renders ONLY the turn it touched — every historical TurnGroup
 * skips through the content comparator, even though the pipeline re-issues
 * every unit object per frame. The spy wraps the REAL memoized component
 * THROUGH its real comparator (turnGroupPropsEqual), so the counts measure
 * actual renders, not a re-implementation.
 */
import { memo } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"

vi.mock("../src/components/conversation/TurnGroup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/components/conversation/TurnGroup")>()
  const counts = new Map<string, number>()
  const SpiedTurnGroup = memo((props: actual.TurnGroupProps) => {
    counts.set(props.turn.turnId, (counts.get(props.turn.turnId) ?? 0) + 1)
    return <actual.TurnGroup {...props} />
  }, actual.turnGroupPropsEqual)
  return {
    ...actual,
    TurnGroup: SpiedTurnGroup,
    __turnRenderCounts: counts,
  }
})

import { ConversationTimeline } from "../src/components/ConversationTimeline"
import * as turnGroupModule from "../src/components/conversation/TurnGroup"
import type { RuntimeEvent, Workspace } from "../src/api"

applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

/** The spied module's render counter (one map per file, reset per test). */
const renderCounts = (turnGroupModule as unknown as { __turnRenderCounts: Map<string, number> })
  .__turnRenderCounts

beforeEach(() => {
  renderCounts.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setLocale("en-US")
})

const ev = (over: Record<string, unknown>): RuntimeEvent =>
  ({ type: "unknown", ...over }) as RuntimeEvent

const baseEvents = (): RuntimeEvent[] => [
  ev({ type: "task-start", taskId: "t1", agentRole: "backend" }),
  ev({ type: "tool-start", taskId: "t1", toolName: "bash", input: { command: "ls" } }),
  ev({ type: "tool-end", taskId: "t1", toolName: "bash", ok: true, durationMs: 10 }),
  ev({ type: "task-complete", taskId: "t1" }),
  ev({ type: "task-start", taskId: "t2", agentRole: "frontend" }),
]

const streamChunk = (i: number): RuntimeEvent =>
  ev({ type: "assistant-text", text: `streaming chunk ${i}`, taskId: "t2" })

/**
 * The APPEND shape the real streaming feed produces: the array grows,
 * existing event objects keep their identity (passthrough inputs derive
 * from them, so the compile's unit inputs stay reference-stable).
 */
const eventsWithChunks = (chunks: number): RuntimeEvent[] => {
  const events = baseEvents()
  for (let i = 0; i < chunks; i++) events.push(streamChunk(i))
  return events
}

const countOf = (turnId: string): number => renderCounts.get(turnId) ?? 0

describe("TurnGroup render stability under streaming appends", () => {
  it("an append to the tail turn re-renders that turn alone", () => {
    const one = eventsWithChunks(1)
    const { rerender } = render(<ConversationTimeline events={one} workspace={null} live={false} />)
    expect(countOf("task-t1")).toBe(1)
    expect(countOf("task-t2")).toBe(1)

    // One more streaming chunk APPENDS (same array discipline as the
    // feed): the pipeline recompiles the whole stream (fresh TurnModel/
    // unit objects), yet t1's RENDER COUNT does not move — the comparator
    // sees identical content.
    const two = [...one, streamChunk(1)]
    rerender(<ConversationTimeline events={two} workspace={null} live={false} />)
    expect(countOf("task-t1")).toBe(1)
    expect(countOf("task-t2")).toBe(2)

    // And the next chunk: still only the touched turn.
    const three = [...two, streamChunk(2)]
    rerender(<ConversationTimeline events={three} workspace={null} live={false} />)
    expect(countOf("task-t1")).toBe(1)
    expect(countOf("task-t2")).toBe(3)
  })

  it("a rerender with NO event change renders nothing again", () => {
    const events = eventsWithChunks(2)
    const { rerender } = render(
      <ConversationTimeline events={events} workspace={null} live={false} />,
    )
    const afterMount = new Map(renderCounts)
    rerender(<ConversationTimeline events={events} workspace={null} live={false} />)
    expect(new Map(renderCounts)).toEqual(afterMount)
  })

  it("a HISTORY turn whose content changes still re-renders (comparator honesty)", () => {
    const events = (): RuntimeEvent[] => [
      ev({ type: "task-start", taskId: "t1" }),
      ev({ type: "tool-start", taskId: "t1", toolName: "bash", input: { command: "sleep" } }),
      ev({ type: "task-start", taskId: "t2" }),
    ]
    const { rerender } = render(
      <ConversationTimeline events={events()} workspace={null} live={false} />,
    )
    expect(countOf("task-t1")).toBe(1)
    // The tool-end pairs INSIDE the history turn t1 — real content change,
    // the comparator must let it through (a frozen spinner would lie).
    rerender(
      <ConversationTimeline
        events={[
          ...events(),
          ev({ type: "tool-end", taskId: "t1", toolName: "bash", ok: true, durationMs: 8 }),
        ]}
        workspace={null}
        live={false}
      />,
    )
    expect(countOf("task-t1")).toBe(2)
  })

  it("the user-request turn never re-renders while the stream grows", () => {
    const { rerender } = render(
      <ConversationTimeline
        events={eventsWithChunks(1)}
        workspace={
          {
            id: "w1",
            userRequest: "Build the login page",
            status: "running",
            results: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          } as Workspace
        }
        live={false}
      />,
    )
    expect(countOf("user")).toBe(1)
    rerender(
      <ConversationTimeline
        events={eventsWithChunks(2)}
        workspace={
          {
            id: "w1",
            userRequest: "Build the login page",
            status: "running",
            results: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          } as Workspace
        }
        live={false}
      />,
    )
    expect(countOf("user")).toBe(1)
  })
})
