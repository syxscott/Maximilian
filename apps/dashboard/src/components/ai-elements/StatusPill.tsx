// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * StatusPill — canonical status capsule for task / message-part statuses
 * (ZCode status borrowing). Any passthrough status string is mapped by
 * the model's alias table to one of five variants; unknown strings read
 * as pending. Running pills pulse.
 */
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { statusVariant } from "./model"
import type { PillVariant } from "./model"

export interface StatusPillProps {
  /** Raw status string ("running", "in_progress", "Done", …). */
  status: unknown
  /**
   * Optional display-text override (a raw role/state the caller wants
   * verbatim, e.g. "user" / "assistant"). Colors and the dot still follow
   * the canonical variant; without it the localized variant name shows.
   */
  label?: string
  className?: string
}

const PILL_CLASSES: Record<PillVariant, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  running: "border-blue-500/40 bg-blue-500/10 text-blue-700",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
  failed: "border-red-500/40 bg-red-500/10 text-red-700",
  skipped: "border-border bg-muted/40 text-muted-foreground",
}

const PILL_DOT: Record<PillVariant, string> = {
  pending: "bg-amber-500",
  running: "bg-blue-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  skipped: "bg-muted-foreground/50",
}

export function StatusPill({ status, label, className }: StatusPillProps) {
  useLocale()
  const variant = statusVariant(status)

  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        PILL_CLASSES[variant],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", PILL_DOT[variant])} />
      {label ?? t(`aiElements.status.${variant}`)}
    </span>
  )
}
