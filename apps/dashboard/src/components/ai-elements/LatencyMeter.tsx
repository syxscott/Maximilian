// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * LatencyMeter — horizontal latency bar with rating color (ZCode perf
 * borrowing): green < 1s, yellow < 5s, red beyond. Fill width is capped
 * on a 10s scale so extreme outliers stay readable.
 */
import { useLocale, t, formatDuration } from "@max/i18n"
import { cn } from "@/lib/utils"
import { latencyBarPercent, latencyRating } from "./model"
import type { LatencyRating } from "./model"

export interface LatencyMeterProps {
  /** Duration in milliseconds. */
  ms: number
  /** Render the compact inline variant (no bar track). */
  compact?: boolean
  className?: string
}

const RATING_BAR: Record<LatencyRating, string> = {
  fast: "bg-emerald-500",
  moderate: "bg-amber-500",
  slow: "bg-red-500",
}

const RATING_TEXT: Record<LatencyRating, string> = {
  fast: "text-emerald-600",
  moderate: "text-amber-600",
  slow: "text-red-600",
}

export function LatencyMeter({ ms, compact = false, className }: LatencyMeterProps) {
  useLocale()
  const rating = latencyRating(ms)
  const percent = latencyBarPercent(ms)
  const label = t(`aiElements.latency.${rating}`, { duration: formatDuration(ms) })

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[10px] text-muted-foreground",
        className,
      )}
      title={label}
    >
      <span className={cn("font-mono tabular-nums", RATING_TEXT[rating])}>
        {formatDuration(ms)}
      </span>
      {!compact && (
        <span
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-label={label}
          className="h-1 w-16 overflow-hidden rounded-full bg-muted"
        >
          <span
            className={cn("block h-full rounded-full transition-[width]", RATING_BAR[rating])}
            style={{ width: `${percent}%` }}
          />
        </span>
      )}
    </span>
  )
}
