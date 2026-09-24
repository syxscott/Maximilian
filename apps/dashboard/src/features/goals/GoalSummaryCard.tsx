// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * GoalSummaryCard — headline numbers for the goal view (deepseek
 * ui-goal borrowing, honest-data edition): total progress %, completed
 * / total tasks, failed count, and remaining tasks. Everything is
 * plain arithmetic over the workspace payload — the card says so and
 * never invents an ETA.
 */

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useLocale, t } from "@max/i18n"
import { deriveGoals } from "./model"

export function GoalSummaryCard({ workspace }: { workspace: unknown }) {
  useLocale()
  const view = useMemo(() => deriveGoals(workspace), [workspace])

  return (
    <Card data-testid="goal-summary-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("goals.summary.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t(`goals.basis.${view.primary.basis}`, {
            completed: view.primary.completed,
            total: view.primary.total,
            failed: view.primary.failed,
          })}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-2xl font-semibold tabular-nums" data-testid="goal-summary-percent">
          {t("goals.summary.percent", { percent: view.summary.percent })}
        </p>
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded border px-1 py-1.5">
            <dt className="text-[10px] text-muted-foreground">{t("goals.summary.doneLabel")}</dt>
            <dd className="text-sm tabular-nums" data-testid="goal-summary-completed">
              {t("goals.summary.completed", {
                completed: view.summary.completed,
                total: view.summary.total,
              })}
            </dd>
          </div>
          <div className="rounded border px-1 py-1.5">
            <dt className="text-[10px] text-muted-foreground">{t("goals.summary.failedLabel")}</dt>
            <dd
              className={
                view.summary.failed > 0
                  ? "text-sm tabular-nums text-destructive"
                  : "text-sm tabular-nums"
              }
              data-testid="goal-summary-failed"
            >
              {t("goals.summary.failed", { failed: view.summary.failed })}
            </dd>
          </div>
          <div className="rounded border px-1 py-1.5">
            <dt className="text-[10px] text-muted-foreground">
              {t("goals.summary.remainingLabel")}
            </dt>
            <dd className="text-sm tabular-nums" data-testid="goal-summary-remaining">
              {t("goals.summary.remaining", { remaining: view.summary.remaining })}
            </dd>
          </div>
        </dl>
        <p className="text-[10px] text-muted-foreground">{t("goals.summary.noEta")}</p>
      </CardContent>
    </Card>
  )
}
