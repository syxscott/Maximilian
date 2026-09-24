// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DeltaBadge — signed delta chip (dashboard borrowing): positive reads
 * green "+N", negative red "-N", zero neutral. Non-numeric input
 * degrades to the neutral 0 badge.
 */
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { deltaBadgeModel } from "./model"

export interface DeltaBadgeProps {
  /** Numeric delta (passthrough tolerated). */
  delta: unknown
  className?: string
}

export function DeltaBadge({ delta, className }: DeltaBadgeProps) {
  useLocale()
  const { direction, text } = deltaBadgeModel(delta)

  return (
    <span
      aria-label={t(`aiElements.delta.${direction}`)}
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
        direction === "up"
          ? "bg-emerald-500/10 text-emerald-700"
          : direction === "down"
            ? "bg-red-500/10 text-red-700"
            : "bg-muted/50 text-muted-foreground",
        className,
      )}
    >
      {text}
    </span>
  )
}
