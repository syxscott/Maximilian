import React, { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { createStore } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

/**
 * Ported from OpenCode packages/app/src/context/permission.tsx
 *
 * Tracks auto-accept rules (per-session and per-directory) and forwards
 * decisions to the SDK. The Maximilian port keeps the store shape but routes
 * SDK calls through injected callbacks so the package has no runtime SDK
 * dependency.
 */

export interface PermissionRequest {
  id: string
  sessionID: string
  [k: string]: unknown
}

export interface PermissionRespondInput {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
  directory?: string
}

interface PermissionState {
  ready: boolean
  autoAccept: Record<string, boolean>
  setAutoAccept: (next: Record<string, boolean>) => void
  upsertAutoAccept: (key: string, value: boolean) => void
  removeAutoAccept: (key: string) => void
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

export const createPermissionStore = (storageKey = "permission.v3") =>
  createStore<PermissionState>()(
    persist(
      (set, get) => ({
        ready: false,
        autoAccept: {},
        setAutoAccept: (next) => set({ autoAccept: next }),
        upsertAutoAccept: (key, value) => {
          const current = get().autoAccept
          if (current[key] === value) return
          set({ autoAccept: { ...current, [key]: value } })
        },
        removeAutoAccept: (key) => {
          const current = get().autoAccept
          if (!(key in current)) return
          const { [key]: _removed, ...rest } = current
          set({ autoAccept: rest })
        },
      }),
      {
        name: storageKey,
        storage: createJSONStorage(() => (typeof localStorage !== "undefined" ? localStorage : undefinedStorage())),
        migrate: (value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return value
          const data = value as Record<string, unknown>
          if (data.autoAccept) return value
          return {
            ...data,
            autoAccept:
              typeof data.autoAcceptEdits === "object" && data.autoAcceptEdits && !Array.isArray(data.autoAcceptEdits)
                ? data.autoAcceptEdits
                : {},
          }
        },
        onRehydrateStorage: () => (state) => {
          if (state) state.ready = true
        },
      },
    ),
  )

export type PermissionStore = ReturnType<typeof createPermissionStore>

const RESPONDED_TTL_MS = 60 * 60 * 1000
const MAX_RESPONDED = 1000

function directoryAcceptKey(directory: string) {
  return `dir:${directory}`
}

function acceptKey(sessionID: string, directory?: string) {
  return directory ? `${directory}/${sessionID}` : sessionID
}

interface PermissionContextValue {
  store: PermissionStore
  respond: (input: PermissionRespondInput) => void
  isAutoAccepting: (sessionID: string, directory?: string) => boolean
  isAutoAcceptingDirectory: (directory: string) => boolean
  /**
   * Returns whether a given permission request would be auto-accepted by the
   * current rules.  The consumer provides the matching logic through
   * `shouldAutoRespond`; otherwise we always return false.
   */
  shouldAutoRespond: (permission: PermissionRequest, directory?: string) => boolean
  toggleAutoAccept: (sessionID: string, directory: string) => void
  toggleAutoAcceptDirectory: (directory: string) => void
  enableAutoAccept: (sessionID: string, directory: string) => void
  disableAutoAccept: (sessionID: string, directory?: string) => void
}

const PermissionContext = createContext<PermissionContextValue | null>(null)

export interface PermissionProviderProps {
  children: ReactNode
  /**
   * Bridge to the SDK. The Maximilian port delegates all network calls to
   * the caller (matches the spirit of OpenCode's serverSDK().client.permission).
   */
  respondRequest?: (input: PermissionRespondInput) => Promise<unknown> | unknown
  listPermissions?: (directory: string) => Promise<PermissionRequest[]> | PermissionRequest[]
  /** Returns true if the directory's config.permission is "allow". */
  isPermissionAllowAll?: (directory: string) => boolean
  /** Returns the rules from server sync config for the given directory. */
  getPermissionConfig?: (directory: string) => unknown
  /** Returns the current session IDs in the directory (used by the auto-respond matcher). */
  getSessions?: (directory: string) => { id: string }[]
  /** Determines if a request matches the auto-accept rules. */
  shouldAutoRespond?: (
    rules: Record<string, boolean>,
    sessions: { id: string }[],
    permission: PermissionRequest,
    directory?: string,
  ) => boolean
}

export function PermissionProvider({
  children,
  respondRequest,
  listPermissions,
  isPermissionAllowAll,
  shouldAutoRespond,
}: PermissionProviderProps) {
  const [store] = useState(() => createPermissionStore())
  const responded = useMemo(() => new Map<string, number>(), [])
  const enableVersion = useMemo(() => new Map<string, number>(), [])

  function pruneResponded(now: number) {
    for (const [id, ts] of [...responded.entries()]) {
      if (now - ts < RESPONDED_TTL_MS) continue
      responded.delete(id)
    }
    if (responded.size <= MAX_RESPONDED) return
    const keys = [...responded.keys()]
    for (let i = 0; i < keys.length && responded.size > MAX_RESPONDED; i++) {
      responded.delete(keys[i])
    }
  }

  const respond: (input: PermissionRespondInput) => void = (input) => {
    if (!respondRequest) return
    try {
      const result = respondRequest(input)
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        ;(result as Promise<unknown>).catch(() => {
          responded.delete(input.permissionID)
        })
      }
    } catch {
      responded.delete(input.permissionID)
    }
  }

  function respondOnce(permission: PermissionRequest, directory?: string) {
    const now = Date.now()
    const hit = responded.has(permission.id)
    responded.delete(permission.id)
    responded.set(permission.id, now)
    pruneResponded(now)
    if (hit) return
    respond({
      sessionID: permission.sessionID,
      permissionID: permission.id,
      response: "once",
      directory,
    })
  }

  function autoAcceptFor(directory?: string) {
    return store.getState().autoAccept
  }

  function isAutoAccepting(sessionID: string, directory?: string) {
    const key = acceptKey(sessionID, directory)
    return Boolean(store.getState().autoAccept[key])
  }

  function isAutoAcceptingDirectory(directory: string) {
    return Boolean(store.getState().autoAccept[directoryAcceptKey(directory)])
  }

  function shouldAutoRespondFn(permission: PermissionRequest, directory?: string) {
    const rules = autoAcceptFor(directory)
    if (!shouldAutoRespond) return false
    const result = directory && listPermissions ? listPermissions(directory) : []
    const sessions = Array.isArray(result) ? result : []
    return shouldAutoRespond(rules, sessions, permission, directory)
  }

  function bumpEnableVersion(sessionID: string, directory?: string) {
    const key = acceptKey(sessionID, directory)
    const next = (enableVersion.get(key) ?? 0) + 1
    enableVersion.set(key, next)
    return next
  }

  function enableDirectory(directory: string) {
    const key = directoryAcceptKey(directory)
    store.getState().upsertAutoAccept(key, true)
    if (!listPermissions) return
    Promise.resolve(listPermissions(directory))
      .then((list) => {
        if (!isAutoAcceptingDirectory(directory)) return
        for (const perm of list ?? []) {
          if (!perm?.id) continue
          if (!shouldAutoRespondFn(perm, directory)) continue
          respondOnce(perm, directory)
        }
      })
      .catch(() => undefined)
  }

  function disableDirectory(directory: string) {
    const key = directoryAcceptKey(directory)
    store.getState().upsertAutoAccept(key, false)
  }

  function enable(sessionID: string, directory: string) {
    const key = acceptKey(sessionID, directory)
    const version = bumpEnableVersion(sessionID, directory)
    store.getState().upsertAutoAccept(key, true)
    store.getState().removeAutoAccept(sessionID)
    if (!listPermissions) return
    Promise.resolve(listPermissions(directory))
      .then((list) => {
        if (enableVersion.get(key) !== version) return
        if (!isAutoAccepting(sessionID, directory)) return
        for (const perm of list ?? []) {
          if (!perm?.id) continue
          if (!shouldAutoRespondFn(perm, directory)) continue
          respondOnce(perm, directory)
        }
      })
      .catch(() => undefined)
  }

  function disable(sessionID: string, directory?: string) {
    bumpEnableVersion(sessionID, directory)
    const key = directory ? acceptKey(sessionID, directory) : sessionID
    store.getState().upsertAutoAccept(key, false)
    if (directory) store.getState().removeAutoAccept(sessionID)
  }

  function toggleAutoAccept(sessionID: string, directory: string) {
    if (isAutoAccepting(sessionID, directory)) {
      disable(sessionID, directory)
      return
    }
    enable(sessionID, directory)
  }

  function toggleAutoAcceptDirectory(directory: string) {
    if (isAutoAcceptingDirectory(directory)) {
      disableDirectory(directory)
      return
    }
    enableDirectory(directory)
  }

  const value = useMemo<PermissionContextValue>(
    () => ({
      store,
      respond,
      isAutoAccepting,
      isAutoAcceptingDirectory,
      shouldAutoRespond: shouldAutoRespondFn,
      toggleAutoAccept,
      toggleAutoAcceptDirectory,
      enableAutoAccept: (sessionID, directory) => {
        if (!isAutoAccepting(sessionID, directory)) enable(sessionID, directory)
      },
      disableAutoAccept: (sessionID, directory) => disable(sessionID, directory),
    }),
    [],
  )

  return React.createElement(PermissionContext.Provider, { value }, children)
}

export function usePermission(): PermissionContextValue {
  const ctx = useContext(PermissionContext)
  if (!ctx) throw new Error("usePermission must be used within PermissionProvider")
  return ctx
}

export { directoryAcceptKey, acceptKey }