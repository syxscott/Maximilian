/**
 * Sync store that bridges the API client with Zustand state.
 *
 * Mirrors OpenCode's `server-sync.tsx`:
 *  - A single global store that holds the high-level server metadata
 *    (`config`, `provider`, `path`, `project`, `session_todo`, etc.).
 *  - A per-directory child store manager that lazily boots a directory,
 *    caches its sessions / messages / mcp status, and re-uses it across
 *    consumers.
 *  - An SSE consumer that pumps server events into the store via
 *    `applyGlobalEvent` / `applyDirectoryEvent` reducers.
 *
 * In OpenCode this is built on `solid-js/store` + `@tanstack/solid-query`
 * + a `createChildStoreManager` that uses SolidJS's `getOwner` for
 * resource lifetime tracking. In React/Zustand we replace those with:
 *  - Plain `useState` / `useEffect` for the manager (no owner tracking;
 *    consumers wrap with their own provider and rely on
 *    `useSyncExternalStore` semantics inside Zustand).
 *  - A small `queryClient` interface that callers can plug TanStack Query
 *    into or replace with any cache they prefer. By default we provide
 *    a `Map`-backed cache so the module is dependency-free.
 *  - A typed event reducer (`applyEvent`) that uses the same keys
 *    (`session.status:<dir>:<id>`, `message.part.updated:<dir>:<mid>:<pid>`)
 *    for coalescing.
 *
 * The goal is parity at the API level: anyone who has used OpenCode's
 * `useServerSync` can switch to `useSyncStore()` and get the same shape.
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { createStore } from "zustand"
import { createApiClient, type ApiClient, type ApiClientConfig, type MethodMap } from "./api"
import { reconcile, reconcileArray } from "./utils/reconcile"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServerEvent = {
  type: string
  properties?: Record<string, unknown>
}

export type QueuedServerEvent = { directory: string; payload: ServerEvent }

export type SessionStatus = { type: string; [key: string]: unknown }

export type Provider = { id: string; name?: string; [key: string]: unknown }

export type NormalizedProviderListResponse = {
  all: Map<string, Provider>
  default: Record<string, string>
  connected: string[]
}

export type Project = { id?: string; worktree: string; [key: string]: unknown }

export type Session = { id: string; parentID?: string; title?: string; [key: string]: unknown }

export type Message = { id: string; sessionID: string; [key: string]: unknown }

export type Part = { id: string; messageID: string; sessionID: string; [key: string]: unknown }

export type Todo = { id: string; content: string; status: string; priority?: string }

export type McpStatus = { status: "connected" | "disconnected" | "error"; [key: string]: unknown }

export type GlobalStoreShape = {
  ready: boolean
  error?: { message: string }
  path: { state: string; config: string; worktree: string; directory: string; home: string }
  project: Project[]
  session_todo: Record<string, Todo[]>
  provider: NormalizedProviderListResponse
  provider_auth: Record<string, unknown>
  config: Record<string, unknown>
  reload: undefined | "pending" | "complete"
}

export type DirectoryStoreShape = {
  ready: boolean
  session: Session[]
  session_status: Record<string, SessionStatus>
  message: Record<string, Message[]>
  part: Record<string, Part[]>
  part_text_accum_delta: Record<string, string>
  mcp: Record<string, { status: McpStatus }>
  command: string[]
  limit: number
  sessionTotal: number
}

export const SESSION_RECENT_LIMIT = 50

// ---------------------------------------------------------------------------
// Query client interface
// ---------------------------------------------------------------------------

export type QueryKey = readonly unknown[]
export type QueryOptions<T> = { queryKey: QueryKey; queryFn: () => Promise<T> }
export type QueryClientLike = {
  fetchQuery<T>(opts: QueryOptions<T>): Promise<T>
  refetchQueries(opts: { queryKey: QueryKey }): Promise<unknown>
  invalidateQueries(predicate: (q: { queryKey: QueryKey }) => boolean): void
  setQueryData<T>(key: QueryKey, value: T): void
  getQueryData<T>(key: QueryKey): T | undefined
}

/**
 * Minimal in-memory query client. Mirrors the small subset of
 * `@tanstack/query-core` we use; the user can replace it with the real
 * client if they already use TanStack Query.
 */
