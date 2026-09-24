// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workspace preferences store (ZCode per-workspace-state borrowing): one
 * preference record per workspace id — sidebar visibility, sort order
 * and last-visited timestamp. The in-memory shape is a persistent map
 * (Record<workspaceId, WorkspacePrefs>) keyed by workspace id, mirrored
 * to localStorage under "maximilian.workspace-prefs" so each workspace
 * reopens the way the user left it. Every storage touch is defensive
 * (try/catch) and parseWorkspacePrefs drops malformed entries wholesale.
 */
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

export const WORKSPACE_PREFS_STORAGE_KEY = "maximilian.workspace-prefs"

export type WorkspaceSortOrder = "recent" | "alpha"

export interface WorkspacePrefs {
  sidebarHidden: boolean
  sortOrder: WorkspaceSortOrder
  /** Epoch ms of the last visit — drives "recent" ordering elsewhere. */
  lastVisitedAt: number
  /** Workspace tab closed in the titlebar strip (only ever present as true —
   *  absent/false means the tab is open). Consumed by WorkspaceTabStrip. */
  tabClosed?: boolean
}

export function defaultWorkspacePrefs(now = 0): WorkspacePrefs {
  return { sidebarHidden: false, sortOrder: "recent", lastVisitedAt: now }
}

const SORT_ORDERS: readonly WorkspaceSortOrder[] = ["recent", "alpha"]

/** Defensive per-workspace parse — returns the default for junk entries. */
export function parseWorkspacePrefs(value: unknown): WorkspacePrefs {
  const base = defaultWorkspacePrefs()
  if (value === null || typeof value !== "object" || Array.isArray(value)) return base
  const o = value as Record<string, unknown>
  const sortOrder =
    typeof o.sortOrder === "string" && (SORT_ORDERS as readonly string[]).includes(o.sortOrder)
      ? (o.sortOrder as WorkspaceSortOrder)
      : base.sortOrder
  const lastVisitedAt =
    typeof o.lastVisitedAt === "number" && Number.isFinite(o.lastVisitedAt)
      ? o.lastVisitedAt
      : base.lastVisitedAt
  return {
    sidebarHidden: o.sidebarHidden === true,
    sortOrder,
    lastVisitedAt,
    // Only ever materialized as true so the default record shape stays
    // byte-compatible with pre-tabClosed payloads and tests.
    ...(o.tabClosed === true ? { tabClosed: true } : {}),
  }
}

/** Defensive parse of the whole persisted map — only string-keyed entries survive. */
export function parseWorkspacePrefsMap(
  raw: string | null | undefined,
): Record<string, WorkspacePrefs> {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  const out: Record<string, WorkspacePrefs> = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (id !== "") out[id] = parseWorkspacePrefs(value)
  }
  return out
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined
  } catch {
    return undefined
  }
}

/** Read the persisted prefs map; never throws. */
export function loadWorkspacePrefs(
  storage: Storage | undefined = defaultStorage(),
): Record<string, WorkspacePrefs> {
  if (!storage) return {}
  try {
    return parseWorkspacePrefsMap(storage.getItem(WORKSPACE_PREFS_STORAGE_KEY))
  } catch {
    return {}
  }
}

/** Write the prefs map to storage; never throws. */
export function persistWorkspacePrefs(
  prefs: Record<string, WorkspacePrefs>,
  storage: Storage | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(WORKSPACE_PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Quota exceeded / storage disabled — prefs simply stay in memory.
  }
}

/** Pure merge: validated patch over an existing (or default) record. */
export function mergeWorkspacePrefs(
  base: WorkspacePrefs | undefined,
  patch: Partial<WorkspacePrefs>,
): WorkspacePrefs {
  const merged = parseWorkspacePrefs({ ...(base ?? defaultWorkspacePrefs()), ...patch })
  return merged
}

interface WorkspacePrefsState {
  prefs: Record<string, WorkspacePrefs>
  /** Patch one workspace's prefs (creates the record on first touch). */
  updatePrefs: (workspaceId: string, patch: Partial<WorkspacePrefs>) => void
  /** Stamp lastVisitedAt = now (injectable for tests) — the "open" side effect. */
  markVisited: (workspaceId: string, now?: number) => void
  forgetWorkspace: (workspaceId: string) => void
}

export const useWorkspacePrefsStore = create<WorkspacePrefsState>((set) => ({
  prefs: loadWorkspacePrefs(),
  updatePrefs: (workspaceId, patch) => {
    if (workspaceId === "") return
    set((s) => {
      const prefs = {
        ...s.prefs,
        [workspaceId]: mergeWorkspacePrefs(s.prefs[workspaceId], patch),
      }
      persistWorkspacePrefs(prefs)
      return { prefs }
    })
  },
  markVisited: (workspaceId, now) => {
    if (workspaceId === "") return
    set((s) => {
      const at = typeof now === "number" && Number.isFinite(now) ? now : Date.now()
      const prefs = {
        ...s.prefs,
        [workspaceId]: mergeWorkspacePrefs(s.prefs[workspaceId], { lastVisitedAt: at }),
      }
      persistWorkspacePrefs(prefs)
      return { prefs }
    })
  },
  forgetWorkspace: (workspaceId) =>
    set((s) => {
      if (!(workspaceId in s.prefs)) return s
      const prefs = { ...s.prefs }
      delete prefs[workspaceId]
      persistWorkspacePrefs(prefs)
      return { prefs }
    }),
}))

// ── Selector hooks ──────────────────────────────────────────────────────────

/** Selector: one workspace's prefs, defaulted when untouched. */
export const selectWorkspacePrefs =
  (workspaceId: string) =>
  (s: WorkspacePrefsState): WorkspacePrefs =>
    s.prefs[workspaceId] ?? defaultWorkspacePrefs()

export const useWorkspacePrefs = (workspaceId: string): WorkspacePrefs =>
  // The selector builds a fresh default object for untouched workspaces —
  // useShallow keeps the subscription stable across those allocations.
  useWorkspacePrefsStore(useShallow(selectWorkspacePrefs(workspaceId)))
