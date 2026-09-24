// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Dock layout state (zustand wrapper around the pure dockModel): the
 * layout model plus which panel is maximized, with every structural
 * change mirrored to localStorage under "maximilian.dock-layout" so the
 * arrangement survives reloads. All tree surgery is delegated to the
 * pure functions in dockModel.ts — this module only owns persistence
 * and the maximize toggle. Storage access is defensive (try/catch).
 */
import { create } from "zustand"
import {
  type DockDirection,
  type DockModel,
  addPanel as addPanelModel,
  createDefaultDockModel,
  deserializeDockModel,
  findLeaf,
  flattenPanels,
  removePanel as removePanelModel,
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

/** Read the persisted layout; never throws (junk → default shell). */
export function loadDockLayout(storage: Storage | undefined = defaultStorage()): DockModel {
  if (!storage) return createDefaultDockModel()
  try {
    return deserializeDockModel(storage.getItem(DOCK_LAYOUT_STORAGE_KEY))
  } catch {
    return createDefaultDockModel()
  }
}

/** Write the layout to storage; never throws. */
export function persistDockLayout(
  model: DockModel,
  storage: Storage | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(DOCK_LAYOUT_STORAGE_KEY, serializeDockModel(model))
  } catch {
    // Quota exceeded / storage disabled — the layout simply stays in memory.
  }
}

interface DockLayoutState {
  model: DockModel
  /** The fullscreen panel, null when none is maximized. Not persisted. */
  maximizedId: string | null
  /**
   * Split the target leaf and open a new panel beside/below it
   * (defaults: the active panel, horizontally). With no panels open,
   * creates the first one. Returns the new panel id, null when nothing
   * changed (duplicate id, dock full).
   */
  addPanel: (targetId?: string, direction?: DockDirection) => string | null
  removePanel: (panelId: string) => void
  resizeSplit: (splitId: string, ratio: number) => void
  setActive: (panelId: string | null) => void
  /** Fullscreen one panel; toggling the maximized panel restores. */
  toggleMaximize: (panelId: string) => void
  resetLayout: () => void
}

let panelSeq = 0

export const useDockLayoutStore = create<DockLayoutState>((set, get) => {
  const commit = (model: DockModel) => {
    persistDockLayout(model)
    set({ model })
  }
  return {
    model: loadDockLayout(),
    maximizedId: null,
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
    removePanel: (panelId) => {
      const next = removePanelModel(get().model, panelId)
      if (next === get().model) return
      set((s) => ({ maximizedId: s.maximizedId === panelId ? null : s.maximizedId }))
      commit(next)
    },
    resizeSplit: (splitId, ratio) => {
      const next = resizeSplitModel(get().model, splitId, ratio)
      if (next !== get().model) commit(next)
    },
    setActive: (panelId) => {
      const next = setActiveModel(get().model, panelId)
      if (next !== get().model) set({ model: next })
    },
    toggleMaximize: (panelId) =>
      set((s) => ({ maximizedId: s.maximizedId === panelId ? null : panelId })),
    resetLayout: () => {
      set({ maximizedId: null })
      commit(createDefaultDockModel())
    },
  }
})

// ── Selector hooks ──────────────────────────────────────────────────────────

export const useDockModel = (): DockModel => useDockLayoutStore((s) => s.model)

export const useDockMaximizedId = (): string | null => useDockLayoutStore((s) => s.maximizedId)

/** Selector: is a given panel currently maximized? */
export const selectIsMaximized =
  (panelId: string) =>
  (s: DockLayoutState): boolean =>
    s.maximizedId === panelId
