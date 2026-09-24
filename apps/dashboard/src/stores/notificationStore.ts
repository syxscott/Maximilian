// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Notification center store (ZCode notificationsStore borrowing): the
 * durable sibling of the transient toast list in uiShellStore. Domains
 * publish structured notifications (info / success / warning / error)
 * with i18n message keys; a future <NotificationCenter/> consumes the
 * list, unread badge and bulk actions. Read state survives reloads via
 * localStorage — every storage touch is defensive (try/catch), private-
 * mode browsers throw and notifications are too cheap to crash over.
 */
import { create } from "zustand"

export const NOTIFICATIONS_STORAGE_KEY = "maximilian.notifications"

/** Newest-first cap so a chatty session can never grow the list unbounded. */
export const NOTIFICATIONS_LIMIT = 50

export type NotificationKind = "info" | "success" | "warning" | "error"

export interface NotificationItem {
  id: string
  kind: NotificationKind
  /** i18n key for the message body — components translate at render time. */
  messageKey: string
  /** Interpolation params for {placeholders} inside the message. */
  params?: Record<string, string>
  /** Epoch ms when the notification arrived. */
  createdAt: number
  read: boolean
}

const KINDS: readonly NotificationKind[] = ["info", "success", "warning", "error"]

function isKind(v: unknown): v is NotificationKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v)
}

/** Bounded string — empty and non-string values collapse to undefined. */
function bounded(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined
}

/** Bounded params record — only string→string entries survive. */
function boundedParams(v: unknown): Record<string, string> | undefined {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  let kept = 0
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const s = bounded(val, 200)
    if (k !== "" && s !== undefined && kept < 8) {
      out[k.slice(0, 40)] = s
      kept += 1
    }
  }
  return kept > 0 ? out : undefined
}

/** Defensive parse — anything that is not a notification array becomes []. */
export function parseNotifications(raw: string | null | undefined): NotificationItem[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: NotificationItem[] = []
  for (const entry of parsed.slice(0, NOTIFICATIONS_LIMIT)) {
    if (entry === null || typeof entry !== "object") continue
    const o = entry as Record<string, unknown>
    const id = bounded(o.id, 120)
    const messageKey = bounded(o.messageKey, 200)
    if (!id || !messageKey) continue
    const params = boundedParams(o.params)
    out.push({
      id,
      kind: isKind(o.kind) ? o.kind : "info",
      messageKey,
      ...(params ? { params } : {}),
      createdAt: typeof o.createdAt === "number" && Number.isFinite(o.createdAt) ? o.createdAt : 0,
      read: o.read === true,
    })
  }
  return out
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined
  } catch {
    return undefined
  }
}

/** Read persisted notifications; never throws. */
export function loadNotifications(
  storage: Storage | undefined = defaultStorage(),
): NotificationItem[] {
  if (!storage) return []
  try {
    return parseNotifications(storage.getItem(NOTIFICATIONS_STORAGE_KEY))
  } catch {
    return []
  }
}

/** Write notifications to storage; never throws. */
export function persistNotifications(
  items: NotificationItem[],
  storage: Storage | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Quota exceeded / storage disabled — the list simply stays in memory.
  }
}

/** Pure unread count. */
export function countUnread(items: readonly NotificationItem[]): number {
  return items.reduce((n, item) => (item.read ? n : n + 1), 0)
}

/** Pure prepend + cap: newest first, never above NOTIFICATIONS_LIMIT. */
export function pushNotification(
  items: NotificationItem[],
  item: NotificationItem,
  limit = NOTIFICATIONS_LIMIT,
): NotificationItem[] {
  return [item, ...items].slice(0, limit)
}

interface NotificationState {
  items: NotificationItem[]
  /** Publish one notification (newest first; id must be caller-unique). */
  push: (
    kind: NotificationKind,
    messageKey: string,
    params?: Record<string, string>,
    id?: string,
  ) => void
  markRead: (id: string) => void
  markAllRead: () => void
  remove: (id: string) => void
  /** Drop every notification (the "clear all" bulk action). */
  clear: () => void
}

let notificationSeq = 0

export const useNotificationStore = create<NotificationState>((set) => ({
  items: loadNotifications(),
  push: (kind, messageKey, params, id) =>
    set((s) => {
      const item: NotificationItem = {
        id: id ?? `ntf-${++notificationSeq}`,
        kind,
        messageKey,
        ...(params ? { params } : {}),
        createdAt: Date.now(),
        read: false,
      }
      const items = pushNotification(s.items, item)
      persistNotifications(items)
      return { items }
    }),
  markRead: (id) =>
    set((s) => {
      const items = s.items.map((item) => (item.id === id ? { ...item, read: true } : item))
      persistNotifications(items)
      return { items }
    }),
  markAllRead: () =>
    set((s) => {
      const items = s.items.map((item) => (item.read ? item : { ...item, read: true }))
      persistNotifications(items)
      return { items }
    }),
  remove: (id) =>
    set((s) => {
      const items = s.items.filter((item) => item.id !== id)
      if (items.length === s.items.length) return s
      persistNotifications(items)
      return { items }
    }),
  clear: () =>
    set(() => {
      persistNotifications([])
      return { items: [] }
    }),
}))

// ── Selector hooks ──────────────────────────────────────────────────────────

export const useNotifications = (): NotificationItem[] => useNotificationStore((s) => s.items)

export const useUnreadCount = (): number => useNotificationStore((s) => countUnread(s.items))