export function createMemoryQueryClient(): QueryClientLike {
  const cache = new Map<string, unknown>()
  return {
    async fetchQuery(opts) {
      const key = JSON.stringify(opts.queryKey)
      if (cache.has(key)) return cache.get(key) as Awaited<ReturnType<typeof opts.queryFn>>
      const result = await opts.queryFn()
      cache.set(key, result)
      return result
    },
    async refetchQueries(opts) {
      const key = JSON.stringify(opts.queryKey)
      cache.delete(key)
      return undefined
    },
    invalidateQueries(predicate) {
      for (const k of Array.from(cache.keys())) {
        try {
          const parsed = JSON.parse(k) as QueryKey
          if (predicate({ queryKey: parsed })) cache.delete(k)
        } catch {
          // ignore malformed keys
        }
      }
    },
    setQueryData(key, value) {
      cache.set(JSON.stringify(key), value)
    },
    getQueryData(key) {
      return cache.get(JSON.stringify(key)) as never
    },
  }
}

// ---------------------------------------------------------------------------
// Event bus — scope + replay buffer (mirrors crewAI's EventBus scopes)
// ---------------------------------------------------------------------------

const REPLAY_BUFFER_LIMIT = 64

export type Scope = "global" | "session" | "workspace"

/**
 * A small in-process event bus with per-scope fan-out and a bounded replay
 * buffer. New subscribers can ask for the last `replay` events on their
 * scope, so that a freshly-mounted UI / reconnected SSE consumer can
 * re-render from local history without missing updates that arrived
 * between disconnect and re-subscribe.
 *
 * The implementation is intentionally tiny: a Map<scope, handlers> plus a
 * per-scope ring buffer of recent events. No async primitives — the bus
 * is purely synchronous, callers can decide whether to batch with their
 * own scheduler.
 */
export type ScopedBusEvent<T> = {
  scope: Scope
  scopeKey: string
  payload: T
  ts: number
}

export type ScopedBus = {
  emit: <T>(scope: Scope, scopeKey: string, payload: T) => void
  subscribe: <T>(
    scope: Scope,
    scopeKey: string,
    handler: (event: ScopedBusEvent<T>) => void,
    opts?: { replay?: number },
  ) => () => void
  recent: <T>(scope: Scope, scopeKey: string) => ScopedBusEvent<T>[]
  clear: (scope?: Scope, scopeKey?: string) => void
}

function bufferKey(scope: Scope, scopeKey: string): string {
  return `${scope}:${scopeKey}`
}

