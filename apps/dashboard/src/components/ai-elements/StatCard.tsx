// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * StatCard — single statistic tile (dashboard borrowing): label, display
 * value and a trend arrow; a numeric delta reuses DeltaBadge.
 */
import { ArrowDown, ArrowUp, Minus } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { DeltaBadge } from "./DeltaBadge"
import { statCardModel } from "./model"
import type { TrendDirection } from "./model"

export interface StatCardProps {
  /** Passthrough { label, value, trend, delta } payload. */
  stat: unknown
  className?: string
}

const TREND_ICONS: Record<TrendDirection, LucideIcon> = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
}

const TREND_CLASSES: Record<TrendDirection, string> = {
  up: "text-emerald-600",
  down: "text-red-600",
  flat: "text-muted-foreground",
}

export function StatCard({ stat, className }: StatCardProps) {
  useLocale()
  const { label, value, direction, delta } = statCardModel(stat)
  const Icon = TREND_ICONS[direction]

  return (
    <div className={cn("rounded-md border border-border bg-muted/20 px-3 py-2 text-xs", className)}>
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <span className="min-w-0 truncate" title={label}>
          {label !== "" ? label : t("aiElements.statCard.unlabeled")}
        </span>
        <Icon
          aria-label={t(
            `aiElements.statCard.trend${direction.charAt(0).toUpperCase()}${direction.slice(1)}`,
          )}
          className={cn("h-3.5 w-3.5 shrink-0", TREND_CLASSES[direction])}
        />
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="truncate text-lg font-semibold tabular-nums" title={value}>
          {value !== "" ? value : "—"}
        </span>
        {delta !== undefined && <DeltaBadge delta={delta} />}
      </div>
    </div>
  )
}
