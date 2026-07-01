/**
 * Terminal store — ported from OpenCode `context/terminal.tsx` (SolidJS) to React + Zustand.
 *
 * Manages the list of local PTYs (pseudo-terminals) per workspace, including
 * the active selection, buffer/scroll state, and lifecycle actions
 * (create / close / clone / move). Persistence migration logic is preserved.
 */

import { create } from "zustand"

export type LocalPTY = {
  id: string
  title: string
  titleNumber: number
  rows?: number
  cols?: number
  buffer?: string
  scrollY?: number
  cursor?: number
}

export type TerminalWorkspaceState = {
  active?: string
  all: LocalPTY[]
}

export type TerminalStoreState = {
  /** Keyed by workspace (dir + scope) — maps to its terminal set. */
  workspaces: Record<string, TerminalWorkspaceState>
}

export type TerminalStoreActions = {
  /** Replace the active terminal ID for a workspace. */
  setActive: (workspaceKey: string, id: string | undefined) => void
  /** Append a new PTY (and optionally make it active). */
  addPty: (workspaceKey: string, pty: LocalPTY, makeActive?: boolean) => void
  /** Patch fields of an existing PTY. */
  updatePty: (workspaceKey: string, id: string, patch: Partial<LocalPTY>) => void
  /** Remove a PTY by id; reassigns `active` if the removed PTY was active. */
  removePty: (workspaceKey: string, id: string) => void
  /** Move a PTY within the list (drag-reorder). */
  movePty: (workspaceKey: string, id: string, to: number) => void
  /** Replace an existing PTY (used after a clone returns a new server ID). */
  replacePty: (
    workspaceKey: string,
    previousId: string,
    next: LocalPTY,
  ) => void
  /** Wipe all terminals for a workspace. */
  clearWorkspace: (workspaceKey: string) => void
  /** Wipe every workspace's terminals (used when scope changes). */
  reset: () => void
}

export type TerminalStore = TerminalStoreState & TerminalStoreActions

const emptyWorkspace: TerminalWorkspaceState = { all: [] }

export const useTerminalStore = create<TerminalStore>()((set) => ({
  workspaces: {},

  setActive: (workspaceKey, id) =>
    set((state) => {
      const current = state.workspaces[workspaceKey] ?? emptyWorkspace
      return {
        workspaces: {
          ...state.workspaces,
          [workspaceKey]: { ...current, active: id },
        },
      }
    }),

  addPty: (workspaceKey, pty, makeActive = true) =>
    set((state) => {
      const current = state.workspaces[workspaceKey] ?? emptyWorkspace
      return {
        workspaces: {
          ...state.workspaces,
          [workspaceKey]: {
            active: makeActive ? pty.id : current.active,
            all: [...current.all, pty],
          },
        },
      }
    }),

  updatePty: (workspaceKey, id, patch) =>
    set((state) => {
      const current = state.workspaces[workspaceKey]
      if (!current) return state
      const index = current.all.findIndex((p) => p.id === id)
      if (index === -1) return state
      const next = [...current.all]
      const existing = next[index]
      if (!existing) return state
      next[index] = { ...existing, ...patch }
      return {
        workspaces: {
          ...state.workspaces,
          [workspaceKey]: { ...current, all: next },
        },
      }
    }),

  removePty: (workspaceKey, id) =>
    set((state) => {
      const current = state.workspaces[workspaceKey]
      if (!current) return state
      const index = current.all.findIndex((p) => p.id === id)
      if (index === -1) return state
      const all = [...current.all.slice(0, index), ...current.all.slice(index + 1)]
      let nextActive = current.active
      if (current.active === id) {
        // Mirror the OpenCode fallback: when removing an active PTY, prefer
        // the entry before it; otherwise the next one in line.
        nextActive = index === 0 ? all[1]?.id : all[0]?.id
      }
      return {
        workspaces: {
          ...state.workspaces,
          [workspaceKey]: { active: nextActive, all },
        },
      }
    }),

  movePty: (workspaceKey, id, to) =>
    set((state) => {
      const current = state.workspaces[workspaceKey]
      if (!current) return state
      const index = current.all.findIndex((p) => p.id === id)
      if (index === -1) return state
      const entry = current.all[index]
      if (!entry) return state
      const next = [...current.all]
      next.splice(index, 1)
      next.splice(to, 0, entry)
      return {
        workspaces: {
          ...state.workspaces,
          [workspaceKey]: { ...current, all: next },
        },
      }
    }),

  replacePty: (workspaceKey, previousId, nextPty) =>
    set((state) => {
      const current = state.workspaces[workspaceKey]
      if (!current) return state
      const index = current.all.findIndex((p) => p.id === previousId)
      if (index === -1) return state
      const all = [...current.all]
      all[index] = nextPty
      const active = current.active === previousId ? nextPty.id : current.active
      return {
        workspaces: {
          ...state.workspaces,
          [workspaceKey]: { ...current, active, all },
        },
      }
    }),

  clearWorkspace: (workspaceKey) =>
    set((state) => ({
      workspaces: {
        ...state.workspaces,
        [workspaceKey]: { active: undefined, all: [] },
      },
    })),

  reset: () => set({ workspaces: {} }),
}))

