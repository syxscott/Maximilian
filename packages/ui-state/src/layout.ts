/**
 * Layout store — ported from OpenCode `context/layout.tsx` (SolidJS) to React + Zustand.
 *
 * Owns the application's persistent UI layout: sidebar / terminal / review /
 * file-tree panes, mobile sidebar, project list enrichment, per-session
 * tabs and view state, and scroll persistence. SolidJS `createStore` mutations
 * are translated into Zustand `set` calls; per-field `createMemo` accessors
 * remain as selector functions for fine-grained React subscriptions.
 */

import { create } from "zustand"

export interface Project {
  id?: string
  name?: string
  worktree: string
  sandboxes?: string[]
  [key: string]: unknown
}

export type ProjectAvatarVariant = "orange" | "pink" | "cyan" | "purple" | "green" | "gray"

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

export const AVATAR_COLOR_KEYS = [
  "pink",
  "mint",
  "orange",
  "purple",
  "cyan",
  "lime",
] as const

export const DEFAULT_SIDEBAR_WIDTH = 344
export const DEFAULT_FILE_TREE_WIDTH = 200
export const DEFAULT_SESSION_WIDTH = 600
export const DEFAULT_TERMINAL_HEIGHT = 280

export type AvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number]

export const MAX_SESSION_KEYS = 50
export const PENDING_MESSAGE_TTL_MS = 2 * 60 * 1000

export function getAvatarColors(key?: string): {
  background: string
  foreground: string
} {
  if (key && (AVATAR_COLOR_KEYS as readonly string[]).includes(key)) {
    return {
      background: `var(--avatar-background-${key})`,
      foreground: `var(--avatar-text-${key})`,
    }
  }
  return {
    background: "var(--surface-info-base)",
    foreground: "var(--text-base)",
  }
}

export function getProjectAvatarVariant(key?: string): ProjectAvatarVariant {
  if (key === "orange") return "orange"
  if (key === "pink") return "pink"
  if (key === "cyan") return "cyan"
  if (key === "purple") return "purple"
  if (key === "mint") return "cyan"
  if (key === "lime") return "green"
  return "gray"
}

// ----------------------------------------------------------------------------
// Domain types
// ----------------------------------------------------------------------------

export type ServerConnectionKey = string

export type LayoutRoute =
  | { type: "home" }
  | { type: "draft"; draftID: string; server?: ServerConnectionKey }
  | { type: "dir-new-sesssion"; dir: string; dirBase64: string; server?: ServerConnectionKey }
  | { type: "session"; dir: string; dirBase64: string; sessionId: string; server?: ServerConnectionKey }

export type SessionScroll = Record<string, { top?: number; left?: number }>

export type SessionTabs = {
  active?: string
  all: string[]
}

export type SessionView = {
  scroll: SessionScroll
  reviewOpen?: string[]
  pendingMessage?: string
  pendingMessageAt?: number
  todoCollapsed?: boolean
}

export type TabHandoff = {
  scope: string
  dir: string
  id: string
  at: number
}

export type LocalProject = Partial<Project> & {
  worktree: string
  expanded: boolean
}

export type ReviewDiffStyle = "unified" | "split"

export type FileTreeTab = "changes" | "all"

export type SidebarState = {
  opened: boolean
  width: number
  workspaces: Record<string, boolean>
  workspacesDefault: boolean
}

export type TerminalPaneState = {
  height: number
  opened: boolean
}

export type ReviewState = {
  diffStyle: ReviewDiffStyle
  panelOpened: boolean
}

export type FileTreeState = {
  opened: boolean
  width: number
  tab: FileTreeTab
}

export type SessionPaneState = {
  width: number
}

export type MobileSidebarState = {
  opened: boolean
}

// ----------------------------------------------------------------------------
// Store shape
// ----------------------------------------------------------------------------

