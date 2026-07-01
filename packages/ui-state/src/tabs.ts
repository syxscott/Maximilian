/**
 * Tabs store — ported from OpenCode `context/tabs.tsx` (SolidJS) to React + Zustand.
 *
 * Manages the open list of session/draft tabs and a "recent" pointer used to
 * restore focus when navigating away. Persistence and migration logic is kept
 * intact; only the reactive wrapper changes.
 */

import { create } from "zustand"

export type ServerConnectionKey = string

export type SessionTab = {
  type: "session"
  server: ServerConnectionKey
  dirBase64: string
  sessionId: string
}

export type DraftTab = {
  type: "draft"
  draftID: string
  server: ServerConnectionKey
  directory: string
  worktree?: string
}

export type Tab = SessionTab | DraftTab

type RecentTab = {
  key?: string
}

export type TabsStoreState = {
  /** All open tabs (persisted) */
  store: Tab[]
  /** Recent tab pointer (persisted separately) */
  recent: RecentTab
}

export type TabsStoreActions = {
  setStore: (updater: (tabs: Tab[]) => Tab[]) => void
  setRecentKey: (key: string | undefined) => void
  reset: (tabs?: Tab[], recent?: RecentTab) => void
}

export type TabsStore = TabsStoreState & TabsStoreActions

export const useTabsStore = create<TabsStore>()((set) => ({
  store: [],
  recent: {},

  setStore: (updater) =>
    set((state) => ({ store: updater(state.store) })),

  setRecentKey: (key) =>
    set((state) => ({ recent: { ...state.recent, key } })),

  reset: (tabs, recent) =>
    set({
      store: tabs ?? [],
      recent: recent ?? {},
    }),
}))

// ----------------------------------------------------------------------------
// Pure helpers ported from OpenCode so consumers can compute hrefs and keys
// without depending on SolidJS routing internals.
// ----------------------------------------------------------------------------

export const draftHref = (draftID: string) =>
  `/new-session?draftId=${encodeURIComponent(draftID)}`

export const tabHref = (tab: Tab): string =>
  tab.type === "draft" ? draftHref(tab.draftID) : `/${tab.dirBase64}/session/${tab.sessionId}`

export const tabKey = (tab: Tab): string =>
  tab.type === "draft" ? `draft:${tab.draftID}` : `${tab.server}\n${tabHref(tab)}`

export function sessionHasOpenTab(
  tabs: Tab[],
  server: ServerConnectionKey,
  dirBase64: string,
  sessionId: string,
): boolean {
  return tabs.some(
    (tab) =>
      tab.type === "session" &&
      tab.server === server &&
      tab.dirBase64 === dirBase64 &&
      tab.sessionId === sessionId,
  )
}

/** Filter tabs to those belonging to a known set of server keys. */
export function filterByServers(tabs: Tab[], servers: Set<ServerConnectionKey>): Tab[] {
  return tabs.filter((tab) => servers.has(tab.server))
}

/** Remove all tabs for the given server and return the keys that were removed. */
export function removeServerTabs(tabs: Tab[], key: ServerConnectionKey): {
  next: Tab[]
  removedKeys: string[]
  draftIDs: string[]
} {
  const removedKeys: string[] = []
  const draftIDs: string[] = []
  const next = tabs.filter((tab) => {
    if (tab.server !== key) return true
    removedKeys.push(tabKey(tab))
    if (tab.type === "draft") draftIDs.push(tab.draftID)
    return false
  })
  return { next, removedKeys, draftIDs }
}

/** Promote a draft into a session tab — replacing any existing draft entry. */
export function promoteDraftTab(tabs: Tab[], draftID: string, next: SessionTab): Tab[] {
  return tabs.map((tab) =>
    tab.type === "draft" && tab.draftID === draftID ? next : tab,
  )
}

/** Append a session tab if it doesn't already exist. */
export function addSessionTab(tabs: Tab[], tab: SessionTab): Tab[] {
  const target = tabKey(tab)
  if (tabs.some((existing) => tabKey(existing) === target)) return tabs
  return [...tabs, tab]
}

/** Append a new draft tab. */
export function addDraftTab(tabs: Tab[], tab: DraftTab): Tab[] {
  return [...tabs, tab]
}

/** Update fields of an existing draft tab. */
export function updateDraftTab(
  tabs: Tab[],
  draftID: string,
  patch: Partial<Omit<DraftTab, "type" | "draftID">>,
): Tab[] {
  return tabs.map((tab) =>
    tab.type === "draft" && tab.draftID === draftID ? { ...tab, ...patch } : tab,
  )
}

/** Remove a tab by index. */
export function removeTabAt(tabs: Tab[], index: number): {
  next: Tab[]
  removed: Tab | undefined
  fallback: Tab | undefined
} {
  if (index < 0 || index >= tabs.length) {
    return { next: tabs, removed: undefined, fallback: undefined }
  }
  const removed = tabs[index]
  const next = [...tabs.slice(0, index), ...tabs.slice(index + 1)]
  const fallback = next[index] ?? next[index - 1]
  return { next, removed, fallback }
}

/** Remove a set of session tabs matching the given directory/session IDs. */
export function removeSessionTabs(
  tabs: Tab[],
  server: ServerConnectionKey,
  dirBase64: string,
  sessionIDs: Set<string>,
): Tab[] {
  return tabs.filter((tab) => {
    if (tab.type !== "session") return true
    if (tab.server !== server) return true
    if (tab.dirBase64 !== dirBase64) return true
    return !sessionIDs.has(tab.sessionId)
  })
}