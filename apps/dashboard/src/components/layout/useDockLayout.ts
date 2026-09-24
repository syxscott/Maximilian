// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Dock layout state (zustand wrapper around the pure dockModel): the
 * layout model plus which panel is maximized, with every structural
 * change mirrored to localStorage under the store's storage key so the
 * arrangement survives reloads. All tree surgery is delegated to the
 * pure functions in dockModel.ts — this module only owns persistence
 * and the maximize toggle. Storage access is defensive (try/catch).
 *
 * The module exports a factory (createDockLayoutStore) so independent
 * docks can live beside the main shell dock — each with its own storage
 * key and default layout — without duplicating the action wiring. The
 * shell singleton (useDockLayoutStore) is built through the same factory.
 */
import { create } from "zustand"
import type { StoreApi, UseBoundStore } from "zustand"
import {
  type DockDirection,
  type DockModel,
  addPanel as addPanelModel,
  createDefaultDockModel,
  cyclePanelDisplay,
  deserializeDockModel,
  findLeaf,
  flattenPanels,
  openPanel as openPanelModel,
  parseDockModel,
  removePanel as removePanelModel,
  resetSplit as resetSplitModel,
  resizeSplit as resizeSplitModel,
  serializeDockModel,
  setActive as setActiveModel,
} from "@/components/layout/dockModel"

export const DOCK_LAYOUT_STORAGE_KEY = "maximilian.dock-layout"

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined
  } catch {
    return undefined
  }
}

/** Read one persisted layout; never throws (junk → the given default). */
export function loadDockLayoutFrom(
  storage: Storage | undefined,
  storageKey: string,
  createDefault: () => DockModel,
): DockModel {
  if (!storage) return createDefault()
  try {
    const raw = storage.getItem(storageKey)
    if (!raw) return createDefault()
    const model = parseDockModel(JSON.parse(raw))
    // An intentionally emptied layout ({root:null}) is never a state
    // worth restoring — fall back to the owner's default model.
    return model.root === null ? createDefault() : model
  } catch {
    return createDefault()
  }
}

/** Read the persisted shell layout; never throws (junk → default shell). */
export function loadDockLayout(storage: Storage | undefined = defaultStorage()): DockModel {
  return loadDockLayoutFrom(storage, DOCK_LAYOUT_STORAGE_KEY, createDefaultDockModel)
}

/** Write one layout to storage; never throws. */
export function persistDockLayoutTo(
  model: DockModel,
  storage: Storage | undefined,
  storageKey: string,
): void {
  if (!storage) return
  try {
    storage.setItem(storageKey, serializeDockModel(model))
  } catch {
    // Quota exceeded / storage disabled — the layout simply stays in memory.
  }
}

/** Write the shell layout to storage; never throws. */
export function persistDockLayout(
  model: DockModel,
  storage: Storage | undefined = defaultStorage(),
): void {
  persistDockLayoutTo(model, storage, DOCK_LAYOUT_STORAGE_KEY)
}

interface DockLayoutState {
  model: DockModel
  /** The fullscreen panel, null when none is maximized. Not persisted. */
  maximizedId: string | null
  /**
   * Panels collapsed to thin restore strips (the tri-state display's
   * hidden state). Not persisted; mutually exclusive with maximizedId.
   */
  hiddenIds: string[]
  /**
   * Split the target leaf and open a new panel beside/below it
   * (defaults: the active panel, horizontally). With no panels open,
   * creates the first one. Returns the new panel id, null when nothing
   * changed (duplicate id, dock full).
   */
  addPanel: (targetId?: string, direction?: DockDirection) => string | null
  /**
   * Reopen a known panel id (stable registry entry — the add-panel menu
   * path). No-op when the panel is already open or the id is blank.
   */
  openPanel: (panelId: string, titleKey?: string) => void
  removePanel: (panelId: string) => void
  resizeSplit: (splitId: string, ratio: number) => void
  /** Even out one split to 50/50 (the divider double-click affordance). */
  resetSplit: (splitId: string) => void
  setActive: (panelId: string | null) => void
  /**
   * Advance one panel through the display cycle: normal → maximized →
   * hidden (collapsed strip) → normal. Replaces the plain maximize
   * toggle; invariants live in the pure cyclePanelDisplay.
   */
  cycleDisplay: (panelId: string) => void
  /** Fullscreen one panel; toggling the maximized panel restores. */
  toggleMaximize: (panelId: string) => void
  resetLayout: () => void
}

