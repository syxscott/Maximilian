// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * WorkspaceDockArea — the workspace tab's main layout, dock-driven with a
 * single sidebar mechanism: the shell dock (DockContainer over the
 * persisted "maximilian.dock-layout" tree) owns the main area, with the
 * conversation (ChatPanel: submit / stop / mention / drafts) as the
 * RESIDENT "chat" leaf — no close affordance, and ensureResidentLeaf
 * re-inserts it when a stale persisted document lost it — plus the live
 * timeline as the second default leaf. The workspace panel stack
 * (WorkspaceDockSidebar: the registry-driven dock leaves + add-panel
 * menu) is no longer a sibling column of its own — it rides INTO the
 * conversation as ChatPanel's collapsible drawer, so there is exactly
 * one sidebar surface: ChatPanel renders it when `showSidebar`
 * (registry content present AND sidebarHidden off), the close button and
 * the Ctrl+Shift+B keybind flip the same workspace-prefs bit through the
 * existing keyboard layer, and this module only feeds the drawer its
 * registry-driven content.
 *
 * What deliberately did NOT move: the dock tree itself. The shell dock
 * keeps its chat/timeline two-leaf structure (the timeline stays an
 * independent leaf, the chat leaf stays locked), and the sidebar's own
 * dock store keeps its persisted tree + add-panel menu — only the
 * container around it changed shape (column → drawer).
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
import { useWorkspacePrefsStore } from "@/stores/workspacePrefsStore"

/** The shell dock's second default leaf: the live conversation timeline. */
export const WORKSPACE_TIMELINE_PANEL_ID = "timeline"

/**
 * Prefs key App uses before a workspace is open — mirror of App.tsx's
 * private SHELL_PREFS_KEY so the drawer toggle writes the record the
 * keyboard layer reads (keep the two literals in lock-step).
 */
const APP_SHELL_PREFS_KEY = "__app__"

export interface WorkspaceDockAreaProps {
  workspace: Workspace | null
  events: RuntimeEvent[]
  /** true while a run is in flight (timeline auto-tail). */
  live: boolean
  submitting: boolean
  onSubmit: (message: string) => void
  onNavigate: (
    tab:
      "workspace" | "executions" | "governance" | "evolution" | "providers" | "usage" | "settings",
  ) => void
  /** Open a session-search hit's workspace (session-query leaf). */
  onOpenSession?: (sessionId: string) => void
  onAbort?: () => void
  mentionSuggestions?: MentionSuggestion[]
  onOpenProviders?: () => void
  onOpenPalette?: () => void
  /** Hide the sidebar drawer (workspace pref / keyboard toggle). */
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
  onNavigate,
  onOpenSession,
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

  // The drawer's close button performs the SAME workspace-prefs write the
  // App keyboard layer's Ctrl+Shift+B handler performs (keyed by the
  // active workspace, or the app shell before one is open) — one source
  // of truth, and App's `sidebarHidden` prop follows on the next render.
  const workspaceId = workspace?.id
  const toggleSidebar = useCallback(() => {
    const key = workspaceId ?? APP_SHELL_PREFS_KEY
    const current = useWorkspacePrefsStore.getState().prefs[key]?.sidebarHidden ?? false
    useWorkspacePrefsStore.getState().updatePrefs(key, { sidebarHidden: !current })
  }, [workspaceId])

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
          onNavigate={onNavigate}
          events={events}
          live={live}
          showHeading={false}
          // The workspace panel stack (registry-driven dock leaves) is the
          // drawer content — ChatPanel mounts it over the conversation and
          // owns the open/close affordances (close button + sidebarHidden).
          sidebar={
            <WorkspaceDockSidebar
              onOpenSession={onOpenSession}
              workspace={workspace}
              events={events}
              parkedTaskIds={parkedTaskIds}
            />
          }
          sidebarHidden={sidebarHidden}
          onToggleSidebar={toggleSidebar}
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

  // Single surface: the shell dock hosting the conversation grid — the
  // sidebar lives inside the chat leaf's drawer now, so there is no
  // trailing column to gate on sidebarHidden here anymore.
  return (
    <div className="flex h-full min-h-0 w-full p-4">
      <div className="min-h-0 min-w-0 flex-1">
        <DockContainer
          lockedPanelIds={lockedPanels}
          transformModel={ensureChat}
          renderPanel={renderPanel}
        />
      </div>
    </div>
  )
}
