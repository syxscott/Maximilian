// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * GoalSummaryCard — headline numbers for the goal view (deepseek
 * ui-goal borrowing, honest-data edition): total progress %, completed
 * / total tasks, failed count, and remaining tasks. Everything is
 * plain arithmetic over the workspace payload — the card says so and
 * never invents an ETA. The percent headline carries a DonutStat ring
 * and the three counts render as StatCard tiles (ai-elements), so the
 * summary reads with the same visual density as the rest of the app.
 */

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DonutStat, StatCard } from "@/components/ai-elements"
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
        <div className="flex items-center gap-3">
          <DonutStat
            value={view.summary.percent}
            size={40}
            ariaLabel={t("goals.summary.donutAria")}
          />
          <p className="text-2xl font-semibold tabular-nums" data-testid="goal-summary-percent">
            {t("goals.summary.percent", { percent: view.summary.percent })}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div data-testid="goal-summary-completed">
            <StatCard
              stat={{
                label: t("goals.summary.doneLabel"),
                value: t("goals.summary.completed", {
                  completed: view.summary.completed,
                  total: view.summary.total,
                }),
                trend: "flat",
              }}
            />
          </div>
          <div data-testid="goal-summary-failed">
            <StatCard
              stat={{
                label: t("goals.summary.failedLabel"),
                value: t("goals.summary.failed", { failed: view.summary.failed }),
                trend: view.summary.failed > 0 ? "down" : "flat",
              }}
            />
          </div>
          <div data-testid="goal-summary-remaining">
            <StatCard
              stat={{
                label: t("goals.summary.remainingLabel"),
                value: t("goals.summary.remaining", { remaining: view.summary.remaining }),
                trend: "flat",
              }}
            />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">{t("goals.summary.noEta")}</p>
      </CardContent>
    </Card>
  )
}
