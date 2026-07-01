/**
 * Local store — ported from OpenCode `context/local.tsx` (SolidJS) to React + Zustand.
 *
 * Tracks per-session agent/model/variant selection with persisted storage and
 * draft handoff between server scopes. Selectors expose both individual fields
 * (fine-grained subscriptions) and action bundles.
 */

import { create } from "zustand"

export type ModelKey = { providerID: string; modelID: string; variant?: string }

export type LocalState = {
  agent?: string
  model?: ModelKey
  variant?: string | null
}

type Saved = {
  session: Record<string, LocalState | undefined>
}

type LastAction = {
  type: "agent" | "model" | "variant"
  agent?: string
  model?: ModelKey | null
  variant?: string | null
}

type DraftStore = {
  current?: string
  draft?: LocalState
  last?: LastAction
}

type AgentDescriptor = {
  name: string
  model?: ModelKey
  variant?: string | null
}

type ModelDescriptor = {
  provider: { id: string }
  id: string
  variants?: Record<string, unknown>
}

type ModelProvider = {
  id: string
  models: Record<string, { id: string }>
}

export type LocalStoreState = {
  /** Saved per-session state (persisted) */
  saved: Saved
  /** Ephemeral draft state (current workspace selection before session exists) */
  store: DraftStore
}

export type LocalStoreActions = {
  setSaved: (updater: (draft: Saved) => void) => void
  setStore: (updater: (draft: DraftStore) => void) => void
  setCurrentAgent: (name: string | undefined) => void
  setDraft: (draft: LocalState | undefined) => void
  setLast: (last: LastAction | undefined) => void
  setSessionSaved: (sessionID: string, value: LocalState | undefined) => void
  resetDraft: () => void
  /** Bulk replace session saved state */
  replaceSaved: (next: Saved) => void
  /** Clear all in-memory state (used when server scope changes) */
  reset: () => void
}

export type LocalStore = LocalStoreState & LocalStoreActions

const initialSaved: Saved = { session: {} }
const initialStore: DraftStore = {
  current: undefined,
  draft: undefined,
  last: undefined,
}

export const useLocalStore = create<LocalStore>()((set, get) => ({
  saved: initialSaved,
  store: initialStore,

  setSaved: (updater) =>
    set((state) => {
      const next: Saved = { session: { ...state.saved.session } }
      updater(next)
      return { saved: next }
    }),

  setStore: (updater) =>
    set((state) => {
      const next: DraftStore = { ...state.store }
      updater(next)
      return { store: next }
    }),

  setCurrentAgent: (name) =>
    set((state) => ({ store: { ...state.store, current: name } })),

  setDraft: (draft) =>
    set((state) => ({ store: { ...state.store, draft } })),

  setLast: (last) =>
    set((state) => ({ store: { ...state.store, last } })),

  setSessionSaved: (sessionID, value) =>
    set((state) => {
      const next: Saved = { session: { ...state.saved.session } }
      if (value === undefined) {
        delete next.session[sessionID]
      } else {
        next.session[sessionID] = value
      }
      return { saved: next }
    }),

  resetDraft: () =>
    set((state) => ({ store: { ...state.store, draft: undefined } })),

  replaceSaved: (next) => set({ saved: next }),

  reset: () => set({ saved: initialSaved, store: initialStore }),
}))

// ----------------------------------------------------------------------------
// Pure helpers — ported verbatim from OpenCode's local context so behaviour
// stays identical regardless of the reactive runtime.
// ----------------------------------------------------------------------------

export function pickAgent(items: AgentDescriptor[], name: string | undefined): AgentDescriptor | undefined {
  if (items.length === 0) return undefined
  return items.find((item) => item.name === name) ?? items[0]
}

export function firstValidModel(
  items: Array<() => ModelKey | undefined>,
  valid: (model: ModelKey) => boolean,
): ModelKey | undefined {
  for (const item of items) {
    const model = item()
    if (!model) continue
    if (valid(model)) return model
  }
  return undefined
}

export function isValidModel(
  model: ModelKey,
  providers: { all: () => Map<string, ModelProvider> },
  connected: Set<string>,
): boolean {
  const provider = providers.all().get(model.providerID)
  return !!provider?.models[model.modelID] && connected.has(model.providerID)
}

export function findConfiguredModel(
  configured: string | undefined,
  valid: (model: ModelKey) => boolean,
): ModelKey | undefined {
  if (!configured) return undefined
  const [providerID, modelID] = configured.split("/")
  if (!providerID || !modelID) return undefined
  const model: ModelKey = { providerID, modelID }
  if (valid(model)) return model
  return undefined
}

export function findRecentModel(
  recent: ModelKey[],
  valid: (model: ModelKey) => boolean,
): ModelKey | undefined {
  for (const item of recent) {
    if (valid(item)) return item
  }
  return undefined
}

export function findDefaultModel(
  providers: { connected: () => ModelProvider[]; default: () => Record<string, string> },
  valid: (model: ModelKey) => boolean,
): ModelKey | undefined {
  const defaults = providers.default()
  for (const provider of providers.connected()) {
    const configured = defaults[provider.id]
    if (configured) {
      const model: ModelKey = { providerID: provider.id, modelID: configured }
      if (valid(model)) return model
    }
    const first = Object.values(provider.models)[0]
    if (!first) continue
    const model: ModelKey = { providerID: provider.id, modelID: first.id }
    if (valid(model)) return model
  }
  return undefined
}

export function snapshotState(
  agentName: string | undefined,
  model: ModelDescriptor | undefined,
  variant: string | undefined,
): LocalState {
  return {
    agent: agentName,
    model: model ? { providerID: model.provider.id, modelID: model.id } : undefined,
    variant,
  }
}

export function resolveScope(
  draft: LocalState | undefined,
  sessionID: string | undefined,
  saved: Saved,
): LocalState | undefined {
  if (!sessionID) return draft
  return saved.session[sessionID]
}

export function mergeState(base: LocalState | undefined, patch: Partial<LocalState>): LocalState {
  return {
    ...(base ?? {}),
    ...patch,
  }
}