// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * BarMini — dependency-free inline bar chart: baseline-zero SVG rects
 * from the model's defensively coerced bars (negatives clamp to zero,
 * series capped at 60).
 */
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { barMiniModel } from "./model"

export interface BarMiniProps {
  /** Numeric series (passthrough values tolerated). */
  values: unknown
  width?: number
  height?: number
  className?: string
  /** Override the localized accessible label. */
  ariaLabel?: string
}

export function BarMini({ values, width = 96, height = 24, className, ariaLabel }: BarMiniProps) {
  useLocale()
  const { bars, max } = barMiniModel(values, width, height)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? t("aiElements.barMini.aria")}
      className={cn("shrink-0", className)}
    >
      {bars.length > 0 && (
        <>
          <line
            x1={0}
            x2={width}
            y1={height - 0.5}
            y2={height - 0.5}
            className="stroke-border"
            strokeWidth={1}
          />
          {bars.map((bar, i) =>
            bar.height > 0 ? (
              <rect
                key={i}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx={1}
                className="fill-blue-600/80"
              >
                <title>{String(bar.value)}</title>
              </rect>
            ) : null,
          )}
          <title>{t("aiElements.barMini.max", { max: String(Math.round(max * 100) / 100) })}</title>
        </>
      )}
    </svg>
  )
}
