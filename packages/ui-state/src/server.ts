import React, { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { createStore } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

/**
 * Ported from OpenCode packages/app/src/context/server.tsx
 *
 * SolidJS createStore -> Zustand
 * SolidJS createMemo -> useMemo
 * SolidJS Accessor<T> -> () => T
 */

type StoredProject = { worktree: string; expanded: boolean }
type StoredServer = string | ServerConnection.HttpBase | ServerConnection.Http
type ServerProjectState = { projects: Record<string, StoredProject[]>; lastProject: Record<string, string> }

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

export function serverName(conn?: ServerConnection.Any, ignoreDisplayName = false) {
  if (!conn) return ""
  if (conn.displayName && !ignoreDisplayName) return conn.displayName
  return conn.http.url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function migrateCanonicalLocalServerState(value: unknown, canonicalLocalServer?: ServerConnection.Key) {
  if (!canonicalLocalServer || canonicalLocalServer === "local") return value
  if (!isRecord(value)) return value
  const projects = isRecord(value.projects) ? value.projects : undefined
  const lastProject = isRecord(value.lastProject) ? value.lastProject : undefined
  const previousProjects = projects?.[canonicalLocalServer]
  const previousLastProject = lastProject?.[canonicalLocalServer]
  if (!Array.isArray(previousProjects) && typeof previousLastProject !== "string") return value

  const next: Record<string, unknown> = { ...value }
  if (projects && Array.isArray(previousProjects)) {
    const local = Array.isArray(projects.local) ? projects.local : []
    const worktrees = new Set(
      local.flatMap((project) =>
        isRecord(project) && typeof project.worktree === "string" ? [project.worktree] : [],
      ),
    )
    const migrated = previousProjects.filter((project) => {
      if (!isRecord(project) || typeof project.worktree !== "string") return true
      if (worktrees.has(project.worktree)) return false
      worktrees.add(project.worktree)
      return true
    })
    const nextProjects: Record<string, unknown> = { ...projects, local: [...local, ...migrated] }
    delete nextProjects[canonicalLocalServer]
    next.projects = nextProjects
  }
  if (lastProject && typeof previousLastProject === "string") {
    const nextLastProject = { ...lastProject }
    if (typeof nextLastProject.local !== "string") nextLastProject.local = previousLastProject
    delete nextLastProject[canonicalLocalServer]
    next.lastProject = nextLastProject
  }
  return next
}

export namespace ServerConnection {
  type Base = { displayName?: string; label?: string }

  export type HttpBase = {
    url: string
    username?: string
    password?: string
  }

  export type Http = {
    type: "http"
    http: HttpBase
    authToken?: boolean
  } & Base

  export type Sidecar = {
    type: "sidecar"
    http: HttpBase
  } & ({ variant: "base" } | { variant: "wsl"; distro: string }) &
    Base

  export type Ssh = {
    type: "ssh"
    host: string
    http: HttpBase
  } & Base

  export type Any = Http | (Sidecar | Ssh)

  export const key = (conn: Any): Key => {
    switch (conn.type) {
      case "http":
        return Key.make(conn.http.url)
      case "sidecar": {
        if (conn.variant === "wsl") return Key.make(`wsl:${conn.distro}`)
        return Key.make("sidecar")
      }
      case "ssh":
        return Key.make(`ssh:${conn.host}`)
    }
  }

  export type Key = string & { _brand: "Key" }
  export const Key = { make: (v: string) => v as Key }

  export const builtin = (conn: Any) => conn.type === "sidecar" && conn.variant === "base"
  export const local = (conn?: Any) =>
    !!conn && (builtin(conn) || (conn.type === "http" && isLocalHost(conn.http.url) === "local"))
}

export function nextServerAfterRemoval(
  servers: ServerConnection.Any[],
  removed: ServerConnection.Key,
  fallback: ServerConnection.Key,
) {
  const remaining = servers.filter((server) => ServerConnection.key(server) !== removed)
  const next = remaining.find((server) => ServerConnection.key(server) === fallback) ?? remaining[0]
  return next ? ServerConnection.key(next) : fallback
}

export function resolveServerList(input: {
  props?: Array<ServerConnection.Any>
  stored: StoredServer[]
}): Array<ServerConnection.Any> {
  const deduped = new Map<ServerConnection.Key, ServerConnection.Any>(
    input.props?.map((v) => [ServerConnection.key(v), v]) ?? [],
  )

  for (const value of input.stored) {
    const conn: ServerConnection.Http =
      typeof value === "string"
        ? { type: "http" as const, http: { url: value } }
        : "http" in value
          ? value
          : { type: "http", http: value }
    const key = ServerConnection.key(conn)

    const existing = deduped.get(key)
    if (existing)
      deduped.set(key, {
        ...existing,
        ...conn,
        http: { ...existing.http, ...conn.http },
      })
    else deduped.set(key, conn)
  }

  return [...deduped.values()]
}

interface ServerState {
  ready: boolean
  list: StoredServer[]
  projects: Record<string, StoredProject[]>
  lastProject: Record<string, string>
  active: ServerConnection.Key
  setActive: (next: ServerConnection.Key) => void
  setList: (next: StoredServer[]) => void
  upsertProject: (scope: string, project: StoredProject) => void
  removeProject: (scope: string, worktree: string) => void
  updateProject: (scope: string, worktree: string, patch: Partial<StoredProject>) => void
  moveProject: (scope: string, worktree: string, toIndex: number) => void
  touchLastProject: (scope: string, worktree: string) => void
}

function undefinedStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  }
}

