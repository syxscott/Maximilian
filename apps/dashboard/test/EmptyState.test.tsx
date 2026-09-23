// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Render test for the onboarding empty state (ZCode ChatEmptyState
 * borrowing) and a smoke test for the three live-agent panels.
 */
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { EmptyState } from "../src/components/EmptyState"
import { SubagentsPanel } from "../src/components/SubagentsPanel"
import { TrajectoryPanel } from "../src/components/TrajectoryPanel"
import { FileChangesPanel } from "../src/components/FileChangesPanel"
import type { RuntimeEvent } from "../src/api"

// i18n provider is implicit (@max/i18n t() falls back to the key's locale
// default in tests — matching the existing panel tests' setup).
const ev = (over: Record<string, unknown>): RuntimeEvent =>
  ({ workspaceId: "ws1", ...over }) as RuntimeEvent

describe("EmptyState", () => {
  it("renders the three onboarding steps and fires the shortcuts", () => {
    const onProviders = vi.fn()
    const onPalette = vi.fn()
    render(<EmptyState onOpenProviders={onProviders} onOpenPalette={onPalette} />)
    expect(screen.getByTestId("onboarding-empty-state")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /configure providers/i }))
    expect(onProviders).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: /open command palette/i }))
    expect(onPalette).toHaveBeenCalledTimes(1)
  })
})

describe("SubagentsPanel", () => {
  it("renders one row per derived agent run with state badges", () => {
    const events = [
      ev({ type: "task-start", taskId: "t1", agentRole: "backend" }),
      ev({ type: "task-failed", taskId: "t2" }),
    ]
    render(<SubagentsPanel events={events} />)
    expect(screen.getByTestId("subagents-list").children.length).toBe(2)
  })

  it("shows the empty hint when there is no activity", () => {
    render(<SubagentsPanel events={[]} />)
    expect(screen.queryByTestId("subagents-list")).toBeNull()
  })
})

describe("TrajectoryPanel", () => {
  it("renders trajectory entries and supports the task filter", () => {
    const events = [
      ev({ type: "task-start", taskId: "t1", agentRole: "backend" }),
      ev({ type: "tool-end", taskId: "t1", toolName: "edit", ok: true, durationMs: 9 }),
      ev({ type: "task-start", taskId: "t2", agentRole: "frontend" }),
    ]
    render(<TrajectoryPanel events={events} taskIds={["t1", "t2"]} />)
    const list = screen.getByTestId("trajectory-list")
    expect(list.children.length).toBe(3)
    fireEvent.change(screen.getByLabelText(/filter by task/i), { target: { value: "t1" } })
    expect(screen.getByTestId("trajectory-list").children.length).toBe(2)
  })
})

describe("FileChangesPanel", () => {
  it("lists edit/write calls and expands a diff on click", () => {
    const events = [
      ev({
        type: "tool-start",
        taskId: "t1",
        toolName: "edit",
        input: { file_path: "/src/a.ts", oldString: "const a = 1", newString: "const a = 2" },
      }),
      ev({ type: "tool-start", taskId: "t1", toolName: "read", input: { file_path: "/b" } }),
    ]
    render(<FileChangesPanel events={events} />)
    const list = screen.getByTestId("file-changes-list")
    expect(list.children.length).toBe(1) // read is not a file change
    fireEvent.click(list.children[0]!)
    // The DiffPreview for the edit is now expanded inside the item.
    expect(list.textContent).toContain("a.ts")
  })
})
