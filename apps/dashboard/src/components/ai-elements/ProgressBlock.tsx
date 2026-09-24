// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ProgressBlock — labeled progress bar (ZCode progress borrowing):
 * 0–100 clamp with fraction-aware coercion, accessible meter semantics.
 */
import { useLocale, t, formatNumber } from "@max/i18n"
import { cn } from "@/lib/utils"
import { progressModel } from "./model"

export interface ProgressBlockProps {
  /** 0–100, 0–1 fraction, or passthrough { value, label }. */
  progress: unknown
  className?: string
}

export function ProgressBlock({ progress, className }: ProgressBlockProps) {
  useLocale()
  const { value, label } = progressModel(progress)

  return (
    <div className={cn("text-xs", className)}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-muted-foreground" title={label}>
          {label ?? t("aiElements.progress.title")}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
          {formatNumber(Math.round(value))}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        aria-label={label ?? t("aiElements.progress.aria")}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-blue-600 transition-[width]"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  )
}