export const createServerStore = (params: {
  defaultServer: ServerConnection.Key
  canonicalLocalServer?: ServerConnection.Key
  migrate?: (value: unknown) => unknown
}) => {
  return createStore<ServerState>()(
    persist(
      (set, get) => ({
        ready: false,
        list: [],
        projects: {},
        lastProject: {},
        active: params.defaultServer,
        setActive: (next) => {
          if (get().active !== next) set({ active: next })
        },
        setList: (next) => set({ list: next }),
        upsertProject: (scope, project) => {
          const projects = get().projects
          const current = projects[scope] ?? []
          if (current.some((p) => p.worktree === project.worktree)) return
          set({ projects: { ...projects, [scope]: [project, ...current] } })
        },
        removeProject: (scope, worktree) => {
          const projects = get().projects
          const current = projects[scope] ?? []
          set({ projects: { ...projects, [scope]: current.filter((p) => p.worktree !== worktree) } })
        },
        updateProject: (scope, worktree, patch) => {
          const projects = get().projects
          const current = projects[scope] ?? []
          const idx = current.findIndex((p) => p.worktree === worktree)
          if (idx === -1) return
          const next = [...current]
          next[idx] = { ...next[idx], ...patch }
          set({ projects: { ...projects, [scope]: next } })
        },
        moveProject: (scope, worktree, toIndex) => {
          const projects = get().projects
          const current = projects[scope] ?? []
          const fromIndex = current.findIndex((p) => p.worktree === worktree)
          if (fromIndex === -1 || fromIndex === toIndex) return
          const next = [...current]
          const [item] = next.splice(fromIndex, 1)
          next.splice(toIndex, 0, item)
          set({ projects: { ...projects, [scope]: next } })
        },
        touchLastProject: (scope, worktree) => {
          set({ lastProject: { ...get().lastProject, [scope]: worktree } })
        },
      }),
      {
        name: "server.v3",
        storage: createJSONStorage(() => (typeof localStorage !== "undefined" ? localStorage : undefinedStorage())),
        migrate: (value) => (params.migrate ? params.migrate(value) : value),
        onRehydrateStorage: () => (state) => {
          if (state) state.ready = true
        },
      },
    ),
  )
}

export type ServerStore = ReturnType<typeof createServerStore>

export interface ServerContextValue {
  store: ServerStore
  defaultServer: ServerConnection.Key
  canonicalLocalServer?: ServerConnection.Key
  propsServers?: Array<ServerConnection.Any>
  scope: (key?: ServerConnection.Key) => string
  list: Array<ServerConnection.Any>
}

