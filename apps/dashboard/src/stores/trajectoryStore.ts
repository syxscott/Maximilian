// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Trajectory view store (ZCode timeline borrowing): the *view parameters*
 * of the trajectory / timeline pane — text query, state filter, how many
 * entries the visible window shows and which task's timeline is being
 * browsed. Division of labour with taskSelectionStore: THAT store is the
 * cross-pane "which task is selected" signal (selection source and all);
 * THIS store holds the timeline pane's own knobs, so resetting a filter
 * never disturbs a selection made elsewhere. No persistence — view knobs
 * reset to sane defaults on reload.
 */
import { create } from "zustand"

export type TrajectoryStateFilter = "all" | "running" | "completed" | "failed"

export const TRAJECTORY_FILTERS: readonly TrajectoryStateFilter[] = [
  "all",
  "running",
  "completed",
  "failed",
]

/** Visible-window bounds — small enough to render, big enough to browse. */
export const TRAJECTORY_WINDOW_MIN = 10
export const TRAJECTORY_WINDOW_MAX = 500
export const TRAJECTORY_WINDOW_DEFAULT = 50

/** Clamp a requested window size into the renderable range. */
export function clampWindowSize(size: number): number {
  if (!Number.isFinite(size)) return TRAJECTORY_WINDOW_DEFAULT
  return Math.min(TRAJECTORY_WINDOW_MAX, Math.max(TRAJECTORY_WINDOW_MIN, Math.round(size)))
}

/**
 * Pure visible-window math for the trajectory pane: the store's
 * windowSize caps how many of the derived entries the pane shows (the
 * tail wins), the expanded flag lifts the cap entirely. This replaces
 * the pane's former in-component useState pair (window slice + expand),
 * so the visible window survives pane remounts and other surfaces (dock
 * leaf headers, keyboard affordances) can drive the same knobs.
 */
export function windowTrajectoryEntries<T>(
  entries: readonly T[],
  windowSize: number,
  expanded: boolean,
): T[] {
  if (expanded) return [...entries]
  const size = clampWindowSize(windowSize)
  return entries.slice(Math.max(0, entries.length - size))
}

/** Pure filter predicate — unknown task fields never match a non-all filter. */
export function matchesFilter(
  task: { state?: unknown; label?: unknown },
  query: string,
  filter: TrajectoryStateFilter,
): boolean {
  if (filter !== "all" && task.state !== filter) return false
  const q = query.trim().toLowerCase()
  if (q === "") return true
  const label = typeof task.label === "string" ? task.label.toLowerCase() : ""
  return label.includes(q)
}

interface TrajectoryState {
  /** Text query filtering the timeline entries (trimmed on match, kept raw here). */
  query: string
  stateFilter: TrajectoryStateFilter
  /** How many entries the visible window shows. */
  windowSize: number
  /** Expanded pane shows every derived entry (window cap lifted). */
  expanded: boolean
  /** The task whose timeline the pane is browsing (view-local). */
  selectedTaskId: string | null
  setQuery: (query: string) => void
  setStateFilter: (filter: TrajectoryStateFilter) => void
  setWindowSize: (size: number) => void
  /** Grow the window (the "show more" affordance) by a delta. */
  showMore: (delta: number) => void
  toggleExpanded: () => void
  selectTask: (taskId: string | null) => void
  /** Reset query + filter back to defaults (window size and selection stay). */
  clearFilters: () => void
  reset: () => void
}

export const useTrajectoryStore = create<TrajectoryState>((set) => ({
  query: "",
  stateFilter: "all",
  windowSize: TRAJECTORY_WINDOW_DEFAULT,
  expanded: false,
  selectedTaskId: null,
  setQuery: (query) => set({ query: query.slice(0, 300) }),
  setStateFilter: (filter) =>
    set({ stateFilter: TRAJECTORY_FILTERS.includes(filter) ? filter : "all" }),
  setWindowSize: (size) => set({ windowSize: clampWindowSize(size) }),
  showMore: (delta) =>
    set((s) => ({
      windowSize: clampWindowSize(s.windowSize + (Number.isFinite(delta) ? delta : 0)),
    })),
  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
  selectTask: (taskId) => set({ selectedTaskId: taskId === "" ? null : taskId }),
  clearFilters: () => set({ query: "", stateFilter: "all" }),
  reset: () =>
    set({
      query: "",
      stateFilter: "all",
      windowSize: TRAJECTORY_WINDOW_DEFAULT,
      expanded: false,
      selectedTaskId: null,
    }),
}))

// ── Selector hooks ──────────────────────────────────────────────────────────

export const useTrajectoryQuery = (): string => useTrajectoryStore((s) => s.query)

export const useTrajectoryFilter = (): TrajectoryStateFilter =>
  useTrajectoryStore((s) => s.stateFilter)

export const useTrajectoryWindowSize = (): number => useTrajectoryStore((s) => s.windowSize)

export const useTrajectoryExpanded = (): boolean => useTrajectoryStore((s) => s.expanded)

export const useTrajectoryTaskId = (): string | null => useTrajectoryStore((s) => s.selectedTaskId)
