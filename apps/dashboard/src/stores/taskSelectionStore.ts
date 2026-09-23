// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Task selection store (ZCode focused-task borrowing): which task the
 * user is looking at and which surface selected it (trajectory pane vs
 * task panel), so the two panes can stay in sync without importing each
 * other — both talk to this store instead.
 */
import { create } from "zustand"

/** Where the selection came from — drives the "selected here" highlight. */
export type TaskSelectionSource = "timeline" | "taskPanel"

interface TaskSelectionState {
  taskId: string | null
  source: TaskSelectionSource | null
  /** Select a task; re-selecting the same task keeps the newest source. */
  select: (taskId: string, source: TaskSelectionSource) => void
  clear: () => void
}

export const useTaskSelectionStore = create<TaskSelectionState>((set) => ({
  taskId: null,
  source: null,
  select: (taskId, source) => set({ taskId, source }),
  clear: () => set({ taskId: null, source: null }),
}))

/** Selector hook: the currently selected task id (null when none). */
export const useSelectedTaskId = (): string | null => useTaskSelectionStore((s) => s.taskId)

/** Selector hook: where the current selection was made from. */
export const useSelectedTaskSource = (): TaskSelectionSource | null =>
  useTaskSelectionStore((s) => s.source)
