// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ToastHost — the render side of notificationStore (ZCode notifications
 * borrowing). Domains publish structured notifications via `push()`
 * (workspace switch failures, steering rejections, job creation, …) and
 * this host shows the latest unread entries as a transient stack; the
 * full durable list remains in the store for a future notification
 * center. Dismissing removes the entry from the store.
 */

import { useEffect } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import { useNotifications, useUnreadCount } from "@/stores/notificationStore"
import type { NotificationKind } from "@/stores/notificationStore"
import { useNotificationStore } from "@/stores/notificationStore"

const KIND_STYLE: Record<NotificationKind, string> = {
  info: "border-border bg-popover text-popover-foreground",
  success: "border-border bg-popover text-popover-foreground",
  warning: "border-amber-500/60 bg-popover text-popover-foreground",
  error: "border-destructive/60 bg-popover text-popover-foreground",
}

const KIND_DOT: Record<NotificationKind, string> = {
  info: "bg-blue-500",
  success: "bg-green-500",
  warning: "bg-amber-500",
  error: "bg-destructive",
}

/** How many of the newest unread notifications the stack shows at once. */
const MAX_VISIBLE_TOASTS = 3

/** Auto-dismiss window for one toast (the store itself stays durable). */
const TOAST_TTL_MS = 6000

export function ToastHost() {
  useLocale()
  const items = useNotifications()
  const unread = useUnreadCount()
  const visible = items.filter((n) => !n.read).slice(0, MAX_VISIBLE_TOASTS)

  // Auto-retire toasts after their TTL — markRead keeps the durable list
  // (a future notification center still shows history) while the stack
  // only ever renders unread entries.
  useEffect(() => {
    if (visible.length === 0) return
    const timers = visible.map((n) =>
      setTimeout(() => useNotificationStore.getState().markRead(n.id), TOAST_TTL_MS),
    )
    return () => timers.forEach(clearTimeout)
  }, [items])

  if (unread === 0) return null

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      data-testid="toast-host"
      role="status"
      aria-live="polite"
    >
      {visible.map((n) => (
        <div
          key={n.id}
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-md ${KIND_STYLE[n.kind]}`}
          data-testid={`toast-${n.kind}`}
        >
          <span
            className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${KIND_DOT[n.kind]}`}
          />
          <span className="max-w-xs break-words">{t(n.messageKey, n.params)}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1 text-muted-foreground"
            aria-label={t("shell.notify.dismiss")}
            onClick={() => useNotificationStore.getState().remove(n.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  )
}
