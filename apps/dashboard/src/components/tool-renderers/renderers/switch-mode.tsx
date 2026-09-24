// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * switch-mode renderer — execution-mode transition. When the payload
 * carries both ends the body draws the from → to arrow
 * (coordination.model.ts extractSwitchMode) instead of two loose rows;
 * the stated reason renders as its own row. JSON fallback otherwise.
 */

import { useLocale, t } from "@max/i18n"
import type { ToolCallProps } from "../registry"
import { FieldRows, JsonFallback } from "./common"
import { extractSwitchMode } from "./coordination.model"
import { FIELDS } from "./shared.model"

export const SWITCH_MODE_GLYPH = "⇄"

export function SwitchModeBody({ input }: ToolCallProps) {
  useLocale()
  const vm = extractSwitchMode(input)
  if (vm.isEmpty) return <JsonFallback input={input} />
  const arrow = vm.from !== undefined && vm.to !== undefined
  const rest = arrow
    ? vm.rows.filter((r) => r.labelKey !== FIELDS.mode && r.labelKey !== FIELDS.from)
    : vm.rows
  return (
    <div className="mt-1" data-testid="tool-body">
      <p
        className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
        data-testid="tool-title"
      >
        {t("toolRenderers.switch-mode.title")}
      </p>
      {arrow ? (
        <p className="flex items-center gap-1.5 text-xs" data-testid="switch-mode-arrow">
          <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-muted-foreground">
            {vm.from}
          </span>
          <span aria-hidden className="font-mono text-muted-foreground">
            →
          </span>
          <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono font-medium">
            {vm.to}
          </span>
        </p>
      ) : null}
      <FieldRows rows={rest} />
    </div>
  )
}
