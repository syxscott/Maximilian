// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Global search store (ZCode search borrowing): the query/scope pair the
 * search UI is editing, the last result set (cached with the query+scope
 * it belongs to, so a scope switch never shows stale hits) and the last
 * 10 committed searches, persisted to localStorage under
 * "maximilian.search" so recent history survives reloads. Results are
 * injected by the caller (setResults) — this store holds state, not the
 * search engine. Every storage touch is defensive (try/catch).
 */
import { create } from "zustand"

export const SEARCH_STORAGE_KEY = "maximilian.search"

/** Recent-search history cap (matches the palette's "recent" depth). */
export const RECENT_SEARCHES_LIMIT = 10

export type SearchScope = "all" | "tasks" | "sessions" | "files" | "settings"

export const SEARCH_SCOPES: readonly SearchScope[] = [
  "all",
  "tasks",
  "sessions",
  "files",
  "settings",
]

export interface SearchResult {
  /** Stable id within one result set — render key, dedupe anchor. */
  id: string
  scope: SearchScope
  /** Display label (already translated by the producer). */
  label: string
  /** One-line context, e.g. a snippet or path. */
  detail?: string
  /** Navigation target when the result is task-backed. */
  taskId?: string
}

function isScope(v: unknown): v is SearchScope {
  return typeof v === "string" && (SEARCH_SCOPES as readonly string[]).includes(v)
}

/** Bounded string — empty and non-string values collapse to undefined. */
function bounded(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined
}

/** Pure recent-list update: front-insert, dedupe, cap, drop blanks. */
export function pushRecentSearch(
  recent: string[],
  query: string,
  limit = RECENT_SEARCHES_LIMIT,
): string[] {
  const q = query.trim()
  if (q === "") return recent
  return [q, ...recent.filter((r) => r !== q)].slice(0, limit)
}

/** Defensive parse of the persisted document — anything odd becomes the default. */
export function parseSearchDoc(raw: string | null | undefined): { recent: string[] } {
  if (!raw) return { recent: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { recent: [] }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { recent: [] }
  const list = (parsed as Record<string, unknown>).recent
  const recent = Array.isArray(list)
    ? list
        .filter((q): q is string => typeof q === "string" && q.trim() !== "")
        .map((q) => q.slice(0, 200))
        .slice(0, RECENT_SEARCHES_LIMIT)
    : []
  return { recent }
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined
  } catch {
    return undefined
  }
}

/** Read persisted recent searches; never throws. */
export function loadRecentSearches(storage: Storage | undefined = defaultStorage()): string[] {
  if (!storage) return []
  try {
    return parseSearchDoc(storage.getItem(SEARCH_STORAGE_KEY)).recent
  } catch {
    return []
  }
}

/** Write recent searches to storage; never throws. */
export function persistRecentSearches(
  recent: string[],
  storage: Storage | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(SEARCH_STORAGE_KEY, JSON.stringify({ recent }))
  } catch {
    // Quota exceeded / storage disabled — history simply stays in memory.
  }
}

/** Defensive result-set coercion — producers hand over passthrough JSON. */
export function parseSearchResults(value: unknown, max = 100): SearchResult[] {
  if (!Array.isArray(value)) return []
  const out: SearchResult[] = []
  for (const entry of value.slice(0, max)) {
    if (entry === null || typeof entry !== "object") continue
    const o = entry as Record<string, unknown>
    const id = bounded(o.id, 200)
    const label = bounded(o.label, 300)
    if (!id || !label) continue
    const detail = bounded(o.detail, 300)
    const taskId = bounded(o.taskId, 200)
    out.push({
      id,
      scope: isScope(o.scope) ? o.scope : "all",
      label,
      ...(detail ? { detail } : {}),
      ...(taskId ? { taskId } : {}),
    })
  }
  return out
}

interface SearchState {
  /** The live query text being edited (not yet committed). */
  query: string
  scope: SearchScope
  /** Last injected result set… */
  results: SearchResult[]
  /** …tagged with the query+scope it answers, for staleness checks. */
  resultsFor: { query: string; scope: SearchScope } | null
  /** Committed searches, most recent first, at most 10. Persisted. */
  recent: string[]
  setQuery: (query: string) => void
  setScope: (scope: SearchScope) => void
  /** Replace the result set; tags it with the current query+scope. */
  setResults: (results: unknown) => void
  /** Commit the current query: recent-front it (deduped, capped). */
  commitSearch: () => void
  removeRecent: (query: string) => void
  clearRecent: () => void
}

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  scope: "all",
  results: [],
  resultsFor: null,
  recent: loadRecentSearches(),
  setQuery: (query) => set({ query: query.slice(0, 300) }),
  setScope: (scope) =>
    set(() => ({
      scope: isScope(scope) ? scope : "all",
      // Results are scope-specific — drop them so a scope switch can
      // never render the previous scope's hits.
      results: [],
      resultsFor: null,
    })),
  setResults: (results) =>
    set((s) => ({
      results: parseSearchResults(results),
      resultsFor: { query: s.query, scope: s.scope },
    })),
  commitSearch: () =>
    set((s) => {
      const recent = pushRecentSearch(s.recent, s.query)
      persistRecentSearches(recent)
      return { recent }
    }),
  removeRecent: (query) =>
    set((s) => {
      const recent = s.recent.filter((r) => r !== query)
      persistRecentSearches(recent)
      return { recent }
    }),
  clearRecent: () =>
    set(() => {
      persistRecentSearches([])
      return { recent: [] }
    }),
}))

// ── Selector hooks ──────────────────────────────────────────────────────────

export const useSearchQuery = (): string => useSearchStore((s) => s.query)

export const useSearchScope = (): SearchScope => useSearchStore((s) => s.scope)

export const useRecentSearches = (): string[] => useSearchStore((s) => s.recent)

/** Selector: are the cached results answers to the current query+scope? */
export const selectResultsFresh = (s: SearchState): boolean =>
  s.resultsFor !== null && s.resultsFor.query === s.query && s.resultsFor.scope === s.scope
