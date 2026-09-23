// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import {
  WorkspaceTabStrip,
  __removeTabForTest as removeTab,
} from "../src/components/WorkspaceTabStrip"

describe("removeTab", () => {
  it("keeps the active tab unreachable-free: closing active picks a neighbor", () => {
    const { ids, pickNext } = removeTab(["a", "b", "c"], "b", "b")
    expect(ids).toEqual(["a", "c"])
    expect(pickNext).toBe("c") // right neighbor inherits the active slot
  })
  it("closing an inactive tab leaves the active one alone", () => {
    const { ids, pickNext } = removeTab(["a", "b"], "a", "b")
    expect(ids).toEqual(["a"])
    expect(pickNext).toBeUndefined()
  })
})

describe("WorkspaceTabStrip", () => {
  it("renders tabs with the active highlight and fires onPick", () => {
    const onPick = vi.fn()
    render(<WorkspaceTabStrip workspaces={["ws-1", "ws-2"]} activeId="ws-2" onPick={onPick} />)
    fireEvent.click(screen.getByTestId("workspace-tab-ws-1"))
    expect(onPick).toHaveBeenCalledWith("ws-1")
    expect(screen.getByTestId("workspace-tab-ws-2").getAttribute("aria-current")).toBe("true")
  })

  it("caps visible tabs and counts the overflow", () => {
    const many = Array.from({ length: 9 }, (_, i) => `ws-${i}`)
    render(<WorkspaceTabStrip workspaces={many} activeId="ws-0" onPick={() => {}} />)
    expect(screen.getByText(/\+3 more/)).toBeTruthy()
  })
})