export function createScopedBus(): ScopedBus {
  const handlers = new Map<string, Set<(event: ScopedBusEvent<unknown>) => void>>()
  const recent = new Map<string, ScopedBusEvent<unknown>[]>()

  function emit<T>(scope: Scope, scopeKey: string, payload: T): void {
    const k = bufferKey(scope, scopeKey)
    const evt: ScopedBusEvent<T> = { scope, scopeKey, payload, ts: Date.now() }
    // Append to ring buffer for replay.
    let buf = recent.get(k)
    if (!buf) {
      buf = []
      recent.set(k, buf)
    }
    buf.push(evt as ScopedBusEvent<unknown>)
    if (buf.length > REPLAY_BUFFER_LIMIT) buf.splice(0, buf.length - REPLAY_BUFFER_LIMIT)
    // Fan out to live handlers synchronously; failures must not poison the bus.
    const subs = handlers.get(k)
    if (subs) {
      for (const h of [...subs]) {
        try {
          h(evt as ScopedBusEvent<unknown>)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("ScopedBus handler error", err)
        }
      }
    }
  }

  function subscribe<T>(
    scope: Scope,
    scopeKey: string,
    handler: (event: ScopedBusEvent<T>) => void,
    opts?: { replay?: number },
  ): () => void {
    const k = bufferKey(scope, scopeKey)
    let subs = handlers.get(k)
    if (!subs) {
      subs = new Set()
      handlers.set(k, subs)
    }
    const wrapped = handler as (event: ScopedBusEvent<unknown>) => void
    subs.add(wrapped)
    // Replay last N events synchronously before returning.
    const replay = Math.max(0, opts?.replay ?? 0)
    if (replay > 0) {
      const buf = recent.get(k) ?? []
      const slice = buf.slice(-replay)
      for (const evt of slice) {
        try {
          wrapped(evt)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("ScopedBus replay error", err)
        }
      }
    }
    return () => {
      const current = handlers.get(k)
      if (current) {
        current.delete(wrapped)
        if (current.size === 0) handlers.delete(k)
      }
    }
  }

  function recentList<T>(scope: Scope, scopeKey: string): ScopedBusEvent<T>[] {
    return (recent.get(bufferKey(scope, scopeKey)) ?? []) as ScopedBusEvent<T>[]
  }

  function clear(scope?: Scope, scopeKey?: string): void {
    if (!scope) {
      handlers.clear()
      recent.clear()
      return
    }
    if (!scopeKey) {
      const prefix = `${scope}:`
      for (const k of [...handlers.keys()]) if (k.startsWith(prefix)) handlers.delete(k)
      for (const k of [...recent.keys()]) if (k.startsWith(prefix)) recent.delete(k)
      return
    }
    const k = bufferKey(scope, scopeKey)
    handlers.delete(k)
    recent.delete(k)
  }

  return { emit, subscribe, recent: recentList, clear }
}

// ---------------------------------------------------------------------------
// Event coalescing (mirrors OpenCode's coalesceServerEvents)
// ---------------------------------------------------------------------------

const deltaKey = (directory: string, messageID: string, partID: string) =>
  `${directory}:${messageID}:${partID}`

const key = (directory: string, payload: ServerEvent): string | undefined => {
  if (payload.type === "session.status") {
    const sid = (payload.properties?.sessionID as string) ?? ""
    return `session.status:${directory}:${sid}`
  }
  if (payload.type === "lsp.updated") return `lsp.updated:${directory}`
  if (payload.type === "message.part.updated") {
    const part = (payload.properties?.part as Part | undefined) ?? ({} as Part)
    return `message.part.updated:${directory}:${part.messageID ?? ""}:${part.id ?? ""}`
  }
  if (payload.type === "message.part.delta") {
    const props = payload.properties ?? {}
    return `message.part.delta:${directory}:${(props.messageID as string) ?? ""}:${(props.partID as string) ?? ""}:${(props.field as string) ?? ""}`
  }
  return undefined
}

function coalesceServerEvents(
  events: QueuedServerEvent[],
): QueuedServerEvent[] {
  const out: QueuedServerEvent[] = []
  const indexByKey = new Map<string, number>()
  for (const event of events) {
    const k = key(event.directory, event.payload)
    if (k) {
      const existing = indexByKey.get(k)
      if (existing !== undefined) {
        const prev = out[existing]!
        if (prev.payload.type === "message.part.delta" && event.payload.type === "message.part.delta") {
          const prevDelta = (prev.payload.properties?.delta as string) ?? ""
          const nextDelta = (event.payload.properties?.delta as string) ?? ""
          prev.payload = {
            ...prev.payload,
            properties: { ...prev.payload.properties, delta: prevDelta + nextDelta },
          }
          continue
        }
        out[existing] = event
        continue
      }
      indexByKey.set(k, out.length)
    }
    out.push(event)
  }
  return out
}

