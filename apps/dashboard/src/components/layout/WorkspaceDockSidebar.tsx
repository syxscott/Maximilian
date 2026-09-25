// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * WorkspaceDockSidebar — the workspace tab's right-hand sidebar as a
 * dock-resident panel system. Each workspace panel (agents, tasks,
 * subagents, trajectory, file changes, sessions, artifacts, goals,
 * deliverables, search) is a stable-id leaf of a DockContainer; the
 * tree is persisted under its own storage key through the dock layout
 * engine, so arrangements and closures survive reloads. A small "add
 * panel" menu at the top lists every registered panel that is not
 * currently docked — grouped by the feature registry's sections — and
 * reopens its leaf on pick; the menu is driven purely by the registry,
 * so registering a leaf in WORKSPACE_PANELS is the whole mount. The
 * panel list itself and its FEATURE_DOMAINS projection live in
 * src/features (the single registry — see workspacePanelDomains there);
 * this module owns only the panel→component wiring and the dock store.
 *
 * Two content-density layers ride on the pure model in panelModel.ts:
 *   - conditional leaves: the review / output summaries are registry
 *     leaves too — panelsForWorkspace adds them only while the
 *     workspace carries the content to back them (review result /
 *     output or failed status) and withConditionalPanels keeps them
 *     docked view-time (stale ones pruned), replacing the old
 *     always-on strip below the dock;
 *   - header badges: badgesForPanel decides per leaf whether its header
 *     shows the unread / parked-permission dot (files leaf unread since
 *     the caller's seen watermark; agent leaf while permission prompts
 *     await a decision).
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { ListPlus, RotateCcw } from "lucide-react"
import { t, useLocale } from "@max/i18n"
import type { RuntimeEvent, Workspace } from "@/api"
import {
  type DockModel,
  createStackedDockModel,
  flattenPanels,
} from "@/components/layout/dockModel"
import {
  CONDITIONAL_PANEL_IDS,
  badgesForPanel,
  fileChangeCount,
  groupPanelsForMenu,
  panelsForWorkspace,
  withConditionalPanels,
} from "@/components/layout/panelModel"
import { createDockLayoutStore, useDockLayoutStore } from "@/components/layout/useDockLayout"
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
import { GoalSummaryCard, GoalTree } from "@/features/goals"
import { DeliverablesPanel } from "@/features/deliverables"
import { SessionSearchPanel } from "@/features/session-query"
import { WORKSPACE_PANELS } from "@/features"

/**
 * The panel registry and its FEATURE_DOMAINS projection moved to
 * src/features/index.ts (registry unification) — re-exported here so
 * consumers of the sidebar module keep their import paths.
 */
export { WORKSPACE_PANELS, WORKSPACE_PANEL_DOMAIN_ALIASES, workspacePanelDomains } from "@/features"
export type { WorkspacePanelSpec, WorkspacePanelDomain } from "@/features"

/** Storage key for the workspace sidebar's dock layout. */
export const WORKSPACE_DOCK_STORAGE_KEY = "maximilian.workspace-dock-layout"

/** A panel's description key is its title key with the `.title` suffix swapped. */
function descriptionKeyFor(titleKey: string): string {
  return `${titleKey.replace(/\.title$/, "")}.description`
}

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
  /**
   * Optional cross-workspace session opener for the search leaf's hits —
   * wiring it up needs the App-level pickWorkspace chain; while it is
   * absent the panel hides its per-hit "open in session" buttons.
   */
  onOpenSession?: (sessionId: string) => void
}

