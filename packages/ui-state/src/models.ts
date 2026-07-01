import React, { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { createStore, useStore } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

/**
 * Ported from OpenCode packages/app/src/context/models.tsx
 *
 * Tracks model visibility preferences, recents and per-model variants.
 * Computed lists (available, latest, etc.) accept a `useProviders` style
 * injection from the consumer since Maximilian does not yet ship the
 * providers hook from OpenCode.
 */

export type ModelKey = { providerID: string; modelID: string }

export type Visibility = "show" | "hide"
export type User = ModelKey & { visibility: Visibility; favorite?: boolean }

export interface ModelRecord {
  id: string
  name: string
  release_date?: string
  family?: string
  provider: { id: string }
}

interface ModelsState {
  ready: boolean
  user: User[]
  recent: ModelKey[]
  variant: Record<string, string | undefined>
  setUser: (next: User[]) => void
  setRecent: (next: ModelKey[]) => void
  setVariant: (next: Record<string, string | undefined>) => void
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

export const createModelsStore = () =>
  createStore<ModelsState>()(
    persist(
      (set) => ({
        ready: false,
        user: [],
        recent: [],
        variant: {},
        setUser: (next) => set({ user: next }),
        setRecent: (next) => set({ recent: next }),
        setVariant: (next) => set({ variant: next }),
      }),
      {
        name: "model.v1",
        storage: createJSONStorage(() => (typeof localStorage !== "undefined" ? localStorage : undefinedStorage())),
        onRehydrateStorage: () => (state) => {
          if (state) state.ready = true
        },
      },
    ),
  )

export type ModelsStore = ReturnType<typeof createModelsStore>

export function modelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

const RECENT_LIMIT = 5

interface ModelsContextValue {
  store: ModelsStore
  /** Provider data injected from outside; updated via setProviders(). */
  providers: ModelRecord[]
  setProviders: (next: ModelRecord[]) => void
}

const ModelsContext = createContext<ModelsContextValue | null>(null)

export interface ModelsProviderProps {
  children: ReactNode
  initialProviders?: ModelRecord[]
}

export function ModelsProvider({ children, initialProviders = [] }: ModelsProviderProps) {
  const [store] = useState(() => createModelsStore())
  const [providers, setProviders] = useState<ModelRecord[]>(initialProviders)
  const value = useMemo<ModelsContextValue>(
    () => ({ store, providers, setProviders }),
    [store, providers],
  )
  return React.createElement(ModelsContext.Provider, { value }, children)
}

export function useModels(): ModelsContextValue {
  const ctx = useContext(ModelsContext)
  if (!ctx) throw new Error("useModels must be used within ModelsProvider")
  return ctx
}

function releaseDate(m: ModelRecord): number {
  const t = m.release_date ? Date.parse(m.release_date) : NaN
  return Number.isFinite(t) ? t : 0
}

/**
 * Hook helper mirroring the SolidJS fluent API (list, visible, find, recent,
 * variant).  Memoised computations live in `useMemo` so they update when the
 * underlying providers or stored state change.
 */
export function useModelsApi() {
  const { store, providers } = useModels()

  const user = useStore(store, (s) => s.user)
  const recent = useStore(store, (s) => s.recent)
  const variant = useStore(store, (s) => s.variant)

  const available = useMemo<ModelRecord[]>(
    () =>
      providers.flatMap((p) =>
        p.provider ? [{ ...p, provider: p.provider }] : [],
      ),
    [providers],
  )

  const list = useMemo(() => available, [available])

  const visibilityMap = useMemo(() => {
    const map = new Map<string, Visibility>()
    for (const item of user) map.set(modelKey(item), item.visibility)
    return map
  }, [user])

  const latestSet = useMemo(() => {
    const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 30 * 6
    const set = new Set<string>()
    for (const m of available) {
      const date = releaseDate(m)
      if (date && Date.now() - date < cutoff) set.add(modelKey({ providerID: m.provider.id, modelID: m.id }))
    }
    return set
  }, [available])

  function visible(model: ModelKey) {
    const key = modelKey(model)
    const state = visibilityMap.get(key)
    if (state === "hide") return false
    if (state === "show") return true
    if (latestSet.has(key)) return true
    return true
  }

  function setVisibility(model: ModelKey, show: boolean) {
    const state = store.getState()
    const idx = state.user.findIndex((x) => x.modelID === model.modelID && x.providerID === model.providerID)
    if (idx >= 0) {
      const next = [...state.user]
      next[idx] = { ...next[idx], visibility: show ? "show" : "hide" }
      state.setUser(next)
    } else {
      state.setUser([...state.user, { ...model, visibility: show ? "show" : "hide" }])
    }
  }

  function find(key: ModelKey) {
    return available.find((m) => m.id === key.modelID && m.provider.id === key.providerID)
  }

  function pushRecent(model: ModelKey) {
    const state = store.getState()
    const seen = new Set<string>()
    const next: ModelKey[] = []
    for (const item of [model, ...state.recent]) {
      const k = modelKey(item)
      if (seen.has(k)) continue
      seen.add(k)
      next.push(item)
      if (next.length >= RECENT_LIMIT) break
    }
    state.setRecent(next)
  }

  const variantKey = (model: ModelKey) => `${model.providerID}/${model.modelID}`

  function getVariant(model: ModelKey) {
    return store.getState().variant?.[variantKey(model)]
  }

  function setVariant(model: ModelKey, value: string | undefined) {
    const state = store.getState()
    const key = variantKey(model)
    if (!state.variant) {
      state.setVariant({ [key]: value })
      return
    }
    state.setVariant({ ...state.variant, [key]: value })
  }

  return {
    ready: useStore(store, (s) => s.ready),
    list,
    find,
    visible,
    setVisibility,
    recent,
    pushRecent,
    variant: { get: getVariant, set: setVariant },
  }
}