// ---------------------------------------------------------------------------
// Change detection (mirrors crewAI's LockedDictProxy)
// ---------------------------------------------------------------------------

/**
 * Snapshot the entire draft (all own enumerable keys) before a mutator
 * runs, then compare by reference after to detect whether any field
 * actually changed. Returning `false` from `changed()` lets the caller
 * skip the Zustand `setState` entirely, preventing a spurious notify
 * for an event that mutated nothing material.
 *
 * We intentionally snapshot ALL keys (not a caller-supplied list) to
 * avoid the silent-data-loss bug where a mutator touches a key the
 * caller forgot to declare.
 */
function makeChangeTracker<T extends Record<string, unknown>>(): {
  snapshot: (draft: T) => void
  changed: (draft: T) => boolean
} {
  const before = new Map<keyof T, unknown>()
  return {
    snapshot(draft) {
      before.clear()
      for (const k of Object.keys(draft) as Array<keyof T>) {
        before.set(k, draft[k])
      }
    },
    changed(draft) {
      // Compare every key that was present in the snapshot, plus any new
      // keys that may have appeared (those are always changes).
      const seen = new Set<keyof T>()
      for (const k of Object.keys(draft) as Array<keyof T>) {
        seen.add(k)
        if (!Object.is(before.get(k), draft[k])) return true
      }
      // Detect removed keys.
      for (const k of before.keys()) {
        if (!seen.has(k)) return true
      }
      return false
    },
  }
}

type DirectoryStoreApi = ReturnType<typeof createDirectoryStore>

function createDirectoryStore(directory: string) {
  return createStore<DirectoryStoreShape>()((set, get) => ({
    ready: false,
    session: [],
    session_status: {},
    message: {},
    part: {},
    part_text_accum_delta: {},
    mcp: {},
    command: [],
    limit: 0,
    sessionTotal: 0,
    _directory: directory,
  } as DirectoryStoreShape & { _directory: string }))
}

function applyGlobalEvent(input: {
  event: ServerEvent
  store: GlobalStoreShape
  set: (mutator: (draft: GlobalStoreShape) => boolean) => void
}) {
  const { event, set } = input
  const tracker = makeChangeTracker<GlobalStoreShape>()
  const guard = (draft: GlobalStoreShape): boolean => tracker.changed(draft)
  switch (event.type) {
    case "project.updated": {
      const project = event.properties?.project as Project | undefined
      if (!project) return
      set((draft) => {
        tracker.snapshot(draft)
        const idx = draft.project.findIndex((p) => p.worktree === project.worktree)
        if (idx === -1) draft.project.push(project)
        else draft.project[idx] = { ...draft.project[idx], ...project }
        return guard(draft)
      })
      return
    }
    case "project.removed": {
      const worktree = event.properties?.worktree as string | undefined
      if (!worktree) return
      set((draft) => {
        tracker.snapshot(draft)
        draft.project = draft.project.filter((p) => p.worktree !== worktree)
        return guard(draft)
      })
      return
    }
    case "session.todo.updated": {
      const sessionID = event.properties?.sessionID as string | undefined
      const todos = event.properties?.todos as Todo[] | undefined
      if (!sessionID) return
      set((draft) => {
        tracker.snapshot(draft)
        if (!todos) delete draft.session_todo[sessionID]
        else draft.session_todo[sessionID] = reconcileArray(draft.session_todo[sessionID], todos, "id")
        return guard(draft)
      })
      return
    }
    default:
      return
  }
}