const ServerContext = createContext<ServerContextValue | null>(null)

export interface ServerProviderProps {
  defaultServer: ServerConnection.Key
  canonicalLocalServer?: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  children: ReactNode
}

export function ServerProvider({ defaultServer, canonicalLocalServer, servers, children }: ServerProviderProps) {
  const [store] = useState(() =>
    createServerStore({
      defaultServer,
      canonicalLocalServer,
      migrate: (value) => migrateCanonicalLocalServerState(value, canonicalLocalServer),
    }),
  )

  const value = useMemo<ServerContextValue>(
    () => ({
      store,
      defaultServer,
      canonicalLocalServer,
      propsServers: servers,
      scope: (key?: ServerConnection.Key) => key ?? store.getState().active,
      get list() {
        return resolveServerList({ stored: store.getState().list, props: servers })
      },
    }),
    [store, defaultServer, canonicalLocalServer, servers],
  )

  return React.createElement(ServerContext.Provider, { value }, children)
}

export function useServer(): ServerContextValue {
  const ctx = useContext(ServerContext)
  if (!ctx) throw new Error("useServer must be used within ServerProvider")
  return ctx
}

const urlOf = (x: StoredServer) => (typeof x === "string" ? x : "type" in x ? x.http.url : x.url)

function projectsForScope(store: ServerStore, scope: string) {
  return {
    list: () => store.getState().projects[scope] ?? [],
    open: (directory: string) => store.getState().upsertProject(scope, { worktree: directory, expanded: true }),
    close: (directory: string) => store.getState().removeProject(scope, directory),
    expand: (directory: string) => store.getState().updateProject(scope, directory, { expanded: true }),
    collapse: (directory: string) => store.getState().updateProject(scope, directory, { expanded: false }),
    move: (directory: string, toIndex: number) => store.getState().moveProject(scope, directory, toIndex),
    last: () => store.getState().lastProject[scope],
    touch: (directory: string) => store.getState().touchLastProject(scope, directory),
  }
}

/**
 * Helper facade mirroring SolidJS Accessor<T> helpers so existing call sites can
 * be ported with minimal change.
 */
export function buildServerFacade(ctx: ServerContextValue) {
  const { store, defaultServer, propsServers } = ctx

  function allServers(): Array<ServerConnection.Any> {
    return resolveServerList({ stored: store.getState().list, props: propsServers })
  }

  function currentServer(): ServerConnection.Any | undefined {
    const servers = allServers()
    const active = store.getState().active
    return servers.find((s) => ServerConnection.key(s) === active) ?? servers[0]
  }

  const projects = {
    ...projectsForScope(store, store.getState().active),
    forServer: (key: ServerConnection.Key) => projectsForScope(store, key),
  }

  return {
    ready: () => store.getState().ready && !!store.getState().active,
    isLocal: () => ServerConnection.local(currentServer()),
    get key() {
      return store.getState().active
    },
    get name() {
      return serverName(currentServer())
    },
    get list() {
      return allServers()
    },
    get current() {
      return currentServer()
    },
    setActive(input: ServerConnection.Key) {
      store.getState().setActive(input)
    },
    add(input: ServerConnection.Http) {
      const url_ = normalizeServerUrl(input.http.url)
      if (!url_) return
      const conn: ServerConnection.Http = { ...input, authToken: undefined, http: { ...input.http, url: url_ } }
      const state = store.getState()
      const existing = state.list.findIndex((x) => urlOf(x) === url_)
      if (existing !== -1) {
        const next = [...state.list]
        next[existing] = conn
        state.setList(next)
      } else {
        state.setList([...state.list, conn])
      }
      state.setActive(ServerConnection.key(conn))
      return conn
    },
    remove(key: ServerConnection.Key) {
      const state = store.getState()
      const next = nextServerAfterRemoval(allServers(), key, defaultServer)
      state.setList(state.list.filter((x) => urlOf(x) !== key))
      if (state.active === key) state.setActive(next)
    },
    scope(key = store.getState().active) {
      return key
    },
    projects,
  }
}