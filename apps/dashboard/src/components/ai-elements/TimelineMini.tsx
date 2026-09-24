// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TimelineMini — vertical mini timeline (ZCode timeline borrowing): dot +
 * connector line per entry; the model maps statuses to dot tones
 * (completed → accent, failed → danger, else muted).
 */
import { Circle } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { timelineMiniModel } from "./model"
import type { TimelineTone } from "./model"

export interface TimelineMiniProps {
  /** Passthrough { items: [...] } / { events: [...] } part. */
  timeline: unknown
  className?: string
}

const TONE_DOT: Record<TimelineTone, string> = {
  muted: "border-muted-foreground/40 bg-muted",
  accent: "border-emerald-500 bg-emerald-500/20",
  danger: "border-red-500 bg-red-500/20",
}

export function TimelineMini({ timeline, className }: TimelineMiniProps) {
  useLocale()
  const items = timelineMiniModel(timeline)

  if (items.length === 0) {
    return (
      <div className={cn("text-xs text-muted-foreground italic", className)}>
        {t("aiElements.timeline.empty")}
      </div>
    )
  }

  return (
    <ol aria-label={t("aiElements.timeline.aria")} className={cn("text-xs", className)}>
      {items.map((item, i) => (
        <li key={i} className="relative flex gap-2.5 pb-2.5 last:pb-0">
          {i < items.length - 1 && (
            <span aria-hidden="true" className="absolute top-4 left-[5px] h-full w-px bg-border" />
          )}
          <Circle
            aria-hidden="true"
            className={cn(
              "relative z-10 mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-background p-0",
              TONE_DOT[item.tone],
            )}
            strokeWidth={2}
          />
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="min-w-0 truncate" title={item.label}>
              {item.label}
            </span>
            {item.time !== undefined && (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                {item.time}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}