function applyDirectoryEvent(input: {
  directory: string
  event: ServerEvent
  store: DirectoryStoreShape
  set: (mutator: (draft: DirectoryStoreShape) => boolean) => void
}) {
  const { event, set } = input
  const tracker = makeChangeTracker<DirectoryStoreShape>()
  const guard = (draft: DirectoryStoreShape): boolean => tracker.changed(draft)
  switch (event.type) {
    case "session.updated": {
      const session = event.properties?.session as Session | undefined
      if (!session) return
      set((draft) => {
        tracker.snapshot(draft)
        draft.session = reconcileArray(draft.session, [session], "id")
        return guard(draft)
      })
      return
    }
    case "session.removed": {
      const sessionID = event.properties?.sessionID as string | undefined
      if (!sessionID) return
      set((draft) => {
        tracker.snapshot(draft)
        draft.session = draft.session.filter((s) => s.id !== sessionID)
        delete draft.session_status[sessionID]
        delete draft.message[sessionID]
        return guard(draft)
      })
      return
    }
    case "session.status": {
      const sessionID = event.properties?.sessionID as string | undefined
      const status = event.properties?.status as SessionStatus | undefined
      if (!sessionID || !status) return
      set((draft) => {
        tracker.snapshot(draft)
        draft.session_status[sessionID] = status
        return guard(draft)
      })
      return
    }
    case "message.updated": {
      const message = event.properties?.message as Message | undefined
      if (!message) return
      set((draft) => {
        tracker.snapshot(draft)
        const list = draft.message[message.sessionID] ?? []
        draft.message[message.sessionID] = reconcileArray(list, [message], "id")
        return guard(draft)
      })
      return
    }
    case "message.removed": {
      const sessionID = event.properties?.sessionID as string | undefined
      const messageID = event.properties?.messageID as string | undefined
      if (!sessionID || !messageID) return
      set((draft) => {
        tracker.snapshot(draft)
        const list = draft.message[sessionID]
        if (list) draft.message[sessionID] = list.filter((m) => m.id !== messageID)
        delete draft.part[messageID]
        return guard(draft)
      })
      return
    }
    case "message.part.updated": {
      const part = event.properties?.part as Part | undefined
      if (!part) return
      set((draft) => {
        tracker.snapshot(draft)
        const list = draft.part[part.messageID] ?? []
        draft.part[part.messageID] = reconcileArray(list, [part], "id")
        return guard(draft)
      })
      return
    }
    case "message.part.delta": {
      const partID = event.properties?.partID as string | undefined
      const field = (event.properties?.field as string) ?? "text"
      const delta = (event.properties?.delta as string) ?? ""
      if (!partID) return
      set((draft) => {
        tracker.snapshot(draft)
        const key = `${partID}:${field}`
        draft.part_text_accum_delta[key] = (draft.part_text_accum_delta[key] ?? "") + delta
        return guard(draft)
      })
      return
    }
    case "message.part.removed": {
      const messageID = event.properties?.messageID as string | undefined
      const partID = event.properties?.partID as string | undefined
      if (!messageID || !partID) return
      set((draft) => {
        tracker.snapshot(draft)
        const list = draft.part[messageID]
        if (list) draft.part[messageID] = list.filter((p) => p.id !== partID)
        return guard(draft)
      })
      return
    }
    case "lsp.updated": {
      // LSP updates are handled via a query refetch in the manager; nothing
      // to do inline.
      return
    }
    default:
      return
  }
}

// ---------------------------------------------------------------------------
// Child store manager (per-directory state)
// ---------------------------------------------------------------------------

export type ChildStoreManagerOptions = {
  global: GlobalStoreShape
  queryClient: QueryClientLike
  onDispose?: (directory: string) => void
  scope: string
}

export function createChildStoreManager(options: ChildStoreManagerOptions) {
  const children = new Map<string, { store: DirectoryStoreApi; refcount: number }>()

  function child(directory: string): DirectoryStoreApi {
    let entry = children.get(directory)
    if (!entry) {
      entry = { store: createDirectoryStore(directory), refcount: 0 }
      children.set(directory, entry)
    }
    entry.refcount += 1
    return entry.store
  }

  function release(directory: string) {
    const entry = children.get(directory)
    if (!entry) return
    entry.refcount -= 1
    if (entry.refcount <= 0) {
      children.delete(directory)
      options.onDispose?.(directory)
    }
  }

  function list(): string[] {
    return [...children.keys()]
  }

  return { child, release, list }
}