let panelSeq = 0

/** Options for a dock store instance: where it persists and its default. */
export interface DockLayoutStoreOptions {
  /** localStorage key the model is mirrored to. */
  storageKey: string
  /** Fresh default model (empty/junk storage, and resetLayout). */
  createDefault: () => DockModel
}

export type DockLayoutStore = UseBoundStore<StoreApi<DockLayoutState>>

/** Build one dock layout store — the shell singleton's exact behavior. */
export function createDockLayoutStore(options: DockLayoutStoreOptions): DockLayoutStore {
  const { storageKey, createDefault } = options
  return create<DockLayoutState>()((set, get) => {
    const commit = (model: DockModel) => {
      persistDockLayoutTo(model, defaultStorage(), storageKey)
      set({ model })
    }
    return {
      model: loadDockLayoutFrom(defaultStorage(), storageKey, createDefault),
      maximizedId: null,
      hiddenIds: [],
      addPanel: (targetId, direction = "horizontal") => {
        const { model } = get()
        // Fresh unique id — "panel-N" never collides with an open panel.
        let id = `panel-${++panelSeq}`
        while (model.root !== null && findLeaf(model.root, id) !== null) {
          id = `panel-${++panelSeq}`
        }
        const leaves = flattenPanels(model.root)
        const target = targetId ?? model.activeId ?? leaves[0]?.id ?? ""
        if (model.root === null) {
          // Empty dock — the new panel becomes the whole layout.
          commit({ root: { kind: "leaf", id, titleKey: `layout.panel.${id}` }, activeId: id })
          return id
        }
        const next = addPanelModel(model, id, target, direction)
        if (next === model) return null
        commit(next)
        return id
      },
      openPanel: (panelId, titleKey) => {
        const next = openPanelModel(get().model, panelId, titleKey)
        if (next !== get().model) commit(next)
      },
      removePanel: (panelId) => {
        const next = removePanelModel(get().model, panelId)
        if (next === get().model) return
        set((s) => ({
          maximizedId: s.maximizedId === panelId ? null : s.maximizedId,
          hiddenIds: s.hiddenIds.filter((h) => h !== panelId),
        }))
        commit(next)
      },
      resizeSplit: (splitId, ratio) => {
        const next = resizeSplitModel(get().model, splitId, ratio)
        if (next !== get().model) commit(next)
      },
      resetSplit: (splitId) => {
        const next = resetSplitModel(get().model, splitId)
        if (next !== get().model) commit(next)
      },
      setActive: (panelId) => {
        const next = setActiveModel(get().model, panelId)
        if (next !== get().model) set({ model: next })
      },
      cycleDisplay: (panelId) => {
        const { maximizedId, hiddenIds } = get()
        // View state only — never mirrored to the persisted document.
        const next = cyclePanelDisplay({ maximizedId, hiddenIds }, panelId)
        set({ maximizedId: next.maximizedId, hiddenIds: [...next.hiddenIds] })
      },
      toggleMaximize: (panelId) =>
        set((s) => ({
          maximizedId: s.maximizedId === panelId ? null : panelId,
          // Maximize and hidden are mutually exclusive view states.
          hiddenIds:
            s.maximizedId === panelId ? s.hiddenIds : s.hiddenIds.filter((h) => h !== panelId),
        })),
      resetLayout: () => {
        set({ maximizedId: null, hiddenIds: [] })
        commit(createDefault())
      },
    }
  })
}

/** The main shell dock (chat | timeline). */
export const useDockLayoutStore = createDockLayoutStore({
  storageKey: DOCK_LAYOUT_STORAGE_KEY,
  createDefault: createDefaultDockModel,
})

// ── Selector hooks ──────────────────────────────────────────────────────────

export const useDockModel = (): DockModel => useDockLayoutStore((s) => s.model)

export const useDockMaximizedId = (): string | null => useDockLayoutStore((s) => s.maximizedId)

/** Selector: the panels currently collapsed to hidden strips. */
export const useDockHiddenIds = (): string[] => useDockLayoutStore((s) => s.hiddenIds)

/** Selector: is a given panel currently maximized? */
export const selectIsMaximized =
  (panelId: string) =>
  (s: DockLayoutState): boolean =>
    s.maximizedId === panelId
