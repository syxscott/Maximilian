// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * WorkspaceDockArea — the workspace tab's main layout, now fully
 * dock-driven: the shell dock (DockContainer over the persisted
 * "maximilian.dock-layout" tree) owns the main area, with the
 * conversation (ChatPanel: submit / stop / mention / drafts) as the
 * RESIDENT "chat" leaf — no close affordance, and ensureResidentLeaf
 * re-inserts it when a stale persisted document lost it — plus the live
 * timeline as the second default leaf. The seven-panel workspace
 * sidebar stays an independent dock container (its own storage key,
 * store and add-panel menu) in the trailing column, hidden by the
 * workspace sidebarHidden pref / keyboard toggle.
 *
 * Composition trade-off (two docks instead of one tree): merging the
 * sidebar into the shell tree would mean migrating two persisted
 * documents into one, re-home its registry-aware add-panel menu onto a
 * subtree, and route the sidebarHidden toggle through tree surgery —
 * while the engine's scoped-store design already supports independent
 * docks side by side. Two containers keep every existing behavior
 * (persistence keys, empty-dock recovery, toggling) intact.
 */
import { useCallback, useMemo } from "react"
import type { RuntimeEvent, Workspace } from "@/api"
import type { MentionSuggestion } from "@/hooks/useMention"
import { ChatPanel } from "@/components/ChatPanel"
import { ConversationTimeline } from "@/components/ConversationTimeline"
import {
  type DockModel,
  DOCK_MAIN_PANEL_ID,
  ensureResidentLeaf,
} from "@/components/layout/dockModel"
import { DockContainer } from "@/components/layout/DockContainer"
import { WorkspaceDockSidebar } from "@/components/layout/WorkspaceDockSidebar"

/** The shell dock's second default leaf: the live conversation timeline. */
export const WORKSPACE_TIMELINE_PANEL_ID = "timeline"

export interface WorkspaceDockAreaProps {
  workspace: Workspace | null
  events: RuntimeEvent[]
  /** true while a run is in flight (timeline auto-tail). */
  live: boolean
  submitting: boolean
  onSubmit: (message: string) => void
  onAbort?: () => void
  mentionSuggestions?: MentionSuggestion[]
  onOpenProviders?: () => void
  onOpenPalette?: () => void
  /** Hide the sidebar column (workspace pref / keyboard toggle). */
  sidebarHidden?: boolean
  /** Task ids parked on a permission/approval gate (AgentPanel dots). */
  parkedTaskIds?: ReadonlySet<string>
}

export function WorkspaceDockArea({
  workspace,
  events,
  live,
  submitting,
  onSubmit,
  onAbort,
  mentionSuggestions,
  onOpenProviders,
  onOpenPalette,
  sidebarHidden = false,
  parkedTaskIds,
}: WorkspaceDockAreaProps) {
  // The conversation cannot be closed — the leaf is resident.
  const lockedPanels = useMemo(() => new Set([DOCK_MAIN_PANEL_ID]), [])
  // Repair stale documents at render time: whatever the persisted tree
  // looks like, the conversation leaf is always present (pure transform,
  // the store state itself is untouched).
  const ensureChat = useCallback((model: DockModel) => ensureResidentLeaf(model), [])

  const renderPanel = (panelId: string) => {
    if (panelId === DOCK_MAIN_PANEL_ID) {
      return (
        <ChatPanel
          onSubmit={onSubmit}
          onAbort={onAbort}
          submitting={submitting}
          workspace={workspace}
          mentionSuggestions={mentionSuggestions}
          onOpenProviders={onOpenProviders}
          onOpenPalette={onOpenPalette}
          events={events}
          live={live}
          showHeading={false}
        />
      )
    }
    if (panelId === WORKSPACE_TIMELINE_PANEL_ID) {
      // Exact same props the conversation column passes its embedded
      // timeline — one turn-unit pipeline, two views of it.
      return <ConversationTimeline events={events} workspace={workspace} live={live} />
    }
    return null
  }

  return (
    <div className="flex h-full min-h-0 w-full gap-4 p-4">
      {/* Main area = the shell dock hosting the conversation grid. */}
      <div className="min-h-0 min-w-0 flex-1">
        <DockContainer
          lockedPanelIds={lockedPanels}
          transformModel={ensureChat}
          renderPanel={renderPanel}
        />
      </div>

      {/* The sidebar dock keeps its independent persisted tree. */}
      {!sidebarHidden && (
        <aside
          data-testid="workspace-sidebar-aside"
          className="w-[280px] shrink-0 overflow-y-auto rounded-md border border-border bg-card/40 p-3 xl:w-[360px]"
        >
          <WorkspaceDockSidebar
            workspace={workspace}
            events={events}
            parkedTaskIds={parkedTaskIds}
          />
        </aside>
      )}
    </div>
  )
}
