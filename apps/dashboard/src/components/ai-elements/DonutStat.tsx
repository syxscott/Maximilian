// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DonutStat — ratio ring (ZCode donut borrowing): two SVG circles, the
 * value one drawn with the model's stroke-dasharray and rotated to start
 * at 12 o'clock; the ratio is repeated as center text.
 */
import { useLocale, t, formatPercent } from "@max/i18n"
import { cn } from "@/lib/utils"
import { donutModel } from "./model"

export interface DonutStatProps {
  /** 0–1 fraction, 0–100 percent, or passthrough { value }. */
  value: unknown
  size?: number
  className?: string
  /** Override the localized accessible label. */
  ariaLabel?: string
}

export function DonutStat({ value, size = 36, className, ariaLabel }: DonutStatProps) {
  useLocale()
  const stroke = 4
  const radius = (size - stroke) / 2
  const { ratio, dash } = donutModel(value, radius)

  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      aria-label={ariaLabel ?? t("aiElements.donut.aria")}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        {ratio > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={dash}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className={cn(
              "stroke-current",
              ratio >= 0.9 ? "text-emerald-600" : ratio >= 0.5 ? "text-blue-600" : "text-amber-600",
            )}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] tabular-nums text-foreground">
        {formatPercent(ratio)}
      </span>
    </span>
  )
}
