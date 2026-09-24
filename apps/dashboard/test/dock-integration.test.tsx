// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workspace dock residency integration tests: the workspace sidebar is a
 * dock-resident panel system —
 *   - every registered workspace panel renders as a stable-id dock leaf
 *     with its translated header and real panel content;
 *   - closing a leaf drives the scoped dock store and persists the layout
 *     document under "maximilian.workspace-dock-layout";
 *   - the add-panel menu lists only closed panels and restores leaves,
 *     including into a fully-emptied dock (dock-empty state);
 *   - persisted documents rehydrate, and hand-edited layouts with
 *     unknown panel ids render without crashing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"
import { flattenPanels, parseDockModel } from "../src/components/layout/dockModel"
import { DOCK_LAYOUT_STORAGE_KEY } from "../src/components/layout/useDockLayout"
import {
  WORKSPACE_DOCK_STORAGE_KEY,
  WORKSPACE_PANELS,
  WorkspaceDockSidebar,
  createWorkspaceDockModel,
  useWorkspaceDockStore,
} from "../src/components/layout/WorkspaceDockSidebar"

// Register the aggregated dashboard dictionaries exactly like main.tsx so
// t() resolves the layout.* keys (setup.ts pins the locale to en-US).
applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

const resetStore = () =>
  useWorkspaceDockStore.setState({
    model: createWorkspaceDockModel(),
    maximizedId: null,
  })

beforeEach(() => {
  for (const key of [WORKSPACE_DOCK_STORAGE_KEY, DOCK_LAYOUT_STORAGE_KEY]) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
  resetStore()
})

afterEach(() => {
  for (const key of [WORKSPACE_DOCK_STORAGE_KEY, DOCK_LAYOUT_STORAGE_KEY]) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
})

const renderSidebar = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceDockSidebar workspace={null} events={[]} />
    </QueryClientProvider>,
  )
}

const dockedIds = () => flattenPanels(useWorkspaceDockStore.getState().model.root).map((l) => l.id)