// ---------------------------------------------------------------------------
// Sync store factory
// ---------------------------------------------------------------------------

export type SyncStoreOptions = {
  apiConfig: ApiClientConfig
  queryClient?: QueryClientLike
  scope?: string
  onError?: (error: unknown) => void
}

export type SyncStore = {
  global: ReturnType<typeof createGlobalStore>
  child: (directory: string) => DirectoryStoreApi
  release: (directory: string) => void
  bootstrap: () => Promise<void>
  apply: (directory: string, event: ServerEvent) => void
  start: () => void
  stop: () => void
  api: ApiClient<MethodMap>
  queryClient: QueryClientLike
  scope: string
  bus: ScopedBus
}

function createGlobalStore(initial: Partial<GlobalStoreShape> = {}) {
  return createStore<GlobalStoreShape>()((set) => ({
    ready: false,
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    project: [],
    session_todo: {},
    provider: { all: new Map(), default: {}, connected: [] },
    provider_auth: {},
    config: {},
    reload: undefined,
    ...initial,
  }))
}

export function createSyncStore(options: SyncStoreOptions): SyncStore {
  const scope = options.scope ?? "default"
  const queryClient = options.queryClient ?? createMemoryQueryClient()
  const api = createApiClient(options.apiConfig)
  const global = createGlobalStore()
  const manager = createChildStoreManager({
    global: global.getState(),
    queryClient,
    scope,
  })
  const bus = createScopedBus()
  let started = false
  let stopFn: (() => void) | undefined

  function set(mutator: (draft: GlobalStoreShape) => boolean) {
    global.setState((prev) => {
      const draft: GlobalStoreShape = { ...prev }
      const changed = mutator(draft)
      // crewAI LockedDictProxy-style guard: when the mutator reports no
      // reference changed, return the previous state so Zustand's
      // default reference-equality check skips notification.
      return changed ? draft : prev
    })
  }

  async function bootstrap() {
    try {
      // Pre-warm a few top-level queries. Each is cached in `queryClient`
      // so subsequent reads are synchronous.
      const [config, provider, path] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: [scope, "global", "config"] as const,
          queryFn: async () => (await api.request("GET", "/config", {})).data ?? {},
        }),
        queryClient.fetchQuery({
          queryKey: [scope, "global", "providers"] as const,
          queryFn: async () => (await api.request("GET", "/config/providers", {})).data ?? {
            all: {},
            default: {},
            connected: [],
          },
        }),
        queryClient.fetchQuery({
          queryKey: [scope, "global", "path"] as const,
          queryFn: async () => (await api.request("GET", "/path", {})).data ?? {
            state: "",
            config: "",
            worktree: "",
            directory: "",
            home: "",
          },
        }),
      ])
      const normalized: NormalizedProviderListResponse = {
        all: new Map(Object.entries((provider as { all?: Record<string, Provider> })?.all ?? {})),
        default: (provider as { default?: Record<string, string> })?.default ?? {},
        connected: (provider as { connected?: string[] })?.connected ?? [],
      }
      global.setState({
        config: config as Record<string, unknown>,
        provider: normalized,
        path: path as GlobalStoreShape["path"],
        ready: true,
      })
    } catch (err) {
      options.onError?.(err)
      global.setState({
        error: { message: err instanceof Error ? err.message : String(err) },
        ready: true,
      })
    }
  }

  function apply(directory: string, event: ServerEvent) {
    if (directory === "global" || !directory) {
      applyGlobalEvent({
        event,
        store: global.getState(),
        set,
      })
      return
    }
    const childStore = manager.child(directory)
    try {
      applyDirectoryEvent({
        directory,
        event,
        store: childStore.getState(),
        set: (mutator) =>
          childStore.setState((prev) => {
            const draft: DirectoryStoreShape = { ...prev }
            const changed = mutator(draft)
            // crewAI LockedDictProxy-style guard: skip the update when the
            // mutator didn't change any tracked reference.
            return changed ? draft : prev
          }),
      })
    } finally {
      // Balance the refcount from child() above; apply() is ephemeral.
      manager.release(directory)
    }
  }

  function start() {
    if (started) return
    started = true
    const stream = api.event<{ directory?: string; payload: ServerEvent }>("/event", {
      reconnectDelay: 250,
      heartbeatTimeout: 15_000,
      onError: (err) => options.onError?.(err),
    })
    void stream.start()
    const consume = async () => {
      for await (const message of stream) {
        const directory = message.directory ?? "global"
        const payload = message.payload
        if (!payload) continue
        if (payload.type === "sync") continue
        const coalesced = coalesceServerEvents([{ directory, payload }])
        for (const evt of coalesced) {
          apply(evt.directory, evt.payload)
          // Mirror the event onto the scoped bus so non-store consumers
          // (analytics side-cars, replay buffers, hooks) can fan out
          // independently of the Zustand store.
          bus.emit<ServerEvent>(
            directory === "global" ? "global" : "workspace",
            directory,
            evt.payload,
          )
        }
      }
    }
    void consume()
    stopFn = () => {
      stream.stop()
      void stream.close()
    }
  }

  function stop() {
    started = false
    stopFn?.()
    stopFn = undefined
  }

  return {
    global,
    child: (directory) => manager.child(directory),
    release: (directory) => manager.release(directory),
    bootstrap,
    apply,
    start,
    stop,
    api,
    queryClient,
    scope,
    bus,
  }
}