export function WorkspaceDockSidebar({
  workspace,
  events,
  parkedTaskIds,
  onOpenSession,
}: WorkspaceDockSidebarProps) {
  useLocale() // re-render on locale switches (leaf headers + menu)
  const model = useWorkspaceDockStore((s) => s.model)
  const openPanel = useWorkspaceDockStore((s) => s.openPanel)
  const resetWorkspaceDock = useWorkspaceDockStore((s) => s.resetLayout)
  const [menuOpen, setMenuOpen] = useState(false)

  // Workspace-conditioned registry: the base panels plus the review /
  // output leaves only while the workspace carries their content.
  const registry = useMemo(() => panelsForWorkspace(workspace, WORKSPACE_PANELS), [workspace])

  // View-time residency for the conditional leaves: content arrives → the
  // leaf docks (bottom, fair share); content goes away → the leaf is
  // pruned. Pure transform — the persisted store tree stays untouched,
  // and closure is intentionally not offered for content-backed leaves
  // (the tri-state hidden strip is the "get out of my face" affordance).
  const ensureConditionals = useCallback(
    (current: DockModel) => withConditionalPanels(current, registry),
    [registry],
  )
  const conditionalIds = useMemo(
    () => new Set(registry.filter((p) => CONDITIONAL_PANEL_IDS.includes(p.id)).map((p) => p.id)),
    [registry],
  )

  // Header badges: the pure policy from the event stream, softened by the
  // caller's seen watermark — focusing the files leaf acknowledges its
  // current change count so the dot clears until fresh edits arrive.
  const [seenFileChanges, setSeenFileChanges] = useState(0)
  const activeId = model.activeId
  useEffect(() => {
    if (activeId === "files") setSeenFileChanges(fileChangeCount(events))
  }, [activeId, events])
  const badgeFor = useCallback(
    (panelId: string) => badgesForPanel(panelId, events, { seenCount: seenFileChanges }),
    [events, seenFileChanges],
  )

  const closedPanels = useMemo(() => {
    const docked = new Set(flattenPanels(model.root).map((l) => l.id))
    return registry.filter((p) => !docked.has(p.id))
  }, [model, registry])

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
      case "goals":
        return (
          <div className="space-y-2">
            <GoalTree workspace={workspace} />
            <GoalSummaryCard workspace={workspace} />
          </div>
        )
      case "deliverables":
        return <DeliverablesPanel workspaceId={workspace?.id} />
      case "search":
        return <SessionSearchPanel workspaceId={workspace?.id} onOpenSession={onOpenSession} />
      case "review":
        return <ReviewPanel workspace={workspace} />
      case "output":
        return <OutputPanel workspace={workspace} />
      default:
        return null
    }
  }

  return (
    <div data-testid="workspace-dock-sidebar" className="flex h-full min-h-0 flex-col gap-2">
      {/* Add-panel menu (top of the sidebar): lists every registered panel
          that is not currently docked, grouped by the feature registry's
          sections; picking one reopens its leaf. Next to it, "Reset
          layout" restores both persisted trees — the registry panels here
          and the shell dock's default conversation grid (chat | timeline)
          — and mirrors the reset to storage. */}
      <div className="relative flex shrink-0 items-center justify-end gap-2">
        <button
          type="button"
          data-testid="workspace-dock-reset-layout"
          aria-label={t("layout.resetLayout")}
          title={t("layout.resetLayout")}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            useDockLayoutStore.getState().resetLayout()
            resetWorkspaceDock()
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("layout.resetLayout")}
        </button>
        <button
          type="button"
          data-testid="workspace-dock-add-toggle"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={t("layout.addPanelMenu.hint")}
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
              groupPanelsForMenu(closedPanels).map((group) => (
                <div
                  key={group.section}
                  role="group"
                  aria-label={t(group.titleKey)}
                  data-testid={`workspace-dock-add-group-${group.section}`}
                >
                  <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    {t(group.titleKey)}
                  </div>
                  {group.panels.map((panel) => (
                    <button
                      key={panel.id}
                      type="button"
                      role="menuitem"
                      data-testid={`workspace-dock-add-${panel.id}`}
                      title={t(descriptionKeyFor(panel.titleKey), t(panel.titleKey))}
                      className="block w-full rounded px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        openPanel(panel.id)
                        setMenuOpen(false)
                      }}
                    >
                      {t(panel.titleKey)}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* The resident leaves — DockContainer renders the persisted tree,
          view-time-repaired to carry the conditional review/output leaves
          exactly while their content exists. */}
      <div className="min-h-0 flex-1">
        <DockContainer
          store={useWorkspaceDockStore}
          renderPanel={renderPanel}
          transformModel={ensureConditionals}
          lockedPanelIds={conditionalIds}
          badgeFor={badgeFor}
        />
      </div>
    </div>
  )
}
