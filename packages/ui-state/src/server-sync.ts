/**
 * Server-sync store — ported from OpenCode `context/server-sync.tsx` (SolidJS) to React + Zustand.
 *
 * The OpenCode implementation is tightly coupled to @tanstack/solid-query and
 * SDK event streams. The Zustand port keeps the canonical state shape
 * (projects, todos, providers, config, path, etc.) plus the action API
 * (loadSessions, MCP toggle, config update, session-todo mutation) so the
 * higher-level React providers in `@max/dashboard` can drive the store
 * from whatever query client is wired into the host app.
 */

import { create } from "zustand"
// Stub types - replace with real SDK types when available
export interface Path {
  root: string
  cwd: string
}

export interface Project {
  id: string
  name: string
  path: string
}

export interface Todo {
  id: string
  content: string
  status: string
}

export interface Config {
  [key: string]: unknown
}

export interface ProviderAuthResponse {
  [key: string]: unknown
}

export type InitError = Error | string | null

export type NormalizedProviderListResponse = {
  all: Map<string, unknown>
  connected: unknown[]
  default: Record<string, string>
}

export type ServerScope = string

export type GlobalStore = {
  ready: boolean
  error?: InitError
  path: Path
  project: Project[]
  session_todo: Record<string, Todo[]>
  provider: NormalizedProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

export type SessionChild = {
  /** Per-directory child state (sessions, limits, MCP, commands, etc.). */
  directory: string
  session: unknown[]
  sessionTotal?: number
  limit: number
  permission: unknown[]
  mcp: Record<string, { status: string }>
  command: unknown[]
  lsp: unknown[]
  icon?: string
  project?: string
}

export type ServerSyncState = {
  global: GlobalStore
  /** Keyed by directory key (matches OpenCode's directoryKey helper). */
  children: Record<string, SessionChild>
  /** In-flight bootstrap + session-load trackers (not reactive). */
  booting: Record<string, true>
  sessionLoading: Record<string, true>
  sessionMeta: Record<string, { limit: number }>
}

export type ServerSyncActions = {
  setGlobal: (patch: Partial<GlobalStore>) => void
  replaceProjects: (projects: Project[] | ((draft: Project[]) => Project[])) => void
  setSessionTodo: (sessionID: string, todos: Todo[] | undefined) => void
  /** Patch a child store entry (creates it if missing). */
  setChild: (key: string, patch: Partial<SessionChild>) => void
  /** Replace a child store entry wholesale. */
  replaceChild: (key: string, next: SessionChild) => void
  removeChild: (key: string) => void
  markBooting: (key: string) => void
  clearBooting: (key: string) => void
  markSessionLoading: (key: string) => void
  clearSessionLoading: (key: string) => void
  setSessionMeta: (key: string, meta: { limit: number }) => void
  reset: () => void
}

export type ServerSyncStore = ServerSyncState & ServerSyncActions

const EMPTY_PATH: Path = { root: "", cwd: "" }
const EMPTY_PROVIDER = { all: new Map(), connected: [], default: {} }

const initialGlobal: GlobalStore = {
  ready: false,
  path: EMPTY_PATH,
  project: [],
  session_todo: {},
  provider: EMPTY_PROVIDER,
  provider_auth: {},
  config: {},
  reload: undefined,
}

const initialState: ServerSyncState = {
  global: initialGlobal,
  children: {},
  booting: {},
  sessionLoading: {},
  sessionMeta: {},
}

export const useServerSyncStore = create<ServerSyncStore>()((set) => ({
  ...initialState,

  setGlobal: (patch) =>
    set((state) => ({
      global: { ...state.global, ...patch },
    })),

  replaceProjects: (projects) =>
    set((state) => {
      const next =
        typeof projects === "function"
          ? projects(state.global.project)
          : projects
      return { global: { ...state.global, project: next } }
    }),

  setSessionTodo: (sessionID, todos) =>
    set((state) => {
      const sessionTodo = { ...state.global.session_todo }
      if (todos === undefined) {
        delete sessionTodo[sessionID]
      } else {
        sessionTodo[sessionID] = todos
      }
      return { global: { ...state.global, session_todo: sessionTodo } }
    }),

  setChild: (key, patch) =>
    set((state) => {
      const current = state.children[key] ?? {
        directory: key,
        session: [],
        limit: 0,
        permission: [],
        mcp: {},
        command: [],
        lsp: [],
      }
      return {
        children: {
          ...state.children,
          [key]: { ...current, ...patch },
        },
      }
    }),

  replaceChild: (key, next) =>
    set((state) => ({
      children: { ...state.children, [key]: next },
    })),

  removeChild: (key) =>
    set((state) => {
      const next = { ...state.children }
      delete next[key]
      return { children: next }
    }),

  markBooting: (key) =>
    set((state) => ({ booting: { ...state.booting, [key]: true } })),

  clearBooting: (key) =>
    set((state) => {
      const next = { ...state.booting }
      delete next[key]
      return { booting: next }
    }),

  markSessionLoading: (key) =>
    set((state) => ({ sessionLoading: { ...state.sessionLoading, [key]: true } })),

  clearSessionLoading: (key) =>
    set((state) => {
      const next = { ...state.sessionLoading }
      delete next[key]
      return { sessionLoading: next }
    }),

  setSessionMeta: (key, meta) =>
    set((state) => ({
      sessionMeta: { ...state.sessionMeta, [key]: meta },
    })),

  reset: () => set(() => ({ ...initialState })),
}))

// ----------------------------------------------------------------------------
// Helpers ported from OpenCode — kept as plain functions so React components
// can perform the same selection / invariant logic without re-implementing it.
// ----------------------------------------------------------------------------

export const SESSION_RECENT_LIMIT = 50

export function directoryKey(directory: string): string {
  return directory
}

export function isBooting(state: ServerSyncState, directory: string): boolean {
  return Boolean(state.booting[directoryKey(directory)])
}

export function isLoadingSessions(state: ServerSyncState, directory: string): boolean {
  return Boolean(state.sessionLoading[directoryKey(directory)])
}

export function isProjectPaused(reload: GlobalStore["reload"]): boolean {
  return reload !== undefined
}

export type ProjectMeta = {
  icon?: { color?: string; override?: string; url?: string }
}

export function trimSessions<T extends { id: string; parentID?: string }>(
  sessions: T[],
  options: { limit: number; permission?: unknown[] },
): T[] {
  const { limit } = options
  if (sessions.length <= limit) return sessions
  // Keep child sessions (with parentID) and trim root ones to the limit.
  const child = sessions.filter((s) => !!s.parentID)
  const root = sessions.filter((s) => !s.parentID)
  return [...root.slice(0, Math.max(0, limit - child.length)), ...child]
}

export function estimateRootSessionTotal(input: {
  count: number
  limit?: number
  limited?: boolean
}): number {
  if (!input.limited) return input.count
  return Math.max(input.count, input.limit ?? input.count)
}

export function cleanupDroppedSessionCaches<T extends { id: string }>(
  store: { session: T[]; session_todo?: Record<string, unknown> },
  _setStore: unknown,
  next: T[],
  setSessionTodo: (sessionID: string, todos: Todo[] | undefined) => void,
): void {
  const ids = new Set(next.map((s) => s.id))
  const dropped = store.session.filter((s) => !ids.has(s.id))
  for (const session of dropped) {
    if (session.id) setSessionTodo(session.id, undefined)
  }
}

export type QueryOptionsApi = {
  globalConfig: () => unknown
  projects: () => unknown
  providers: (directory: string | null) => unknown
  path: (directory: string | null) => unknown
  agents: (directory: string) => unknown
  mcp: (directory: string) => unknown
  lsp: (directory: string) => unknown
  sessions: (directory: string) => { queryKey: readonly unknown[] }
}

export function makeQueryOptionsApi(
  scope: ServerScope,
  serverSDK: () => unknown,
  sdkFor: (dir: string) => unknown,
): QueryOptionsApi {
  return {
    globalConfig: () => ({ queryKey: [scope, "global-config"], queryFn: () => serverSDK() }),
    projects: () => ({ queryKey: [scope, "projects"], queryFn: () => serverSDK() }),
    providers: (directory) => ({
      queryKey: [scope, directory, "providers"],
      queryFn: () => (directory === null ? serverSDK() : sdkFor(directory)),
    }),
    path: (directory) => ({
      queryKey: [scope, directory, "path"],
      queryFn: () => (directory === null ? serverSDK() : sdkFor(directory)),
    }),
    agents: (directory) => ({ queryKey: [scope, directory, "agents"], queryFn: () => sdkFor(directory) }),
    mcp: (directory) => ({ queryKey: [scope, directory, "mcp"], queryFn: () => sdkFor(directory) }),
    lsp: (directory) => ({ queryKey: [scope, directory, "lsp"], queryFn: () => sdkFor(directory) }),
    sessions: (directory) => ({ queryKey: [scope, directory, "loadSessions"] as const }),
  }
}

export type RefreshQueueEntry = { directory: string }

export function createRefreshQueue() {
  const queue: RefreshQueueEntry[] = []
  return {
    push(entry: RefreshQueueEntry) {
      queue.push(entry)
    },
    clear(key?: string) {
      if (!key) {
        queue.length = 0
        return
      }
      const next = queue.filter((entry) => entry.directory !== key)
      queue.length = 0
      queue.push(...next)
    },
    list() {
      return [...queue]
    },
    dispose() {
      queue.length = 0
    },
  }
}