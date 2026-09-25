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
 *     unknown panel ids render without crashing;
 *   - the panel registry maps one-to-one onto the feature-domain
 *     registry (workspacePanelDomains).
 *
 * The workspace MAIN area is dock-hosted too (WorkspaceDockArea): the
 * conversation is the shell dock's resident "chat" leaf — locked (no
 * close affordance), re-inserted when a stale document lost it, and kept
 * by the persisted document across reloads; the panel sidebar stays an
 * independent dock in the trailing column, and "Reset layout"
 * restores both trees.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"
import {
  DOCK_MAIN_PANEL_ID,
  createDefaultDockModel,
  flattenPanels,
  parseDockModel,
} from "../src/components/layout/dockModel"
import { DOCK_LAYOUT_STORAGE_KEY, useDockLayoutStore } from "../src/components/layout/useDockLayout"
import {
  WORKSPACE_DOCK_STORAGE_KEY,
  WORKSPACE_PANELS,
  WorkspaceDockSidebar,
  createWorkspaceDockModel,
  useWorkspaceDockStore,
  workspacePanelDomains,
} from "../src/components/layout/WorkspaceDockSidebar"
import { WorkspaceDockArea } from "../src/components/layout/WorkspaceDockArea"
import { FEATURE_DOMAINS } from "../src/features"

// Register the aggregated dashboard dictionaries exactly like main.tsx so
// t() resolves the layout.* keys (setup.ts pins the locale to en-US).
applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

const resetStore = () =>
  useWorkspaceDockStore.setState({
    model: createWorkspaceDockModel(),
    maximizedId: null,
  })

