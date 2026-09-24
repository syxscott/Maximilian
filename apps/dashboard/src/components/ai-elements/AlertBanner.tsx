// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * AlertBanner — inline alert (ZCode alert borrowing): four variants
 * (info / warn / error / success) with icon, optional title (defaults to
 * the localized variant name) and body text.
 */
import { AlertTriangle, CheckCircle, Info, XCircle } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { alertVariant } from "./model"
import type { AlertVariant } from "./model"

export interface AlertBannerProps {
  /** Passthrough level string ("warning", "danger", "ok", …). */
  variant: unknown
  /** Optional headline; defaults to the localized variant label. */
  title?: string
  /** Body text (children win over the `text` prop). */
  text?: string
  children?: React.ReactNode
  className?: string
}

const ALERT_ICONS: Record<AlertVariant, LucideIcon> = {
  info: Info,
  warn: AlertTriangle,
  error: XCircle,
  success: CheckCircle,
}

const ALERT_CLASSES: Record<AlertVariant, string> = {
  info: "border-blue-500/40 bg-blue-500/10 text-blue-700",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  error: "border-red-500/40 bg-red-500/10 text-red-700",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
}

export function AlertBanner({ variant, title, text, children, className }: AlertBannerProps) {
  useLocale()
  const v = alertVariant(variant)
  const Icon = ALERT_ICONS[v]

  return (
    <div
      role={v === "error" || v === "warn" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        ALERT_CLASSES[v],
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{title ?? t(`aiElements.alert.${v}`)}</div>
        {(text ?? children) !== undefined && (
          <div className="mt-0.5 text-foreground/80">{text ?? children}</div>
        )}
      </div>
    </div>
  )
}
