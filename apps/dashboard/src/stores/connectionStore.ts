// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Connection store (ZCode status-bar borrowing): the API transport's
 * health as shown by the status pill — reachable / degraded / unreachable,
 * the most recent error and how many times the app has retried. The
 * store never probes anything itself; the App layer injects health
 * events (setHealth) and failures (setError) from its SSE / query
 * lifecycle, so there is exactly one writer per signal. No persistence —
 * health is meaningless across reloads.
 */
import { create } from "zustand"

export type HealthStatus = "reachable" | "degraded" | "unreachable"

export const HEALTH_STATUSES: readonly HealthStatus[] = ["reachable", "degraded", "unreachable"]

export interface ConnectionError {
  /** Already-shaped message (the producer translated if needed). */
  message: string
  /** Epoch ms when the error was observed. */
  at: number
}

/** Defensive status coercion — passthrough event payloads may carry junk. */
export function coerceHealth(value: unknown): HealthStatus | undefined {
  return typeof value === "string" && (HEALTH_STATUSES as readonly string[]).includes(value)
    ? (value as HealthStatus)
    : undefined
}

/** Bounded message — non-strings and empty strings collapse to null. */
export function coerceErrorMessage(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed.slice(0, max)
}

/** Pure i18n key for the status pill label — components translate it. */
export function healthLabelKey(status: HealthStatus): string {
  return `stores.connection.status.${status}`
}

interface ConnectionState {
  status: HealthStatus
  lastError: ConnectionError | null
  retryCount: number
  /** Epoch ms of the last health event, null before the first one. */
  lastCheckedAt: number | null
  /** App-layer injection: a fresh health observation. Reaching healthy
   *  clears the sticky error and the retry counter. */
  setHealth: (status: unknown, at?: number) => void
  /** App-layer injection: a transport failure — degrades status and
   *  records the sticky error until a healthy observation replaces it. */
  setError: (message: unknown, at?: number) => void
  /** The user (or an auto-retry timer) asked to try again. */
  retry: () => void
  clearError: () => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: "reachable",
  lastError: null,
  retryCount: 0,
  lastCheckedAt: null,
  setHealth: (status, at) => {
    const next = coerceHealth(status)
    if (!next) return
    set({
      status: next,
      lastCheckedAt: typeof at === "number" && Number.isFinite(at) ? at : Date.now(),
      // Healthy observations reset the failure bookkeeping; degraded and
      // unreachable keep the sticky error visible.
      ...(next === "reachable" ? { lastError: null, retryCount: 0 } : {}),
    })
  },
  setError: (message, at) => {
    const text = coerceErrorMessage(message)
    if (text === null) return
    set((s) => ({
      status: s.status === "unreachable" ? "unreachable" : "degraded",
      lastError: {
        message: text,
        at: typeof at === "number" && Number.isFinite(at) ? at : Date.now(),
      },
    }))
  },
  retry: () => set((s) => ({ retryCount: s.retryCount + 1 })),
  clearError: () => set({ lastError: null }),
}))

// ── Selector hooks ──────────────────────────────────────────────────────────

export const useConnectionStatus = (): HealthStatus => useConnectionStore((s) => s.status)

export const useConnectionError = (): ConnectionError | null =>
  useConnectionStore((s) => s.lastError)

export const useConnectionRetryCount = (): number => useConnectionStore((s) => s.retryCount)