// ---------------------------------------------------------------------------
// React provider / hook (mirrors OpenCode's `useServerSync`)
// ---------------------------------------------------------------------------

export type SyncProviderProps = {
  options: SyncStoreOptions
  children: ReactNode
}

const SyncContext = createContext<SyncStore | null>(null)

export function SyncProvider({ options, children }: SyncProviderProps) {
  const [store] = useState(() => createSyncStore(options))
  useEffect(() => {
    void store.bootstrap()
    store.start()
    return () => store.stop()
  }, [store])
  return createElement(SyncContext.Provider, { value: store }, children)
}

export function useSyncStore(): SyncStore {
  const value = useContext(SyncContext)
  if (value === null) throw new Error("useSyncStore must be used within SyncProvider")
  return value
}

export function useGlobalSlice<T>(selector: (state: GlobalStoreShape) => T): T {
  const ctx = useContext(SyncContext)
  if (ctx === null) throw new Error("useSyncStore must be used within SyncProvider")
  return useStoreSelector(ctx.global, selector)
}

export function useDirectorySlice<T>(
  directory: string,
  selector: (state: DirectoryStoreShape) => T,
): T {
  const ctx = useContext(SyncContext)
  if (ctx === null) throw new Error("useSyncStore must be used within SyncProvider")
  const ref = useRef<DirectoryStoreApi | null>(null)
  if (ref.current === null) ref.current = ctx.child(directory)
  useEffect(() => {
    ref.current = ctx.child(directory)
    return () => ctx.release(directory)
  }, [ctx, directory])
  return useStoreSelector(ref.current, selector)
}

function useStoreSelector<T, S>(store: { subscribe: (cb: () => void) => () => void; getState: () => T }, selector: (state: T) => S): S {
  const subscribe = useMemo(
    () => (cb: () => void) => store.subscribe(cb),
    [store],
  )
  const getSnapshot = useMemo(
    () => () => selector(store.getState()),
    [store, selector],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// Re-exports for parity with OpenCode's barrel.
export { reconcile, reconcileArray } from "./utils/reconcile"
