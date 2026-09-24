// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * GaugeArc — semicircular gauge (0–1): the model emits track and value
 * SVG arc paths; the arc color ramps green → amber → red as the ratio
 * fills. Ratio is mirrored in the accessible label.
 */
import { useLocale, t, formatPercent } from "@max/i18n"
import { cn } from "@/lib/utils"
import { gaugeArcModel } from "./model"

export interface GaugeArcProps {
  /** 0–1 fraction, 0–100 percent, or passthrough { value }. */
  value: unknown
  size?: number
  className?: string
  /** Override the localized accessible label. */
  ariaLabel?: string
}

function arcClass(ratio: number): string {
  if (ratio < 0.6) return "stroke-emerald-600"
  if (ratio < 0.85) return "stroke-amber-600"
  return "stroke-red-600"
}

export function GaugeArc({ value, size = 56, className, ariaLabel }: GaugeArcProps) {
  useLocale()
  const stroke = 4
  const radius = (size - stroke * 2) / 2
  const { ratio, trackPath, valuePath } = gaugeArcModel(value, radius)

  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      aria-label={ariaLabel ?? t("aiElements.gauge.aria", { percent: formatPercent(ratio) })}
      className={cn("relative inline-flex shrink-0 flex-col items-center", className)}
    >
      <svg
        width={size}
        height={size / 2 + stroke}
        viewBox={`0 0 ${size} ${size / 2 + stroke}`}
        aria-hidden="true"
      >
        <path
          d={trackPath}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-muted"
        />
        {valuePath !== "" && (
          <path
            d={valuePath}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            className={arcClass(ratio)}
          />
        )}
      </svg>
      <span className="font-mono text-[10px] tabular-nums text-foreground">
        {formatPercent(ratio)}
      </span>
    </span>
  )
}
