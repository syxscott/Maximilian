// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TextUnitBlock — one extracted text segment (textUnits output) with
 * per-source styling: the user's request, system-side task
 * descriptions, and steering injections each read differently, so a
 * deep-dive view can tell who wrote a segment at a glance.
 */

import { useLocale, t } from "@max/i18n"
import type { ExtractedTextUnit } from "./model"

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

export function TextUnitBlock({ unit }: { unit: ExtractedTextUnit }) {
  useLocale()
  return (
    <div
      className={`rounded-md border px-2.5 py-2 ${SOURCE_STYLE[unit.source] ?? SOURCE_STYLE.system}`}
      data-testid="text-unit-block"
      data-source={unit.source}
    >
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span data-testid="text-unit-source">{sourceLabel(unit.source)}</span>
        {unit.taskId !== undefined && (
          <span className="truncate font-mono normal-case">{unit.taskId}</span>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground" data-testid="text-unit-body">
        {unit.text}
      </p>
    </div>
  )
}
