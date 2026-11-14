// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ContextMeter — composer context-occupancy ring (deepseek
 * skeleton/ContextMeter.tsx mechanism, local-estimate edition): a 14px
 * SVG ring + percentage fed by the chars/4 heuristic over the current
 * draft and the workspace session's events (context.model.ts). Click
 * opens a small breakdown panel (draft / session split). Renders NOTHING
 * without data (no draft, no events) — an empty state has zero occupancy
 * worth displaying.
 */
import { useEffect, useId, useRef, useState } from "react"
import { useLocale, t, formatTokens } from "@max/i18n"
import { cn } from "@/lib/utils"
import type { RuntimeEvent } from "@/api"
import { contextOccupancyModel, sessionCharsFromEvents } from "./context.model"

/** Ring geometry: 14px viewBox, 2px stroke (deepseek parity). */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function ContextMeter({
  draftText,
  events,
}: {
  /** Current composer draft (unsent text). */
  draftText: string
  /** The workspace session's runtime events. */
  events: readonly RuntimeEvent[]
}) {
  useLocale()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelId = useId()
  const occupancy = contextOccupancyModel(draftText.length, sessionCharsFromEvents(events))

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false)
    }
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("pointerdown", onPointerDown)
    }
  }, [open])

  // No data → no meter: a zero-draft, zero-event context has nothing to
  // occupy and rendering "0%" would imply a metered provider. (After the
  // hooks — they must run unconditionally.)
  if (occupancy.totalTokens === 0) return null

  const warn = occupancy.warn
  const tone = warn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"

  return (
    <span ref={rootRef} className="relative inline-flex" data-testid="context-meter">
      <button
        type="button"
        className={cn(
          "flex items-center gap-1 rounded px-1 py-0.5 text-[10px] tabular-nums hover:bg-accent",
          tone,
        )}
        aria-label={t("composer.context.aria", { percent: occupancy.rawPercent })}
        aria-expanded={open}
        aria-controls={panelId}
        title={t("composer.context.title")}
        data-testid="context-meter-trigger"
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <circle cx="7" cy="7" r={RADIUS} fill="none" strokeWidth="2" className="stroke-border" />
          <circle
            cx="7"
            cy="7"
            r={RADIUS}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            className={cn(
              "transition-[stroke-dasharray]",
              warn ? "stroke-amber-500" : "stroke-primary",
            )}
            strokeDasharray={`${(CIRCUMFERENCE * occupancy.percent) / 100} ${CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
            data-testid="context-meter-ring"
          />
        </svg>
        <span data-testid="context-percent">{occupancy.rawPercent}%</span>
      </button>
      {open && (
        <span
          id={panelId}
          role="dialog"
          aria-label={t("composer.context.title")}
          className="absolute bottom-full left-0 z-20 mb-1 block w-56 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md"
          data-testid="context-breakdown"
        >
          <div className="flex items-baseline justify-between">
            <span className="font-medium">{occupancy.rawPercent}%</span>
            <span className="text-[10px] text-muted-foreground">
              {t("composer.context.limit", { limit: formatTokens(occupancy.limit) })}
            </span>
          </div>
          <dl className="mt-1 space-y-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[11px] text-muted-foreground">{t("composer.context.draft")}</dt>
              <dd className="tabular-nums" data-testid="context-breakdown-draft">
                ~{formatTokens(occupancy.draftTokens)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[11px] text-muted-foreground">{t("composer.context.session")}</dt>
              <dd className="tabular-nums" data-testid="context-breakdown-session">
                ~{formatTokens(occupancy.sessionTokens)}
              </dd>
            </div>
          </dl>
          {warn && (
            <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
              {t("composer.context.warn")}
            </p>
          )}
        </span>
      )}
    </span>
  )
}