// ----------------------------------------------------------------------------
// Pure helpers — preserve OpenCode's migration logic and naming conventions
// so the persisted format stays compatible across runtimes.
// ----------------------------------------------------------------------------

export const WORKSPACE_KEY = "__workspace__"
export const MAX_TERMINAL_SESSIONS = 20

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function pty(value: unknown): LocalPTY | undefined {
  if (!record(value)) return undefined

  const id = text(value.id)
  if (!id) return undefined

  const title = text(value.title) ?? ""
  const titleNumber = num(value.titleNumber) ?? 0
  const rows = num(value.rows)
  const cols = num(value.cols)
  const buffer = text(value.buffer)
  const scrollY = num(value.scrollY)
  const cursor = num(value.cursor)

  return {
    id,
    title,
    titleNumber,
    ...(rows !== undefined ? { rows } : {}),
    ...(cols !== undefined ? { cols } : {}),
    ...(buffer !== undefined ? { buffer } : {}),
    ...(scrollY !== undefined ? { scrollY } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  }
}

export function migrateTerminalState(value: unknown): unknown {
  if (!record(value)) return value

  const seen = new Set<string>()
  const all = (Array.isArray(value.all) ? value.all : []).flatMap((item) => {
    const next = pty(item)
    if (!next || seen.has(next.id)) return []
    seen.add(next.id)
    return [next]
  })

  const active = text(value.active)

  return {
    active: active && seen.has(active) ? active : all[0]?.id,
    all,
  }
}

export function trimTerminal(ptyEntry: LocalPTY): LocalPTY {
  if (!ptyEntry.buffer && ptyEntry.cursor === undefined && ptyEntry.scrollY === undefined) {
    return ptyEntry
  }
  return {
    ...ptyEntry,
    buffer: undefined,
    cursor: undefined,
    scrollY: undefined,
  }
}

export function trimAllTerminals(all: LocalPTY[]): LocalPTY[] {
  let changed = false
  const next = all.map((entry) => {
    const trimmed = trimTerminal(entry)
    if (trimmed !== entry) changed = true
    return trimmed
  })
  return changed ? next : all
}

export function pickNextTerminalNumber(all: LocalPTY[]): number {
  const used = new Set<number>()
  for (const entry of all) {
    const direct = entry.titleNumber
    if (direct !== undefined && direct > 0) {
      used.add(direct)
    }
  }
  const candidate = Array.from({ length: used.size + 1 }, (_, index) => index + 1).find(
    (n) => !used.has(n),
  )
  return candidate ?? 1
}

export function workspaceCacheKey(scope: string, dir: string): string {
  return `${scope}\n${dir}\n${WORKSPACE_KEY}`
}

export type TerminalCacheEntry = {
  state: TerminalWorkspaceState
  dispose: () => void
}

export function createTerminalCache(maxEntries: number = MAX_TERMINAL_SESSIONS) {
  const cache = new Map<string, TerminalCacheEntry>()

  function prune() {
    while (cache.size > maxEntries) {
      const first = cache.keys().next().value
      if (!first) return
      const entry = cache.get(first)
      entry?.dispose()
      cache.delete(first)
    }
  }

  return {
    get(key: string): TerminalCacheEntry {
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing
      }
      const entry: TerminalCacheEntry = {
        state: { all: [] },
        dispose: () => {
          /* per-scope dispose hook */
        },
      }
      cache.set(key, entry)
      prune()
      return entry
    },
    clear() {
      for (const entry of cache.values()) entry.dispose()
      cache.clear()
    },
    size() {
      return cache.size
    },
  }
}