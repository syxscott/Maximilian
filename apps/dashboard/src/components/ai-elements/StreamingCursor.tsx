// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * StreamingCursor — blinking caret appended to streaming assistant text
 * (ZCode streaming borrowing). Pure tailwind: animate-pulse over a block
 * caret, decorative (aria-hidden) with an sr-only localized hint.
 */
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"

export interface StreamingCursorProps {
  className?: string
}

export function StreamingCursor({ className }: StreamingCursorProps) {
  useLocale()
  return (
    <span className={cn("inline-flex items-baseline", className)}>
      <span
        aria-hidden="true"
        className="inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse rounded-sm bg-foreground"
      />
      <span className="sr-only">{t("aiElements.streaming.cursor")}</span>
    </span>
  )
}
