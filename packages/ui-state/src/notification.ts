import React, { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { createStore, useStore } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

/**
 * Ported from OpenCode packages/app/src/context/notification.tsx
 *
 * The notification context tracks per-session and per-project unseen/error
 * notifications. SolidJS createStore is replaced by Zustand, and the persistent
 * payload is stored as `list` (notifications) with derived indexes rebuilt on
 * reads via memoised getters.
 */

type NotificationBase = {
  directory?: string
  session?: string
  metadata?: unknown
  time: number
  viewed: boolean
}

export type TurnCompleteNotification = NotificationBase & {
  type: "turn-complete"
}

export type ErrorNotificationPayload = {
  name?: string
  message?: string
  data?: unknown
}

export type ErrorNotification = NotificationBase & {
  type: "error"
  error: ErrorNotificationPayload
}

export type Notification = TurnCompleteNotification | ErrorNotification

const MAX_NOTIFICATIONS = 500
const NOTIFICATION_TTL_MS = 1000 * 60 * 60 * 24 * 30

function pruneNotifications(list: Notification[]) {
  const cutoff = Date.now() - NOTIFICATION_TTL_MS
  const pruned = list.filter((n) => n.time >= cutoff)
  if (pruned.length <= MAX_NOTIFICATIONS) return pruned
  return pruned.slice(pruned.length - MAX_NOTIFICATIONS)
}

type NotificationIndex = {
  session: {
    all: Record<string, Notification[]>
    unseen: Record<string, Notification[]>
    unseenCount: Record<string, number>
    unseenHasError: Record<string, boolean>
  }
  project: {
    all: Record<string, Notification[]>
    unseen: Record<string, Notification[]>
    unseenCount: Record<string, number>
    unseenHasError: Record<string, boolean>
  }
}

export function buildNotificationIndex(list: Notification[]): NotificationIndex {
  const index: NotificationIndex = {
    session: { all: {}, unseen: {}, unseenCount: {}, unseenHasError: {} },
    project: { all: {}, unseen: {}, unseenCount: {}, unseenHasError: {} },
  }

  for (const notification of list) {
    if (notification.session) {
      const all = index.session.all[notification.session] ?? []
      index.session.all[notification.session] = [...all, notification]
      if (!notification.viewed) {
        const unseen = index.session.unseen[notification.session] ?? []
        index.session.unseen[notification.session] = [...unseen, notification]
        index.session.unseenCount[notification.session] = unseen.length + 1
        if (notification.type === "error") index.session.unseenHasError[notification.session] = true
      }
    }
    if (notification.directory) {
      const all = index.project.all[notification.directory] ?? []
      index.project.all[notification.directory] = [...all, notification]
      if (!notification.viewed) {
        const unseen = index.project.unseen[notification.directory] ?? []
        index.project.unseen[notification.directory] = [...unseen, notification]
        index.project.unseenCount[notification.directory] = unseen.length + 1
        if (notification.type === "error") index.project.unseenHasError[notification.directory] = true
      }
    }
  }

  return index
}

interface NotificationState {
  ready: boolean
  list: Notification[]
  setList: (next: Notification[]) => void
  append: (notification: Notification) => void
  markViewedForSession: (session: string) => void
  markViewedForProject: (directory: string) => void
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

export interface NotificationStoreOptions {
  /**
   * Persistence key.  In OpenCode this was a server-scoped key
   * (Persist.serverGlobal(scope, "notification", ["notification.v1"])).  The
   * React/Zustand port lets the consumer parameterise the key.
   */
  storageKey?: string
}

export const createNotificationStore = (opts: NotificationStoreOptions = {}) =>
  createStore<NotificationState>()(
    persist(
      (set, get) => ({
        ready: false,
        list: [],
        setList: (next) => set({ list: next }),
        append: (notification) => {
          const list = pruneNotifications([...get().list, notification])
          set({ list })
        },
        markViewedForSession: (session) => {
          set({
            list: get().list.map((n) =>
              n.session === session && !n.viewed ? { ...n, viewed: true } : n,
            ),
          })
        },
        markViewedForProject: (directory) => {
          set({
            list: get().list.map((n) =>
              n.directory === directory && !n.viewed ? { ...n, viewed: true } : n,
            ),
          })
        },
      }),
      {
        name: opts.storageKey ?? "notification.v1",
        storage: createJSONStorage(() => (typeof localStorage !== "undefined" ? localStorage : undefinedStorage())),
        onRehydrateStorage: () => (state) => {
          if (state) state.ready = true
        },
      },
    ),
  )

export type NotificationStore = ReturnType<typeof createNotificationStore>

interface NotificationContextValue {
  store: NotificationStore
  /** Index rebuilt lazily from the underlying list. */
  getIndex: () => NotificationIndex
  /** Returns unseen notifications for the given session. */
  sessionUnseen: (session: string) => Notification[]
  /** Returns unseen count for the given session. */
  sessionUnseenCount: (session: string) => number
  /** Returns whether the session has an unseen error notification. */
  sessionUnseenHasError: (session: string) => boolean
  /** Returns all notifications for a session. */
  sessionAll: (session: string) => Notification[]
  /** Returns unseen notifications for the given directory/project. */
  projectUnseen: (directory: string) => Notification[]
  projectUnseenCount: (directory: string) => number
  projectUnseenHasError: (directory: string) => boolean
  projectAll: (directory: string) => Notification[]
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export interface NotificationProviderProps {
  storageKey?: string
  children: ReactNode
  /** Subscribe to backend events.  In Maximilian this wires through `useServerSDK`. */
  onEvent?: (handler: (event: unknown) => void) => () => void
}

export function NotificationProvider({ storageKey, children, onEvent }: NotificationProviderProps) {
  const [store] = useState(() => createNotificationStore({ storageKey }))
  const cacheRef = useRef<{ list: Notification[]; index: NotificationIndex } | null>(null)

  // Prune on first ready.
  const ready = useStore(store, (s) => s.ready)
  useEffect(() => {
    if (!ready) return
    const state = store.getState()
    const pruned = pruneNotifications(state.list)
    if (pruned.length !== state.list.length) state.setList(pruned)
    cacheRef.current = null
  }, [ready, store])

  const getIndex = () => {
    const list = store.getState().list
    if (cacheRef.current && cacheRef.current.list === list) return cacheRef.current.index
    const index = buildNotificationIndex(list)
    cacheRef.current = { list, index }
    return index
  }

  // Drop cache when list reference changes.
  useEffect(() => {
    const unsub = store.subscribe((state, prev) => {
      if (state.list !== prev.list) cacheRef.current = null
    })
    return unsub
  }, [store])

  const ctx: NotificationContextValue = {
    store,
    getIndex,
    sessionAll: (session) => getIndex().session.all[session] ?? [],
    sessionUnseen: (session) => getIndex().session.unseen[session] ?? [],
    sessionUnseenCount: (session) => getIndex().session.unseenCount[session] ?? 0,
    sessionUnseenHasError: (session) => getIndex().session.unseenHasError[session] ?? false,
    projectAll: (directory) => getIndex().project.all[directory] ?? [],
    projectUnseen: (directory) => getIndex().project.unseen[directory] ?? [],
    projectUnseenCount: (directory) => getIndex().project.unseenCount[directory] ?? 0,
    projectUnseenHasError: (directory) => getIndex().project.unseenHasError[directory] ?? false,
  }

  // Forward backend events into append(). The original SolidJS implementation
  // listened to serverSDK().event.listen directly; the port defers that wiring
  // to the consumer via `onEvent`, but still reacts to standard event shapes.
  useEffect(() => {
    if (!onEvent) return
    const unsub = onEvent((event) => {
      const ev = event as { details?: { type?: string; properties?: Record<string, unknown> }; name?: string }
      const details = ev.details
      if (!details) return
      if (details.type === "session.idle") {
        const sessionID = (details.properties?.sessionID as string | undefined) ?? undefined
        const directory = ev.name
        if (!sessionID) return
        store.getState().append({
          directory,
          session: sessionID,
          time: Date.now(),
          viewed: false,
          type: "turn-complete",
        })
      } else if (details.type === "session.error") {
        const sessionID = (details.properties?.sessionID as string | undefined) ?? "global"
        const error = (details.properties?.error as ErrorNotificationPayload | undefined) ?? undefined
        const directory = ev.name
        store.getState().append({
          directory,
          session: sessionID,
          time: Date.now(),
          viewed: false,
          type: "error",
          error: error ?? {},
        })
      }
    })
    return unsub
  }, [onEvent, store])

  return React.createElement(NotificationContext.Provider, { value: ctx }, children)
}

export function useNotification(): NotificationContextValue {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error("useNotification must be used within NotificationProvider")
  return ctx
}