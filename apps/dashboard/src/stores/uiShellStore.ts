// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * UI shell state — one zustand store per domain (ZCode store/ borrowing).
 * This store owns shell chrome: active tab, sidebar visibility, palette
 * open state and the trajectory focus task. App components subscribe with
 * selectors so a tab switch never re-renders the conversation.
 */
import { create } from "zustand"
import type { DashboardTab } from "@/lib/commands"

interface UiShellState {
  tab: DashboardTab
  sidebarHidden: boolean
  commandOpen: boolean
  /** Task whose trajectory is focused in the trajectory pane. */
  trajectoryTaskId: string | null
  setTab: (tab: DashboardTab) => void
  toggleSidebar: () => void
  setCommandOpen: (open: boolean) => void
  setTrajectoryTaskId: (taskId: string | null) => void
}

export const useUiShellStore = create<UiShellState>((set) => ({
  tab: "workspace",
  sidebarHidden: false,
  commandOpen: false,
  trajectoryTaskId: null,
  setTab: (tab) => set({ tab }),
  toggleSidebar: () => set((s) => ({ sidebarHidden: !s.sidebarHidden })),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setTrajectoryTaskId: (trajectoryTaskId) => set({ trajectoryTaskId }),
}))

/**
 * Notification toasts (ZCode toast borrowing) — transient messages with
 * auto-dismiss. Domains publish via `notify()`, a single <ToastHost/>
 * renders.
 */
export type ToastKind = "info" | "success" | "error"

export interface Toast {
  id: number
  kind: ToastKind
  /** i18n key. */
  messageKey: string
  /** Interpolation params. */
  params?: Record<string, string>
}

interface ToastState {
  toasts: Toast[]
  notify: (kind: ToastKind, messageKey: string, params?: Record<string, string>) => void
  dismiss: (id: number) => void
}

let toastSeq = 0
const TOAST_TTL_MS = 5000

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  notify: (kind, messageKey, params) => {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, kind, messageKey, params }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, TOAST_TTL_MS)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
