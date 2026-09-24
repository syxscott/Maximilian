// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Sparkline (ai-elements) — dependency-free inline trend line: pure SVG
 * polyline from the model's defensively coerced points, with a dot on the
 * last sample. Unlike the _helpers variant it accepts passthrough arrays
 * (non-numeric entries dropped) and reports min/max through the model.
 */
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { sparklineModel } from "./model"

export interface SparklineProps {
  /** Numeric series (passthrough values tolerated). */
  values: unknown
  width?: number
  height?: number
  className?: string
  /** Override the localized accessible label. */
  ariaLabel?: string
}

export function Sparkline({
  values,
  width = 96,
  height = 24,
  className,
  ariaLabel,
}: SparklineProps) {
  useLocale()
  const { points, polyline, min, max } = sparklineModel(values, width, height)
  const last = points.at(-1)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? t("aiElements.sparkline.aria")}
      className={cn("shrink-0", className)}
    >
      {points.length > 0 && (
        <>
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-blue-600"
            points={polyline}
          />
          {last !== undefined && (
            <circle cx={last.x} cy={last.y} r={1.8} className="fill-blue-600" />
          )}
          <title>{`${t("aiElements.sparkline.range", {
            min: String(Math.round(min * 100) / 100),
            max: String(Math.round(max * 100) / 100),
          })}`}</title>
        </>
      )}
    </svg>
  )
}
