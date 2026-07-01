import React, { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createStore, useStore } from "zustand"

/**
 * Ported from OpenCode packages/app/src/context/global.tsx
 *
 * Tracks server selection (which server is the "settings" server, separate
 * from the active one) and per-server contexts. The Maximilian port keeps the
 * same shape but exposes a factory for consumers to register per-server
 * scoped data (QueryClient, SDK, sync).
 */

import { ServerConnection, type ServerContextValue, useServer } from "./server"

interface GlobalState {
  serverKey: ServerConnection.Key | undefined
  setServerKey: (next: ServerConnection.Key | undefined) => void
}

export const createGlobalStore = () =>
  createStore<GlobalState>()((set) => ({
    serverKey: undefined,
    setServerKey: (next) => set({ serverKey: next }),
  }))

export type GlobalStore = ReturnType<typeof createGlobalStore>

export interface ServerCtx {
  conn: ServerConnection.Any
  scope: string
  /** Opaque payload: SDK, sync, query client etc. populated by the consumer. */
  payload: unknown
  dispose: () => void
}

interface GlobalContextValue {
  store: GlobalStore
  /** Per-server contexts; keyed by ServerConnection.Key. */
  serverCtxs: Map<ServerConnection.Key, ServerCtx>
  /**
   * Register / fetch a per-server context. The first caller to register a
   * server creates the context; subsequent callers retrieve the cached one.
   */
  ensureServerCtx: (conn: ServerConnection.Any) => ServerCtx
  removeServerCtx: (key: ServerConnection.Key) => void
  /** Settings-server selection (the server used to read/write global settings). */
  settingsServer: () => ServerConnection.Any | undefined
}

const GlobalContext = createContext<GlobalContextValue | null>(null)

export interface GlobalProviderProps {
  children: ReactNode
  /**
   * Build the per-server context payload.  Receives the resolved connection
   * and the scope string, and returns an opaque payload plus a dispose hook.
   */
  buildServerCtx?: (conn: ServerConnection.Any, scope: string) => { payload: unknown; dispose: () => void }
}

export function GlobalProvider({ children, buildServerCtx }: GlobalProviderProps) {
  const server = useServer()
  const [store] = useState(() => createGlobalStore())
  const ctxsRef = useRef<Map<ServerConnection.Key, ServerCtx>>(new Map())

  function ensureServerCtx(conn: ServerConnection.Any): ServerCtx {
    const key = ServerConnection.key(conn)
    const existing = ctxsRef.current.get(key)
    if (existing) return existing
    const scope = server.scope(key)
    const built = buildServerCtx?.(conn, scope) ?? { payload: null, dispose: () => undefined }
    const next: ServerCtx = { conn, scope, payload: built.payload, dispose: built.dispose }
    ctxsRef.current.set(key, next)
    return next
  }

  function removeServerCtx(key: ServerConnection.Key) {
    const ctx = ctxsRef.current.get(key)
    if (!ctx) return
    ctx.dispose()
    ctxsRef.current.delete(key)
  }

  // Reactive: for every server currently in the list, ensure its context.
  const list = useStore(server.store, (s) => s.list)
  useEffect(() => {
    const servers = list as unknown as ServerConnection.Any[]
    // We don't have a direct `servers` array from the store; the resolution is
    // done by the consumer via server.list (computed).  Here we just ensure
    // that any stale entries are cleaned up.
    const validKeys = new Set<ServerConnection.Key>()
    for (const conn of servers) {
      if (conn && typeof conn === "object" && "type" in conn) {
        const key = ServerConnection.key(conn as ServerConnection.Any)
        validKeys.add(key)
        ensureServerCtx(conn as ServerConnection.Any)
      }
    }
    for (const key of [...ctxsRef.current.keys()]) {
      if (!validKeys.has(key)) removeServerCtx(key)
    }
  }, [list])

  // Sync settings server selection with the canonical local server.
  const defaultKey = server.defaultServer
  useEffect(() => {
    const unsub = server.store.subscribe((state, prev) => {
      if (state.list !== prev.list || state.active !== prev.active) {
        const list = server.list as unknown as ServerConnection.Any[]
        const first = list[0]
        const key = first ? ServerConnection.key(first) : undefined
        if (key !== store.getState().serverKey) store.getState().setServerKey(key)
      }
    })
    const initial = (server.list as unknown as ServerConnection.Any[])[0]
    if (initial) {
      const key = ServerConnection.key(initial)
      if (key !== store.getState().serverKey) store.getState().setServerKey(key)
    } else {
      store.getState().setServerKey(defaultKey)
    }
    return unsub
  }, [server, store, defaultKey])

  // Cleanup on unmount.
  useEffect(() => {
    const map = ctxsRef.current
    return () => {
      for (const ctx of map.values()) ctx.dispose()
      map.clear()
    }
  }, [])

  const settingsServer = (): ServerConnection.Any | undefined => {
    const key = store.getState().serverKey
    const list = server.list as unknown as ServerConnection.Any[]
    return list.find((conn) => ServerConnection.key(conn) === key) ?? list[0]
  }

  const value = useMemo<GlobalContextValue>(
    () => ({
      store,
      serverCtxs: ctxsRef.current,
      ensureServerCtx,
      removeServerCtx,
      settingsServer,
    }),
    [store],
  )

  return React.createElement(GlobalContext.Provider, { value }, children)
}

export function useGlobal(): GlobalContextValue {
  const ctx = useContext(GlobalContext)
  if (!ctx) throw new Error("useGlobal must be used within GlobalProvider")
  return ctx
}

export { ServerConnection }
export type { ServerContextValue }