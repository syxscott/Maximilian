// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TextUnitBlock — one extracted text segment (textUnits output) with
 * per-source styling: the user's request, system-side task
 * descriptions, and steering injections each read differently, so a
 * deep-dive view can tell who wrote a segment at a glance.
 *
 * Steering injections additionally flash ON ENTRY: a purple overlay
 * flares at full strength when the block first renders, then fades back
 * out over a 2s tailwind transition — exactly once (a mount-time timer
 * retires it; cleanup on unmount), so a mid-run steering nifflet draws
 * the eye without permanently repainting the turn.
 */

import { useEffect, useState, type ReactNode } from "react"
import { useLocale, t } from "@max/i18n"
import type { ExtractedTextUnit } from "./model"

/** How long the full-strength highlight holds before the fade starts. */
export const STEERING_FLASH_HOLD_MS = 100
/** The fade-out transition duration (the "2s" of the flash). */
export const STEERING_FLASH_FADE_MS = 2000

/**
 * Structural view of one text segment — what the block styles on.
 * ExtractedTextUnit satisfies it; so do the source-stamped text units
 * of the compiled render stream (TurnGroup routes steering/system
 * segments here).
 */
export interface TextUnitBlockModel {
  source: ExtractedTextUnit["source"]
  text: string
  taskId?: string
}

const SOURCE_STYLE: Record<ExtractedTextUnit["source"], string> = {
  user: "border-blue-500/40 bg-blue-500/5",
  steering: "border-purple-500/40 bg-purple-500/5",
  system: "border-border bg-muted/40",
}

function sourceLabel(source: ExtractedTextUnit["source"]): string {
  if (source === "user") return t("conversation.textUnit.user")
  if (source === "steering") return t("conversation.textUnit.steering")
  return t("conversation.textUnit.system")
}

export function TextUnitBlock({
  unit,
  children,
  flash = false,
}: {
  unit: TextUnitBlockModel
  /** Body override — lets the caller keep find highlights working
   *  inside the block. Defaults to the segment's plain text. */
  children?: ReactNode
  /** One-shot entry highlight (steering injections): the overlay flares
   *  on mount, holds briefly, then fades out over 2s via transition. */
  flash?: boolean
}) {
  useLocale()
  // The flash is mount-scoped: it starts lit exactly once and only ever
  // turns OFF (the unmount cleanup retires the timer).
  const [flashing, setFlashing] = useState(flash)
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlashing(false), STEERING_FLASH_HOLD_MS)
    return () => clearTimeout(timer)
  }, [flash])
  return (
    <div
      className={`relative rounded-md border px-2.5 py-2 ${SOURCE_STYLE[unit.source] ?? SOURCE_STYLE.system}`}
      data-testid="text-unit-block"
      data-source={unit.source}
      data-flash={flash ? (flashing ? "true" : "false") : undefined}
    >
      {flash && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-md bg-purple-500/25 transition-opacity ease-out duration-[2000ms] ${
            flashing ? "opacity-100" : "opacity-0"
          }`}
          data-testid="text-unit-flash"
        />
      )}
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span data-testid="text-unit-source">{sourceLabel(unit.source)}</span>
        {unit.taskId !== undefined && (
          <span className="truncate font-mono normal-case">{unit.taskId}</span>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground" data-testid="text-unit-body">
        {children ?? unit.text}
      </p>
    </div>
  )
}
