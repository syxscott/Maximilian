// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * WorkspaceTabStrip — the multi-workspace tab system (ZCode
 * titlebar-tab-strip borrowing, minimal form): horizontal tabs for the
 * recent workspaces with active highlight, per-tab close (local hide —
 * the workspace itself stays on the server) and an overflow counter.
 * Closed-tab state lives in workspacePrefsStore (persisted per workspace
 * as `tabClosed`), so a closed tab stays closed across reloads. Pure
 * model helpers live here too (tested): tab list maintenance and
 * overflow slicing.
 */

import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import { useWorkspacePrefsStore } from "@/stores/workspacePrefsStore"

export const MAX_VISIBLE_TABS = 6

/** Remove a tab while never dropping the active one. */
export function removeTab(
  ids: string[],
  activeId: string | undefined,
  closed: string,
): { ids: string[]; pickNext?: string } {
  const next = ids.filter((id) => id !== closed)
  if (closed === activeId) {
    const index = ids.indexOf(closed)
    const fallback = next[Math.min(index, next.length - 1)]
    return { ids: next, pickNext: fallback }
  }
  return { ids: next }
}

export function WorkspaceTabStrip({
  workspaces,
  activeId,
  onPick,
}: {
  workspaces: string[]
  activeId?: string
  onPick: (id: string) => void
}) {
  useLocale()
  // Closed tabs are persisted in the workspace-prefs store (one boolean
  // per workspace) instead of component state, so they survive reloads.
  const prefs = useWorkspacePrefsStore((s) => s.prefs)
  const closed = useMemo(
    () => new Set(Object.keys(prefs).filter((id) => prefs[id]?.tabClosed === true)),
    [prefs],
  )
  const visible = useMemo(() => workspaces.filter((id) => !closed.has(id)), [workspaces, closed])
  const shown = visible.slice(0, MAX_VISIBLE_TABS)
  const overflow = visible.length - shown.length

  if (visible.length === 0) return null

  return (
    <div
      className="flex items-center gap-1 px-4 pt-2"
      data-testid="workspace-tabs"
      title={t("shell.tabs.switchHint")}
    >
      {shown.map((id) => {
        const active = id === activeId
        return (
          <div
            key={id}
            className={`group flex items-center gap-1 rounded-t-md border border-b-0 px-2 py-1 text-xs ${
              active
                ? "border-border bg-background font-medium text-foreground"
                : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            <button
              type="button"
              className="max-w-[14rem] truncate font-mono"
              onClick={() => onPick(id)}
              title={id}
              data-testid={`workspace-tab-${id}`}
              aria-current={active ? "true" : undefined}
            >
              {id}
            </button>
            <button
              type="button"
              className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              // Closing only hides the tab; the prefs record marks it so the
              // strip keeps it closed after a reload too.
              onClick={() => useWorkspacePrefsStore.getState().updatePrefs(id, { tabClosed: true })}
              aria-label={`${t("tabs.close")} ${id}`}
              data-testid={`workspace-tab-close-${id}`}
            >
              ×
            </button>
          </div>
        )
      })}
      {overflow > 0 && (
        <span className="px-1 text-xs text-muted-foreground">
          +{overflow} {t("tabs.more")}
        </span>
      )}
    </div>
  )
}

export { removeTab as __removeTabForTest }
