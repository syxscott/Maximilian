// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SkeletonBlock — loading placeholder (ZCode skeleton borrowing): text
 * lines, a rect or a circle, shimmering via animate-pulse; shape is
 * normalized by the model from loose passthrough input.
 */
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { skeletonModel } from "./model"
import type { SkeletonVariant } from "./model"

export interface SkeletonBlockProps {
  /** Line count (number), variant (string) or { variant, lines }. */
  shape: unknown
  className?: string
}

const LINE_WIDTHS = ["w-full", "w-11/12", "w-5/6", "w-4/5", "w-3/4", "w-2/3", "w-7/12", "w-1/2"]

const VARIANT_BLOCKS: Record<SkeletonVariant, string> = {
  text: "",
  rect: "h-24 w-full rounded-md",
  circle: "h-10 w-10 rounded-full",
}

export function SkeletonBlock({ shape, className }: SkeletonBlockProps) {
  useLocale()
  const { variant, lines } = skeletonModel(shape)

  return (
    <div
      role="status"
      aria-label={t("aiElements.skeleton.aria")}
      aria-busy="true"
      className={cn("animate-pulse", className)}
    >
      {variant !== "text" ? (
        <div className={cn("bg-muted", VARIANT_BLOCKS[variant])} />
      ) : (
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: lines }, (_, i) => (
            <div
              key={i}
              className={cn("h-3 rounded bg-muted", LINE_WIDTHS[i % LINE_WIDTHS.length])}
            />
          ))}
        </div>
      )}
    </div>
  )
}