const resetShellStore = () =>
  useDockLayoutStore.setState({
    model: createDefaultDockModel(),
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
  resetShellStore()
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
  it("renders all registered panels as stable-id dock leaves with translated headers", () => {
    renderSidebar()
    const expectedHeaders: Record<string, string> = {
      agent: "Agents",
      tasks: "Tasks",
      subagents: "Subagents",
      trajectory: "Trajectory",
      files: "File changes",
      sessions: "Session history",
      artifacts: "Artifacts",
      goals: "Goal Progress",
      deliverables: "Deliverables",
      search: "Session search",
    }
    for (const panel of WORKSPACE_PANELS) {
      expect(screen.getByTestId(`dock-panel-${panel.id}`)).toBeTruthy()
      expect(screen.getByTestId(`dock-header-${panel.id}`).textContent).toBe(
        expectedHeaders[panel.id],
      )
    }
    // The registry drives the default layout: every panel is resident.
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
    // Goals leaf: the derived goal tree + summary card, honest empty state.
    const goalsLeaf = screen.getByTestId("dock-panel-goals")
    expect(goalsLeaf.querySelector("[data-testid='goal-tree']")).toBeTruthy()
    expect(goalsLeaf.querySelector("[data-testid='goal-summary-card']")).toBeTruthy()
    expect(goalsLeaf.textContent).toContain("No goal data yet (waiting for a workspace)")
    // Deliverables leaf: the real panel body, empty without a workspace id.
    const deliverablesLeaf = screen.getByTestId("dock-panel-deliverables")
    expect(deliverablesLeaf.querySelector("[data-testid='deliverables-panel']")).toBeTruthy()
    expect(deliverablesLeaf.querySelector("[data-testid='deliverables-empty']")).toBeTruthy()
    // Search leaf: the real SessionSearchPanel body in its idle state —
    // no query, so no export button and no per-hit open buttons (the
    // onOpenSession chain is not wired at this mount).
    const searchLeaf = screen.getByTestId("dock-panel-search")
    expect(searchLeaf.querySelector("[data-testid='session-search-panel']")).toBeTruthy()
    expect(searchLeaf.querySelector("[data-testid='session-search-idle']")?.textContent).toContain(
      "Type to search",
    )
    expect(screen.queryByTestId("session-search-export-json")).toBeNull()
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

  it("the goals and deliverables leaves persist closure and restore from the add-panel menu", () => {
    renderSidebar()
    fireEvent.click(screen.getByTestId("dock-close-goals"))
    fireEvent.click(screen.getByTestId("dock-close-deliverables"))
    expect(screen.queryByTestId("dock-panel-goals")).toBeNull()
    expect(screen.queryByTestId("dock-panel-deliverables")).toBeNull()
    // The closures survive in the persisted layout document.
    const persisted = flattenPanels(
      parseDockModel(JSON.parse(localStorage.getItem(WORKSPACE_DOCK_STORAGE_KEY) as string)).root,
    ).map((l) => l.id)
    expect(persisted).not.toContain("goals")
    expect(persisted).not.toContain("deliverables")
    // The registry-driven menu offers exactly the closed leaves back.
    fireEvent.click(screen.getByTestId("workspace-dock-add-toggle"))
    expect(screen.getByTestId("workspace-dock-add-goals")).toBeTruthy()
    expect(screen.getByTestId("workspace-dock-add-deliverables")).toBeTruthy()
    // Picking closes the menu, so reopen it for the second restore.
    fireEvent.click(screen.getByTestId("workspace-dock-add-goals"))
    fireEvent.click(screen.getByTestId("workspace-dock-add-toggle"))
    fireEvent.click(screen.getByTestId("workspace-dock-add-deliverables"))
    expect(screen.getByTestId("dock-panel-goals")).toBeTruthy()
    expect(screen.getByTestId("dock-panel-deliverables")).toBeTruthy()
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

// ── workspacePanelDomains — WORKSPACE_PANELS ↔ FEATURE_DOMAINS mapping ──────

describe("workspacePanelDomains — panel registry ↔ feature-domain registry", () => {
  it("maps the registry onto feature domains one-to-one, no third list", () => {
    const mapped = workspacePanelDomains().filter((m) => m.domainId !== null)
    const domainIds = mapped.map((m) => m.domainId as string)
    // One-to-one: every panel resolves to exactly one domain and no two
    // panels share one — the projection is injective.
    expect(new Set(domainIds).size).toBe(domainIds.length)
    expect(mapped).toHaveLength(domainIds.length)
    // Every resolved id is a real FEATURE_DOMAINS entry.
    const known = new Set(FEATURE_DOMAINS.map((d) => d.id))
    for (const id of domainIds) expect(known.has(id)).toBe(true)
  })

  it("resolves the shared-id overlap plus the agent→chat and search aliases", () => {
    const byId = new Map(workspacePanelDomains().map((m) => [m.panelId, m]))
    for (const id of [
      "subagents",
      "trajectory",
      "files",
      "sessions",
      "artifacts",
      "deliverables",
    ]) {
      expect(byId.get(id)?.domainId).toBe(id)
    }
    expect(byId.get("agent")?.domainId).toBe("chat")
    // The search leaf answers to the session-query domain's registry row.
    expect(byId.get("search")?.domainId).toBe("session-query")
    expect(byId.get("search")?.titleKey).toBe("sessionQuery.title")
  })

  it("same-id overlaps agree with the domain's titleKey", () => {
    for (const mapping of workspacePanelDomains()) {
      if (mapping.domainId === null || mapping.domainId !== mapping.panelId) continue
      const domain = FEATURE_DOMAINS.find((d) => d.id === mapping.domainId)
      expect(domain?.titleKey).toBe(mapping.titleKey)
    }
  })

  it("every registry panel maps onto FEATURE_DOMAINS — the gap is closed", () => {
    const unmapped = workspacePanelDomains()
      .filter((m) => m.domainId === null)
      .map((m) => m.panelId)
    // "tasks" and "goals" predated the domain registry; the gap was
    // pinned here until the unification grew FEATURE_DOMAINS — this
    // assertion flipped (registry-unification.test.ts now asserts the
    // panel↔domain mapping is complete).
    expect(unmapped).toEqual([])
  })
})

// ── WorkspaceDockArea — the shell dock hosts the main conversation grid ─────

const renderArea = (props?: Partial<Parameters<typeof WorkspaceDockArea>[0]>) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceDockArea
        workspace={null}
        events={[]}
        live={false}
        submitting={false}
        onSubmit={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  )
}

const shellIds = () => flattenPanels(useDockLayoutStore.getState().model.root).map((l) => l.id)

describe("WorkspaceDockArea — dock engine hosts the main conversation grid", () => {
  it("renders the conversation as the resident locked chat leaf (no close affordance)", () => {
    renderArea()
    // The chat leaf docks with its translated header and the real
    // conversation column inside (composer textarea present).
    expect(screen.getByTestId("dock-panel-chat")).toBeTruthy()
    expect(screen.getByTestId("dock-header-chat").textContent).toBe("Conversation")
    expect(screen.getByPlaceholderText(/enter your request/i)).toBeTruthy()
    // Locked: the close affordance is gone, maximize still offered.
    expect(screen.queryByTestId("dock-close-chat")).toBeNull()
    expect(screen.getByTestId("dock-maximize-chat")).toBeTruthy()
    // The default second leaf (timeline) docks beside it.
    expect(screen.getByTestId("dock-panel-timeline")).toBeTruthy()
    expect(DOCK_MAIN_PANEL_ID).toBe("chat")
  })

  it("re-inserts the resident leaf when a stale persisted document lacks it (pure transform)", () => {
    localStorage.setItem(
      DOCK_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        activeId: null,
        root: { kind: "leaf", id: "timeline", titleKey: "layout.panel.timeline" },
      }),
    )
    act(() => {
      useDockLayoutStore.setState({
        model: parseDockModel(JSON.parse(localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY)!)),
        maximizedId: null,
      })
    })
    renderArea()
    // Render-time ensureResidentLeaf: the conversation is back, in front.
    expect(screen.getByTestId("dock-panel-chat")).toBeTruthy()
    expect(screen.getByTestId("dock-panel-timeline")).toBeTruthy()
    // The transform is pure — the store document stays untouched.
    expect(shellIds()).toEqual(["timeline"])
  })

  it("closing the timeline leaf persists the shell layout and keeps the chat across a reload", () => {
    const { unmount } = renderArea()
    fireEvent.click(screen.getByTestId("dock-close-timeline"))
    expect(shellIds()).toEqual(["chat"])
    // The persisted document keeps the resident main leaf.
    const persisted = flattenPanels(
      parseDockModel(JSON.parse(localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY) as string)).root,
    ).map((l) => l.id)
    expect(persisted).toEqual(["chat"])
    unmount()

    // Simulated reload: the conversation survives, the closed leaf is gone.
    act(() => {
      useDockLayoutStore.setState({
        model: parseDockModel(JSON.parse(localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY)!)),
        maximizedId: null,
      })
    })
    renderArea()
    expect(screen.getByTestId("dock-panel-chat")).toBeTruthy()
    expect(screen.queryByTestId("dock-panel-timeline")).toBeNull()
  })

  it("Reset layout restores the default conversation grid and the full sidebar dock", () => {
    renderArea()
    // Scatter both trees first: close the timeline leaf + two sidebar leaves.
    fireEvent.click(screen.getByTestId("dock-close-timeline"))
    fireEvent.click(screen.getByTestId("dock-close-files"))
    fireEvent.click(screen.getByTestId("dock-close-trajectory"))
    expect(shellIds()).toEqual(["chat"])
    expect(dockedIds()).toHaveLength(WORKSPACE_PANELS.length - 2)

    fireEvent.click(screen.getByTestId("workspace-dock-reset-layout"))
    // Shell dock: default 2-pane grid; sidebar dock: all seven panels.
    expect(shellIds()).toEqual(["chat", "timeline"])
    expect(dockedIds()).toEqual(WORKSPACE_PANELS.map((p) => p.id))
    // Both reset trees are mirrored to their storage documents.
    expect(
      flattenPanels(
        parseDockModel(JSON.parse(localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY)!)).root,
      ).map((l) => l.id),
    ).toEqual(["chat", "timeline"])
    expect(
      flattenPanels(
        parseDockModel(JSON.parse(localStorage.getItem(WORKSPACE_DOCK_STORAGE_KEY)!)).root,
      ).map((l) => l.id),
    ).toEqual(WORKSPACE_PANELS.map((p) => p.id))
    // The restored chat leaf is locked again.
    expect(screen.queryByTestId("dock-close-chat")).toBeNull()
  })

  it("the sidebar column toggles off without touching either dock tree", () => {
    const view = renderArea()
    expect(screen.getByTestId("workspace-sidebar-aside")).toBeTruthy()
    expect(screen.getByTestId("workspace-dock-add-toggle")).toBeTruthy()

    // The sidebarHidden pref path (pref store / keyboard toggle) hides the
    // column; the shell dock keeps the resident conversation + timeline.
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceDockArea
          workspace={null}
          events={[]}
          live={false}
          submitting={false}
          onSubmit={() => {}}
          sidebarHidden
        />
      </QueryClientProvider>,
    )
    expect(screen.queryByTestId("workspace-sidebar-aside")).toBeNull()
    expect(screen.queryByTestId("workspace-dock-add-toggle")).toBeNull()
    expect(screen.getByTestId("dock-panel-chat")).toBeTruthy()
    expect(screen.getByTestId("dock-panel-timeline")).toBeTruthy()
  })
})
