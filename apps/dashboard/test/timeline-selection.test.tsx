// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Live-tail selection pinning tests (hermes assistant-ui thread-list
 * borrowing): dragging a text selection upward auto-scrolls the timeline
 * container, and those scroll events must NOT read as a detach while the
 * selection is in flight inside the container. A collapsed selection (or
 * one anchored outside) detaches exactly as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"

import { selectionPinsTail, ConversationTimeline } from "../src/components/ConversationTimeline"
import type { RuntimeEvent, Workspace } from "../src/api"

applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setLocale("en-US")
})

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

const events: RuntimeEvent[] = [
  ev({ type: "task-start", taskId: "t1", agentRole: "backend" }),
  ev({ type: "tool-start", taskId: "t1", toolName: "bash", input: { command: "ls" } }),
  ev({ type: "tool-end", taskId: "t1", toolName: "bash", ok: true, durationMs: 10 }),
  ev({ type: "task-complete", taskId: "t1" }),
]

/** Not-at-bottom geometry: the condition the old code read as a detach. */
function parkAboveBottom(el: HTMLElement) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: 2000 })
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 500 })
  Object.defineProperty(el, "scrollTop", { configurable: true, value: 600 })
}

/** A Selection stand-in over explicit nodes (jsdom selections are inert). */
const selectionOf = (collapsed: boolean, anchor: Node | null, focus: Node | null): Selection =>
  ({
    anchorNode: anchor,
    anchorOffset: 0,
    focusNode: focus,
    focusOffset: collapsed ? 0 : 3,
  }) as unknown as Selection

describe("selectionPinsTail", () => {
  /** Real DOM nodes so `contains` behaves exactly as in the browser. */
  function fixture() {
    const host = document.createElement("div")
    const inside = document.createElement("span")
    host.appendChild(inside)
    const outside = document.createElement("div")
    document.body.append(host, outside)
    return { host, inside, outside }
  }

  it("yields for a non-collapsed selection inside the container", () => {
    const { host, inside } = fixture()
    expect(selectionPinsTail(selectionOf(false, inside, inside), host)).toBe(true)
    // Depth does not matter — containment is what counts.
    expect(selectionPinsTail(selectionOf(false, host, inside), host)).toBe(true)
  })

  it("stays out of the way for collapsed, outside or missing selections", () => {
    const { host, inside, outside } = fixture()
    expect(selectionPinsTail(selectionOf(true, inside, inside), host)).toBe(false)
    expect(selectionPinsTail(selectionOf(false, outside, inside), host)).toBe(false)
    expect(selectionPinsTail(selectionOf(false, inside, outside), host)).toBe(false)
    expect(selectionPinsTail(null, host)).toBe(false)
    expect(selectionPinsTail(selectionOf(false, inside, inside), null)).toBe(false)
  })
})

describe("ConversationTimeline live-tail selection pinning", () => {
  function mount() {
    render(<ConversationTimeline events={events} workspace={ws()} live />)
    const el = screen.getByTestId("conversation-timeline")
    parkAboveBottom(el)
    // The streaming cursor marks the attached state (live + turns + not detached).
    expect(screen.getByTestId("timeline-streaming-cursor")).toBeInTheDocument()
    return el
  }

  it("does not detach while a text selection is being dragged inside the container", () => {
    const el = mount()
    const inside = el.querySelector("[data-testid='turn-group']")?.firstChild ?? null
    expect(inside).not.toBeNull()
    vi.spyOn(document, "getSelection").mockReturnValue(selectionOf(false, inside, inside))

    fireEvent.scroll(el)
    // The tail yielded: still attached despite being parked above the bottom.
    expect(screen.getByTestId("timeline-streaming-cursor")).toBeInTheDocument()
  })

  it("detaches as before once the selection collapsed", () => {
    const el = mount()
    const inside = el.querySelector("[data-testid='turn-group']")?.firstChild ?? null
    vi.spyOn(document, "getSelection").mockReturnValue(selectionOf(true, inside, inside))

    fireEvent.scroll(el)
    expect(screen.queryByTestId("timeline-streaming-cursor")).not.toBeInTheDocument()
  })

  it("detaches when the selection lives outside the container", () => {
    const el = mount()
    vi.spyOn(document, "getSelection").mockReturnValue(
      selectionOf(false, document.body, document.body),
    )

    fireEvent.scroll(el)
    expect(screen.queryByTestId("timeline-streaming-cursor")).not.toBeInTheDocument()
  })
})
