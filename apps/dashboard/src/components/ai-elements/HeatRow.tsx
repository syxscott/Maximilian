// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * HeatRow — single-row heat strip (GitHub-contribution borrowing): the
 * model tiers each value 0–4 relative to the row's own min/max; the cell
 * color is the tier ramp. Missing values render as empty slots.
 */
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { heatRowModel } from "./model"
import type { HeatCell } from "./model"

export interface HeatRowProps {
  /** Numeric series (null/missing entries tolerated). */
  values: unknown
  cellSize?: number
  className?: string
}

const TIER_CLASSES = [
  "bg-muted/50",
  "bg-emerald-500/25",
  "bg-emerald-500/45",
  "bg-emerald-500/70",
  "bg-emerald-600",
] as const

function Cell({ cell, size }: { cell: HeatCell; size: number }) {
  return (
    <span
      className={cn("inline-block rounded-[2px]", TIER_CLASSES[cell.tier])}
      style={{ width: size, height: size }}
      title={cell.value !== undefined ? String(cell.value) : undefined}
    />
  )
}

export function HeatRow({ values, cellSize = 10, className }: HeatRowProps) {
  useLocale()
  const cells = heatRowModel(values)
  const empty = cells.every((cell) => cell.tier === 0)

  return (
    <span
      role="img"
      aria-label={t("aiElements.heat.aria")}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {empty ? (
        <span className="text-[10px] text-muted-foreground italic">
          {t("aiElements.heat.empty")}
        </span>
      ) : (
        cells.map((cell, i) => <Cell key={i} cell={cell} size={cellSize} />)
      )}
    </span>
  )
}