describe("WorkspaceDockSidebar — dock residency", () => {
  it("renders all seven registered panels as stable-id dock leaves with translated headers", () => {
    renderSidebar()
    const expectedHeaders: Record<string, string> = {
      agent: "Agents",
      tasks: "Tasks",
      subagents: "Subagents",
      trajectory: "Trajectory",
      files: "File changes",
      sessions: "Session history",
      artifacts: "Artifacts",
    }
    for (const panel of WORKSPACE_PANELS) {
      expect(screen.getByTestId(`dock-panel-${panel.id}`)).toBeTruthy()
      expect(screen.getByTestId(`dock-header-${panel.id}`).textContent).toBe(
        expectedHeaders[panel.id],
      )
    }
    // The registry drives the default layout: all seven are resident.
    expect(dockedIds()).toEqual(WORKSPACE_PANELS.map((p) => p.id))
  })

  it("leaf bodies wrap the real panels unmodified", () => {
    renderSidebar()
    // Empty-workspace states of the wrapped components, inside their leaf.
    const agentLeaf = screen.getByTestId("dock-panel-agent")
    expect(agentLeaf.querySelector(".agent-panel")?.textContent).toContain(
      "No agents yet. Send a request to spawn them.",
    )
    expect(screen.getByTestId("dock-panel-tasks").querySelector(".task-panel")).toBeTruthy()
    expect(screen.getByTestId("dock-panel-subagents").textContent).toContain(
      "No subagent activity yet",
    )
  })

  it("closing a leaf removes it and persists the layout document", () => {
    renderSidebar()
    fireEvent.click(screen.getByTestId("dock-close-tasks"))
    expect(screen.queryByTestId("dock-panel-tasks")).toBeNull()
    expect(dockedIds()).not.toContain("tasks")
    expect(dockedIds()).toHaveLength(WORKSPACE_PANELS.length - 1)
    const raw = localStorage.getItem(WORKSPACE_DOCK_STORAGE_KEY)
    expect(raw).toBeTruthy()
    const persisted = flattenPanels(parseDockModel(JSON.parse(raw as string)).root).map((l) => l.id)
    expect(persisted).not.toContain("tasks")
    expect(persisted).toHaveLength(WORKSPACE_PANELS.length - 1)
  })

  it("the add-panel menu lists only closed panels and restores the picked leaf", () => {
    renderSidebar()
    fireEvent.click(screen.getByTestId("dock-close-files"))
    fireEvent.click(screen.getByTestId("workspace-dock-add-toggle"))
    expect(screen.getByTestId("workspace-dock-add-menu")).toBeTruthy()
    // "files" is closed → listed; still-docked panels are not.
    expect(screen.getByTestId("workspace-dock-add-files")).toBeTruthy()
    expect(screen.queryByTestId("workspace-dock-add-agent")).toBeNull()
    fireEvent.click(screen.getByTestId("workspace-dock-add-files"))
    expect(screen.getByTestId("dock-panel-files")).toBeTruthy()
    // Reopening splits beside the focused leaf, so only compare the set.
    expect([...dockedIds()].sort()).toEqual(WORKSPACE_PANELS.map((p) => p.id).sort())
  })

  it("the menu reports when every panel is already docked", () => {
    renderSidebar()
    fireEvent.click(screen.getByTestId("workspace-dock-add-toggle"))
    expect(screen.getByTestId("workspace-dock-add-menu").textContent).toContain(
      "All panels are open",
    )
    expect(screen.queryByRole("menuitem")).toBeNull()
  })

  it("closing every leaf shows the dock empty state; panels restore into the emptied dock", () => {
    renderSidebar()
    for (const panel of WORKSPACE_PANELS) {
      fireEvent.click(screen.getByTestId(`dock-close-${panel.id}`))
    }
    expect(useWorkspaceDockStore.getState().model.root).toBeNull()
    expect(screen.getByTestId("dock-empty")).toBeTruthy()
    // Recovery path: reopen one registered panel into the empty dock.
    fireEvent.click(screen.getByTestId("workspace-dock-add-toggle"))
    fireEvent.click(screen.getByTestId("workspace-dock-add-tasks"))
    expect(screen.getByTestId("dock-panel-tasks")).toBeTruthy()
    expect(useWorkspaceDockStore.getState().model.root?.kind).toBe("leaf")
    expect(dockedIds()).toEqual(["tasks"])
  })

  it("the persisted layout rehydrates across a reload", () => {
    const { unmount } = renderSidebar()
    fireEvent.click(screen.getByTestId("dock-close-trajectory"))
    fireEvent.click(screen.getByTestId("dock-close-sessions"))
    unmount()

    // Simulate a fresh boot: the store initializes from the document.
    const raw = localStorage.getItem(WORKSPACE_DOCK_STORAGE_KEY) as string
    act(() => {
      useWorkspaceDockStore.setState({
        model: parseDockModel(JSON.parse(raw)),
        maximizedId: null,
      })
    })
    renderSidebar()
    expect(screen.queryByTestId("dock-panel-trajectory")).toBeNull()
    expect(screen.queryByTestId("dock-panel-sessions")).toBeNull()
    expect(screen.getByTestId("dock-panel-agent")).toBeTruthy()
    expect(screen.getByTestId("dock-panel-artifacts")).toBeTruthy()
  })

  it("a hand-edited layout with an unknown panel id renders without crashing", () => {
    localStorage.setItem(
      WORKSPACE_DOCK_STORAGE_KEY,
      JSON.stringify({ v: 1, activeId: "ghost", root: { kind: "leaf", id: "ghost" } }),
    )
    act(() => {
      useWorkspaceDockStore.setState({
        model: parseDockModel(JSON.parse(localStorage.getItem(WORKSPACE_DOCK_STORAGE_KEY)!)),
        maximizedId: null,
      })
    })
    renderSidebar()
    // Unknown ids still dock (renderPanel → empty body) and fall back to
    // the raw id as the header title instead of throwing.
    expect(screen.getByTestId("dock-panel-ghost")).toBeTruthy()
    expect(screen.getByTestId("dock-header-ghost").textContent).toBe("ghost")
  })
})
