// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * WorkspaceDockSidebar — the workspace tab's right-hand sidebar as a
 * dock-resident panel system. Each workspace panel (agents, tasks,
 * subagents, trajectory, file changes, sessions, artifacts) is a
 * stable-id leaf of a DockContainer; the tree is persisted under its
 * own storage key through the dock layout engine, so arrangements and
 * closures survive reloads. A small "add panel" menu at the top lists
 * every registered panel that is not currently docked and reopens its
 * leaf on pick. The panels themselves are untouched — this module only
 * wraps them.
 */
import { useMemo, useState } from "react"
import { ListPlus } from "lucide-react"
import { t, useLocale } from "@max/i18n"
import type { RuntimeEvent, Workspace } from "@/api"
import {
  type DockModel,
  createStackedDockModel,
  flattenPanels,
} from "@/components/layout/dockModel"
import { createDockLayoutStore } from "@/components/layout/useDockLayout"
import { DockContainer } from "@/components/layout/DockContainer"
import { AgentPanel } from "@/components/AgentPanel"
import { TaskPanel } from "@/components/TaskPanel"
import { SubagentsPanel } from "@/components/SubagentsPanel"
import { TrajectoryPanel } from "@/features/trajectory"
import { FileChangesPanel } from "@/components/FileChangesPanel"
import { SessionsPanel } from "@/components/SessionsPanel"
import { ArtifactsExplorer } from "@/components/ArtifactsExplorer"
import { ReviewPanel } from "@/components/ReviewPanel"
import { OutputPanel } from "@/components/OutputPanel"

export interface WorkspacePanelSpec {
  /** Stable dock leaf id (persisted in the layout document). */
  id: string
  /** Existing i18n title key — reused verbatim in the leaf header. */
  titleKey: string
}

/** The resident panel registry — one dock leaf per entry, ids stable. */
export const WORKSPACE_PANELS: readonly WorkspacePanelSpec[] = [
  { id: "agent", titleKey: "agent.title" },
  { id: "tasks", titleKey: "task.title" },
  { id: "subagents", titleKey: "subagents.title" },
  { id: "trajectory", titleKey: "trajectory.title" },
  { id: "files", titleKey: "files.title" },
  { id: "sessions", titleKey: "sessions.title" },
  { id: "artifacts", titleKey: "artifacts.title" },
]

/** Storage key for the workspace sidebar's dock layout. */
export const WORKSPACE_DOCK_STORAGE_KEY = "maximilian.workspace-dock-layout"

/** Sidebar default: every registered panel, stacked top → bottom. */
export function createWorkspaceDockModel(): DockModel {
  return createStackedDockModel(WORKSPACE_PANELS)
}

/** The workspace sidebar's dock store (separate tree + key from the shell dock). */
export const useWorkspaceDockStore = createDockLayoutStore({
  storageKey: WORKSPACE_DOCK_STORAGE_KEY,
  createDefault: createWorkspaceDockModel,
})

export interface WorkspaceDockSidebarProps {
  workspace: Workspace | null
  events: RuntimeEvent[]
  /** Task ids parked on a permission/approval gate (AgentPanel dots). */
  parkedTaskIds?: ReadonlySet<string>
}

export function WorkspaceDockSidebar({
  workspace,
  events,
  parkedTaskIds,
}: WorkspaceDockSidebarProps) {
  useLocale() // re-render on locale switches (leaf headers + menu)
  const model = useWorkspaceDockStore((s) => s.model)
  const openPanel = useWorkspaceDockStore((s) => s.openPanel)
  const [menuOpen, setMenuOpen] = useState(false)
  const closedPanels = useMemo(() => {
    const docked = new Set(flattenPanels(model.root).map((l) => l.id))
    return WORKSPACE_PANELS.filter((p) => !docked.has(p.id))
  }, [model])

  // Dock leaf id → panel element. Purely a mapping: the components are
  // the exact ones the inline sidebar used to render, unmodified.
  const renderPanel = (id: string) => {
    switch (id) {
      case "agent":
        return <AgentPanel workspace={workspace} parkedTaskIds={parkedTaskIds} />
      case "tasks":
        return <TaskPanel workspace={workspace} />
      case "subagents":
        return <SubagentsPanel />
      case "trajectory":
        return <TrajectoryPanel />
      case "files":
        return <FileChangesPanel events={events} />
      case "sessions":
        return <SessionsPanel workspaceId={workspace?.id} />
      case "artifacts":
        return <ArtifactsExplorer workspaceId={workspace?.id} />
      default:
        return null
    }
  }

  return (
    <div data-testid="workspace-dock-sidebar" className="flex h-full min-h-0 flex-col gap-2">
      {/* Add-panel menu (top of the sidebar): lists every registered panel
          that is not currently docked; picking one reopens its leaf. */}
      <div className="relative flex shrink-0 items-center justify-end">
        <button
          type="button"
          data-testid="workspace-dock-add-toggle"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <ListPlus className="h-3.5 w-3.5" />
          {t("layout.addPanel")}
        </button>
        {menuOpen && (
          <div
            role="menu"
            data-testid="workspace-dock-add-menu"
            className="absolute right-0 top-full z-20 mt-1 min-w-40 rounded-md border border-border bg-popover p-1 text-xs shadow-md"
          >
            {closedPanels.length === 0 ? (
              <span className="block px-2 py-1 text-muted-foreground">
                {t("layout.addPanelMenu.allDocked")}
              </span>
            ) : (
              closedPanels.map((panel) => (
                <button
                  key={panel.id}
                  type="button"
                  role="menuitem"
                  data-testid={`workspace-dock-add-${panel.id}`}
                  className="block w-full rounded px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    openPanel(panel.id)
                    setMenuOpen(false)
                  }}
                >
                  {t(panel.titleKey)}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* The resident leaves — DockContainer renders the persisted tree. */}
      <div className="min-h-0 flex-1">
        <DockContainer store={useWorkspaceDockStore} renderPanel={renderPanel} />
      </div>

      {/* The workspace's final review / live output summary keeps its
          always-visible slot below the dock — dock residency covers the
          seven registry panels; this conditional pair stays a plain strip. */}
      <div className="max-h-64 shrink-0 overflow-y-auto">
        {workspace?.review ? (
          <ReviewPanel workspace={workspace} />
        ) : (
          <OutputPanel workspace={workspace} />
        )}
      </div>
    </div>
  )
}