export type LayoutState = {
  sidebar: SidebarState
  terminal: TerminalPaneState
  review: ReviewState
  fileTree: FileTreeState
  session: SessionPaneState
  mobileSidebar: MobileSidebarState
  sessionTabs: Record<string, SessionTabs>
  sessionView: Record<string, SessionView>
  handoff: {
    tabs?: TabHandoff
  }
  colors: Record<string, AvatarColorKey>
  usage: {
    active?: string
    pruned: boolean
    used: Record<string, number>
  }
}

export type LayoutStoreActions = {
  // Sidebar
  setSidebarOpened: (opened: boolean) => void
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  setSidebarWorkspaces: (directory: string, value: boolean) => void
  toggleSidebarWorkspaces: (directory: string) => void

  // Terminal pane
  setTerminalHeight: (height: number) => void
  setTerminalOpened: (opened: boolean) => void
  toggleTerminalOpened: () => void

  // Review
  setReviewDiffStyle: (style: ReviewDiffStyle) => void
  setReviewPanelOpened: (opened: boolean) => void
  toggleReviewPanelOpened: () => void

  // File tree
  setFileTreeTab: (tab: FileTreeTab) => void
  setFileTreeOpened: (opened: boolean) => void
  toggleFileTree: () => void
  setFileTreeWidth: (width: number) => void

  // Session pane
  setSessionWidth: (width: number) => void

  // Mobile sidebar
  setMobileSidebarOpened: (opened: boolean) => void
  toggleMobileSidebar: () => void

  // Handoff
  setHandoffTabs: (handoff: TabHandoff | undefined) => void

  // Session view (per-sessionKey)
  ensureSessionView: (sessionKey: string) => SessionView
  setSessionViewField: <K extends keyof SessionView>(
    sessionKey: string,
    field: K,
    value: SessionView[K],
  ) => void
  mergeSessionView: (sessionKey: string, patch: Partial<SessionView>) => void
  dropSessionView: (sessionKey: string) => void
  setSessionScroll: (
    sessionKey: string,
    scrollPatch: SessionScroll,
  ) => void

  // Session tabs (per-sessionKey)
  ensureSessionTabs: (sessionKey: string) => SessionTabs
  setSessionTabs: (sessionKey: string, next: SessionTabs) => void
  setSessionTabsAll: (sessionKey: string, all: string[]) => void
  setSessionTabsActive: (sessionKey: string, active: string | undefined) => void
  dropSessionTabs: (sessionKey: string) => void

  // Pending message
  setPendingMessage: (sessionKey: string, messageID: string) => void
  consumePendingMessage: (sessionKey: string) => string | undefined

  // Review per-session
  addReviewPath: (sessionKey: string, path: string) => void
  removeReviewPath: (sessionKey: string, path: string) => void
  setReviewPaths: (sessionKey: string, paths: string[]) => void

  // Todo collapsed per-session
  setTodoCollapsed: (sessionKey: string, collapsed: boolean) => void

  // Colors
  setColor: (worktree: string, color: AvatarColorKey) => void

  // Usage tracking
  touch: (sessionKey: string) => void
  markPruned: () => void
  prune: (keep?: string) => void

  // Bulk
  reset: () => void
}

export type LayoutStore = LayoutState & LayoutStoreActions

// ----------------------------------------------------------------------------
// Defaults + initial state
// ----------------------------------------------------------------------------

const initialSidebar: SidebarState = {
  opened: false,
  width: DEFAULT_SIDEBAR_WIDTH,
  workspaces: {},
  workspacesDefault: false,
}

const initialTerminal: TerminalPaneState = {
  height: DEFAULT_TERMINAL_HEIGHT,
  opened: false,
}

const initialReview: ReviewState = {
  diffStyle: "split",
  panelOpened: true,
}

const initialFileTree: FileTreeState = {
  opened: false,
  width: DEFAULT_FILE_TREE_WIDTH,
  tab: "changes",
}

const initialSession: SessionPaneState = {
  width: DEFAULT_SESSION_WIDTH,
}

const initialMobileSidebar: MobileSidebarState = {
  opened: false,
}

const initialUsage = {
  active: undefined as string | undefined,
  pruned: false,
  used: {} as Record<string, number>,
}

