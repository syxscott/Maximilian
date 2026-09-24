// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * goal renderer — goal registration/progress. The body highlights the goal
 * text and, when the payload carries a progress value (numbers clamp to
 * 0-100, string percents parse — coordination.model.ts extractGoal), draws
 * a real progress bar with the percent; status renders as a row. JSON
 * fallback when nothing extractable.
 */

import { useLocale, t } from "@max/i18n"
import type { ToolCallProps } from "../registry"
import { FieldRows, JsonFallback } from "./common"
import { extractGoal } from "./coordination.model"
import { FIELDS } from "./shared.model"

export const GOAL_GLYPH = "◎"

export function GoalBody({ input }: ToolCallProps) {
  useLocale()
  const vm = extractGoal(input)
  if (vm.isEmpty) return <JsonFallback input={input} />
  const rows = vm.rows.filter(
    (r) =>
      (vm.goal === undefined || r.labelKey !== FIELDS.goal) &&
      (vm.progress === undefined || r.labelKey !== FIELDS.progress),
  )
  return (
    <div className="mt-1" data-testid="tool-body">
      <p
        className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
        data-testid="tool-title"
      >
        {t("toolRenderers.goal.title")}
      </p>
      {vm.goal !== undefined && <p className="break-words text-xs leading-5">{vm.goal}</p>}
      {vm.progress !== undefined && (
        <div
          className="mt-1.5 flex items-center gap-2"
          data-testid="goal-progress"
          role="progressbar"
          aria-valuenow={vm.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${vm.progress}%` }} />
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{vm.progress}%</span>
        </div>
      )}
      <FieldRows rows={rows} />
    </div>
  )
}
