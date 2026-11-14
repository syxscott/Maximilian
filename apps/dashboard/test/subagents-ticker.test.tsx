// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SubagentsPanel activity-ticker tests: the pure per-run activity
 * derivation, the one-line reel (only the most recent TICKER_DEPTH rows
 * mount, the --ticker-index variable advances with the row count) and the
 * goal line (status glyph + elapsed timer).
 */

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"
import {
  SubagentsPanel,
  ActivityTicker,
  deriveAgentActivity,
  type AgentActivityLine,
} from "../src/components/SubagentsPanel"
import { useSessionProjectionStore } from "../src/stores/sessionProjectionStore"
import type { RuntimeEvent } from "../src/api"

applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

afterEach(() => {
  cleanup()
  useSessionProjectionStore.setState({ events: [] })
})

const evx = (over: Record<string, unknown>): RuntimeEvent =>
  ({ type: "unknown", ...over }) as RuntimeEvent

describe("deriveAgentActivity", () => {
  it("yields the per-run event sequence as one-line labels", () => {
    const events = [
      evx({ type: "task-start", taskId: "t1", ts: 1_000 }),
      evx({ type: "tool-start", taskId: "t1", toolName: "read" }),
      evx({ type: "tool-end", taskId: "t1", toolName: "read", ok: true }),
      evx({ type: "tool-end", taskId: "t1", toolName: "bash", ok: false }),
      evx({ type: "permission-request", taskId: "t1", tool: "edit" }),
      evx({ type: "llm-retry-status", taskId: "t1", phase: "waiting", attempt: 2 }),
      evx({ type: "steering-applied", taskIds: ["t1"] }),
      evx({ type: "tool-end", taskId: "OTHER", toolName: "read" }),
    ]
    const lines = deriveAgentActivity(events, "t1")
    expect(lines.map((l) => l.label)).toEqual([
      "tool · read",
      "tool · read",
      "tool · bash",
      "permission · edit",
      "retry · waiting (attempt 2)",
      "steering-applied",
    ])
    // Outcome flag colors the ✗ mark on the failed tool line only.
    expect(lines[1]?.ok).toBe(true)
    expect(lines[2]?.ok).toBe(false)
    expect(lines.find((l) => l.label.startsWith("tool · bash"))?.ok).toBe(false)
  })
})

describe("ActivityTicker reel", () => {
  const lines: AgentActivityLine[] = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    label: `tool · step-${i}`,
    ok: true,
  }))

  it("mounts only the most recent 6 lines and advances --ticker-index with length", () => {
    const { container, rerender } = render(<ActivityTicker lines={lines} />)
    const window_ = container.querySelector("[data-testid=agent-activity-ticker]") as HTMLElement
    const reel = window_.firstElementChild as HTMLElement
    const rows = window_.querySelectorAll("[data-testid=agent-activity-line]")
    // 8 lines → only the LAST 6 mount.
    expect(rows).toHaveLength(6)
    expect(rows[0]).toHaveTextContent("tool · step-2")
    expect(rows[5]).toHaveTextContent("tool · step-7")
    // The index variable advanced to length-1 (drives the translateY).
    expect(reel.style.getPropertyValue("--ticker-index")).toBe("5")
    expect(reel.style.transform).toContain("translateY")

    // A shorter sequence keeps all rows and tracks its own length.
    rerender(<ActivityTicker lines={lines.slice(0, 3)} />)
    const shortRows = container.querySelectorAll("[data-testid=agent-activity-line]")
    expect(shortRows).toHaveLength(3)
    expect(
      (
        container.querySelector("[data-testid=agent-activity-ticker]")
          ?.firstElementChild as HTMLElement
      ).style.getPropertyValue("--ticker-index"),
    ).toBe("2")
  })

  it("renders nothing without activity", () => {
    const { container } = render(<ActivityTicker lines={[]} />)
    expect(container.querySelector("[data-testid=agent-activity-ticker]")).toBeNull()
  })
})

describe("SubagentsPanel rows", () => {
  it("renders goal + glyph + elapsed timer + reel per run", () => {
    const now = Date.now()
    const events = [
      evx({ type: "task-start", taskId: "t1", agentRole: "backend", ts: now - 30_000 }),
      evx({ type: "tool-end", taskId: "t1", toolName: "read", ok: true, ts: now - 20_000 }),
      evx({ type: "tool-end", taskId: "t1", toolName: "grep", ok: true, ts: now - 10_000 }),
    ]
    render(<SubagentsPanel events={events} />)
    const list = screen.getByTestId("subagents-list")
    expect(list.children).toHaveLength(1)
    expect(screen.getByTestId("agent-state-glyph")).toHaveTextContent("⟳")
    expect(screen.getByText(/backend · t1/)).toBeInTheDocument()
    // Wall-clock span start→last event, humanized.
    expect(screen.getByTestId("agent-elapsed")).toHaveTextContent(/\d+/)
    expect(screen.getAllByTestId("agent-activity-line")).toHaveLength(2)
  })

  it("freezes the timer at the last event for a completed run and shows the ✓ glyph", () => {
    const now = Date.now()
    const events = [
      evx({ type: "task-start", taskId: "t2", agentRole: "review", ts: now - 60_000 }),
      evx({ type: "task-complete", taskId: "t2", ts: now - 10_000 }),
    ]
    render(<SubagentsPanel events={events} />)
    expect(screen.getByTestId("agent-state-glyph")).toHaveTextContent("✓")
    // 50s span → formatDuration's humanized form.
    expect(screen.getByTestId("agent-elapsed")).toHaveTextContent(/50s|0m50|50/)
  })

  it("keeps the store-fed path working (events via sessionProjectionStore)", () => {
    useSessionProjectionStore.setState({
      events: [evx({ type: "task-start", taskId: "t3", agentRole: "general" })],
    })
    render(<SubagentsPanel />)
    expect(screen.getByText(/general · t3/)).toBeInTheDocument()
  })
})