const initialState: LayoutState = {
  sidebar: initialSidebar,
  terminal: initialTerminal,
  review: initialReview,
  fileTree: initialFileTree,
  session: initialSession,
  mobileSidebar: initialMobileSidebar,
  sessionTabs: {},
  sessionView: {},
  handoff: { tabs: undefined },
  colors: {},
  usage: initialUsage,
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

export function nextSessionTabsForOpen(
  current: SessionTabs | undefined,
  tab: string,
): SessionTabs {
  const all = current?.all ?? []
  if (tab === "review") return { all: all.filter((x) => x !== "review"), active: tab }
  if (tab === "context") {
    return { all: [tab, ...all.filter((x) => x !== tab)], active: tab }
  }
  if (!all.includes(tab)) return { all: [...all, tab], active: tab }
  return { all, active: tab }
}

export function isSameStringArray(a: string[] | undefined, b: string[]): boolean {
  if (!a) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function resolveRoot(
  directory: string,
  rootMap: Map<string, string>,
): string {
  if (rootMap.size === 0) return directory
  const visited = new Set<string>()
  const chain = [directory]

  while (chain.length) {
    const current = chain[chain.length - 1]
    if (!current) return directory
    const next = rootMap.get(current)
    if (!next) return current
    if (visited.has(next)) return directory
    visited.add(next)
    chain.push(next)
  }

  return directory
}

export function buildRootMap(projects: Project[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const project of projects) {
    const sandboxes = project.sandboxes ?? []
    for (const sandbox of sandboxes) {
      map.set(sandbox, project.worktree)
    }
  }
  return map
}

export function pickAvailableColor(used: Set<string>): AvatarColorKey {
  const available = AVATAR_COLOR_KEYS.filter((c) => !used.has(c))
  if (available.length === 0) {
    return AVATAR_COLOR_KEYS[Math.floor(Math.random() * AVATAR_COLOR_KEYS.length)]
  }
  return available[Math.floor(Math.random() * available.length)]
}

export function pickSessionScroll(
  state: LayoutState,
  sessionKey: string,
  tab: string,
): { top?: number; left?: number } | undefined {
  return state.sessionView[sessionKey]?.scroll?.[tab]
}

// ----------------------------------------------------------------------------
// Store implementation
// ----------------------------------------------------------------------------

export const useLayoutStore = create<LayoutStore>()((set, get) => ({
  ...initialState,

  // ---------- Sidebar ----------
  setSidebarOpened: (opened) =>
    set((state) => ({ sidebar: { ...state.sidebar, opened } })),
  toggleSidebar: () =>
    set((state) => ({ sidebar: { ...state.sidebar, opened: !state.sidebar.opened } })),
  setSidebarWidth: (width) =>
    set((state) => ({ sidebar: { ...state.sidebar, width } })),
  setSidebarWorkspaces: (directory, value) =>
    set((state) => ({
      sidebar: {
        ...state.sidebar,
        workspaces: { ...state.sidebar.workspaces, [directory]: value },
      },
    })),
  toggleSidebarWorkspaces: (directory) =>
    set((state) => {
      const current =
        state.sidebar.workspaces[directory] ?? state.sidebar.workspacesDefault ?? false
      return {
        sidebar: {
          ...state.sidebar,
          workspaces: { ...state.sidebar.workspaces, [directory]: !current },
        },
      }
    }),

  // ---------- Terminal pane ----------
  setTerminalHeight: (height) =>
    set((state) => ({ terminal: { ...state.terminal, height } })),
  setTerminalOpened: (opened) =>
    set((state) => {
      if (state.terminal.opened === opened) return state
      return { terminal: { ...state.terminal, opened } }
    }),
  toggleTerminalOpened: () =>
    set((state) => ({
      terminal: { ...state.terminal, opened: !state.terminal.opened },
    })),

  // ---------- Review ----------
  setReviewDiffStyle: (diffStyle) =>
    set((state) => ({ review: { ...state.review, diffStyle } })),
  setReviewPanelOpened: (panelOpened) =>
    set((state) => {
      if (state.review.panelOpened === panelOpened) return state
      return { review: { ...state.review, panelOpened } }
    }),
  toggleReviewPanelOpened: () =>
    set((state) => ({
      review: { ...state.review, panelOpened: !state.review.panelOpened },
    })),

  // ---------- File tree ----------
  setFileTreeTab: (tab) =>
    set((state) => ({ fileTree: { ...state.fileTree, tab } })),
  setFileTreeOpened: (opened) =>
    set((state) => ({ fileTree: { ...state.fileTree, opened } })),
  toggleFileTree: () =>
    set((state) => ({
      fileTree: { ...state.fileTree, opened: !state.fileTree.opened },
    })),
  setFileTreeWidth: (width) =>
    set((state) => ({ fileTree: { ...state.fileTree, width } })),

  // ---------- Session pane ----------
  setSessionWidth: (width) =>
    set((state) => ({ session: { ...state.session, width } })),

  // ---------- Mobile sidebar ----------
  setMobileSidebarOpened: (opened) =>
    set((state) => ({ mobileSidebar: { ...state.mobileSidebar, opened } })),
  toggleMobileSidebar: () =>
    set((state) => ({
      mobileSidebar: {
        ...state.mobileSidebar,
        opened: !state.mobileSidebar.opened,
      },
    })),

  // ---------- Handoff ----------
  setHandoffTabs: (handoff) =>
    set((state) => ({ handoff: { ...state.handoff, tabs: handoff } })),

  // ---------- Session view ----------
  ensureSessionView: (sessionKey) => {
    const current = get().sessionView[sessionKey]
    if (current) return current
    const next: SessionView = { scroll: {} }
    set((state) => ({
      sessionView: { ...state.sessionView, [sessionKey]: next },
    }))
    return next
  },
  setSessionViewField: (sessionKey, field, value) =>
    set((state) => {
      const current = state.sessionView[sessionKey] ?? { scroll: {} }
      return {
        sessionView: {
          ...state.sessionView,
          [sessionKey]: { ...current, [field]: value },
        },
      }
    }),
  mergeSessionView: (sessionKey, patch) =>
    set((state) => {
      const current = state.sessionView[sessionKey] ?? { scroll: {} }
      return {
        sessionView: {
          ...state.sessionView,
          [sessionKey]: { ...current, ...patch },
        },
      }
    }),
  dropSessionView: (sessionKey) =>
    set((state) => {
      const next = { ...state.sessionView }
      delete next[sessionKey]
      return { sessionView: next }
    }),
  setSessionScroll: (sessionKey, scrollPatch) =>
    set((state) => {
      const current = state.sessionView[sessionKey] ?? { scroll: {} }
      const merged: SessionScroll = { ...current.scroll, ...scrollPatch }
      return {
        sessionView: {
          ...state.sessionView,
          [sessionKey]: { ...current, scroll: merged },
        },
      }
    }),

  // ---------- Session tabs ----------
  ensureSessionTabs: (sessionKey) => {
    const current = get().sessionTabs[sessionKey]
    if (current) return current
    const next: SessionTabs = { all: [] }
    set((state) => ({
      sessionTabs: { ...state.sessionTabs, [sessionKey]: next },
    }))
    return next
  },
  setSessionTabs: (sessionKey, next) =>
    set((state) => ({
      sessionTabs: { ...state.sessionTabs, [sessionKey]: next },
    })),
  setSessionTabsAll: (sessionKey, all) =>
    set((state) => {
      const current = state.sessionTabs[sessionKey] ?? { all: [] }
      return {
        sessionTabs: {
          ...state.sessionTabs,
          [sessionKey]: { ...current, all },
        },
      }
    }),
  setSessionTabsActive: (sessionKey, active) =>
    set((state) => {
      const current = state.sessionTabs[sessionKey] ?? { all: [] }
      return {
        sessionTabs: {
          ...state.sessionTabs,
          [sessionKey]: { ...current, active },
        },
      }
    }),
  dropSessionTabs: (sessionKey) =>
    set((state) => {
      const next = { ...state.sessionTabs }
      delete next[sessionKey]
      return { sessionTabs: next }
    }),

  // ---------- Pending message ----------
  setPendingMessage: (sessionKey, messageID) =>
    set((state) => {
      const at = Date.now()
      const current = state.sessionView[sessionKey] ?? { scroll: {} }
      return {
        sessionView: {
          ...state.sessionView,
          [sessionKey]: {
            ...current,
            pendingMessage: messageID,
            pendingMessageAt: at,
          },
        },
      }
    }),
  consumePendingMessage: (sessionKey) => {
    const state = get()
    const view = state.sessionView[sessionKey]
    const message = view?.pendingMessage
    const at = view?.pendingMessageAt
    if (!message || !at) return undefined

    set((s) => {
      const current = s.sessionView[sessionKey]
      if (!current) return s
      const next = { ...current }
      delete next.pendingMessage
      delete next.pendingMessageAt
      return {
        sessionView: { ...s.sessionView, [sessionKey]: next },
      }
    })

    if (Date.now() - at > PENDING_MESSAGE_TTL_MS) return undefined
    return message
  },

  // ---------- Review per-session ----------
  addReviewPath: (sessionKey, path) =>
    set((state) => {
      const current = state.sessionView[sessionKey] ?? { scroll: {} }
      const existing = current.reviewOpen ?? []
      if (existing.includes(path)) return state
      return {
        sessionView: {
          ...state.sessionView,
          [sessionKey]: { ...current, reviewOpen: [...existing, path] },
        },
      }
    }),
  removeReviewPath: (sessionKey, path) =>
    set((state) => {
      const current = state.sessionView[sessionKey]
      if (!current?.reviewOpen) return state
      const index = current.reviewOpen.indexOf(path)
      if (index === -1) return state
      const next = [...current.reviewOpen]
      next.splice(index, 1)
      return {
        sessionView: {
          ...state.sessionView,
          [sessionKey]: { ...current, reviewOpen: next },
        },
      }
    }),
  setReviewPaths: (sessionKey, paths) =>
    set((state) => {
      const current = state.sessionView[sessionKey] ?? { scroll: {} }
      const next = Array.from(new Set(paths))
      if (isSameStringArray(current.reviewOpen, next)) return state
      return {
        sessionView: {
          ...state.sessionView,
          [sessionKey]: { ...current, reviewOpen: next },
        },
      }
    }),

  // ---------- Todo collapsed per-session ----------
  setTodoCollapsed: (sessionKey, collapsed) =>
    set((state) => {
      const current = state.sessionView[sessionKey] ?? { scroll: {} }
      return {
        sessionView: {
          ...state.sessionView,
          [sessionKey]: { ...current, todoCollapsed: collapsed },
        },
      }
    }),

  // ---------- Colors ----------
  setColor: (worktree, color) =>
    set((state) => ({ colors: { ...state.colors, [worktree]: color } })),

  // ---------- Usage / prune ----------
  touch: (sessionKey) =>
    set((state) => ({
      usage: {
        ...state.usage,
        active: sessionKey,
        used: { ...state.usage.used, [sessionKey]: Date.now() },
      },
    })),
  markPruned: () =>
    set((state) => ({ usage: { ...state.usage, pruned: true } })),
  prune: (keep) =>
    set((state) => {
      // The OpenCode prune algorithm picks least-recently-used sessions to
      // drop until the active set fits inside MAX_SESSION_KEYS. We re-implement
      // it as a pure helper so the store action stays tiny and reactive code
      // can still inspect the result before committing.
      const used = { ...state.usage.used }
      const viewKeys = Object.keys(state.sessionView)
      const tabKeys = Object.keys(state.sessionTabs)
      const allKeys = new Set([...viewKeys, ...tabKeys])
      if (keep) allKeys.delete(keep)

      if (allKeys.size <= MAX_SESSION_KEYS) {
        // Nothing to drop — but mark usage so callers can detect the pass.
        return state
      }

      const drop: string[] = []
      const sorted = Array.from(allKeys).sort((a, b) => (used[a] ?? 0) - (used[b] ?? 0))
      const overflow = sorted.length - MAX_SESSION_KEYS
      for (let i = 0; i < overflow; i++) {
        const candidate = sorted[i]
        if (candidate) drop.push(candidate)
      }

      const nextView = { ...state.sessionView }
      const nextTabs = { ...state.sessionTabs }
      const nextUsed = { ...used }
      for (const key of drop) {
        delete nextView[key]
        delete nextTabs[key]
        delete nextUsed[key]
      }

      return {
        sessionView: nextView,
        sessionTabs: nextTabs,
        usage: { ...state.usage, used: nextUsed, pruned: true },
      }
    }),

  reset: () => set(() => ({ ...initialState })),
}))

// ----------------------------------------------------------------------------
// Hooks / selectors — exported so React components can subscribe with the
// fine-grained `useStore(state => state.x)` pattern.
// ----------------------------------------------------------------------------

export const useSidebar = () => useLayoutStore((s) => s.sidebar)
export const useSidebarOpened = () => useLayoutStore((s) => s.sidebar.opened)
export const useSidebarWidth = () => useLayoutStore((s) => s.sidebar.width)
export const useSidebarWorkspaces = (directory: string) =>
  useLayoutStore(
    (s) =>
      s.sidebar.workspaces[directory] ?? s.sidebar.workspacesDefault ?? false,
  )

export const useTerminalPane = () => useLayoutStore((s) => s.terminal)
export const useTerminalOpened = () => useLayoutStore((s) => s.terminal.opened)
export const useTerminalHeight = () => useLayoutStore((s) => s.terminal.height)

export const useReview = () => useLayoutStore((s) => s.review)
export const useReviewDiffStyle = () => useLayoutStore((s) => s.review.diffStyle)
export const useReviewPanelOpened = () =>
  useLayoutStore((s) => s.review.panelOpened)

export const useFileTree = () => useLayoutStore((s) => s.fileTree)
export const useFileTreeTab = () => useLayoutStore((s) => s.fileTree.tab)
export const useFileTreeOpened = () => useLayoutStore((s) => s.fileTree.opened)
export const useFileTreeWidth = () => useLayoutStore((s) => s.fileTree.width)

export const useSessionPane = () => useLayoutStore((s) => s.session)
export const useMobileSidebar = () => useLayoutStore((s) => s.mobileSidebar)
export const useMobileSidebarOpened = () =>
  useLayoutStore((s) => s.mobileSidebar.opened)

export const useSessionTabsFor = (sessionKey: string) =>
  useLayoutStore((s) => s.sessionTabs[sessionKey])
export const useSessionViewFor = (sessionKey: string) =>
  useLayoutStore((s) => s.sessionView[sessionKey])

export const useHandoffTabs = () => useLayoutStore((s) => s.handoff.tabs)
export const useRoute = (pathname: string, search: string): LayoutRoute =>
  currentRoute(pathname, search)

// ----------------------------------------------------------------------------
// Route resolution — ported verbatim so React routing layers can compute the
// same shape SolidJS derived from useLocation.
// ----------------------------------------------------------------------------

export function currentRoute(pathname: string, search: string): LayoutRoute {
  const parts = pathname.split("/").filter(Boolean)
  if (parts.length === 0) return { type: "home" }

  if (parts[0] === "new-session") {
    const draftID = new URLSearchParams(search).get("draftId")
    if (!draftID) return { type: "home" }
    return { type: "draft", draftID }
  }

  const dirBase64 = parts[0]
  const dir = safeDecode64(dirBase64)
  if (!dir) return { type: "home" }

  if (parts[1] !== "session") return { type: "home" }

  const id = parts[2]
  if (id) return { type: "session", dir, dirBase64, sessionId: id }
  return { type: "dir-new-sesssion", dir, dirBase64 }
}

export function safeDecode64(value: string): string | undefined {
  if (!value) return undefined
  try {
    if (typeof atob === "function") return atob(value)
    if (typeof Buffer !== "undefined") return Buffer.from(value, "base64").toString("utf-8")
  } catch {
    return undefined
  }
  return undefined
}