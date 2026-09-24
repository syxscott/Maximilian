// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * CountUp — animated numeric readout (dashboard borrowing): the model
 * provides pure easeOutCubic interpolation; the component drives it with
 * requestAnimationFrame and snaps straight to the target when the user
 * prefers reduced motion (or rAF is unavailable).
 */
import { useEffect, useState } from "react"
import { useLocale, formatNumber } from "@max/i18n"
import { cn } from "@/lib/utils"
import { asNumber, countUpValue, prefersReducedMotion } from "./model"

export interface CountUpProps {
  /** Target value (passthrough tolerated). */
  value: unknown
  /** Animation start value. */
  from?: number
  durationMs?: number
  /** Fraction digits (default integer display). */
  decimals?: number
  className?: string
  ariaLabel?: string
}

export function CountUp({
  value,
  from = 0,
  durationMs = 800,
  decimals = 0,
  className,
  ariaLabel,
}: CountUpProps) {
  useLocale()
  const target = asNumber(value) ?? 0
  const instant = prefersReducedMotion() || typeof requestAnimationFrame !== "function"
  const [shown, setShown] = useState(instant ? target : from)

  useEffect(() => {
    if (instant) {
      setShown(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const elapsed = now - t0
      setShown(countUpValue(from, target, elapsed, durationMs))
      if (elapsed < durationMs) raf = requestAnimationFrame(tick)
      else setShown(target)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, from, durationMs, instant])

  return (
    <span aria-label={ariaLabel} className={cn("font-mono tabular-nums", className)}>
      {formatNumber(shown, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </span>
  )
}
