// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * UsageDomain — charts surface over the existing /obs/usage/* endpoints:
 * summary tiles + mini line (requests per day), daily bars, rolling-window
 * table. All data via useSettingsQueries; three states everywhere.
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import {
  useUsageDaily,
  useUsageSummary,
  useUsageWindows,
  type UsageRange,
} from "@/hooks/useSettingsQueries"
import { formatCompact, toDailySeries, toSummaryView, toWindowRows } from "./model"
import { DailyBarChart, MiniLineChart, WindowsTable } from "./UsageCharts"

const RANGES: UsageRange[] = ["7d", "30d"]

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border px-2 py-1.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="font-mono text-xs" data-label={label}>
        {value}
      </p>
    </div>
  )
}

export function UsageDomain() {
  useLocale()
  const [range, setRange] = useState<UsageRange>("7d")
  const summary = useUsageSummary(range)
  const daily = useUsageDaily(range)
  const windows = useUsageWindows()

  const summaryView = useMemo(() => toSummaryView(summary.data), [summary.data])
  const requestSeries = useMemo(() => toDailySeries(daily.data, "requests"), [daily.data])
  const costSeries = useMemo(() => toDailySeries(daily.data, "cost"), [daily.data])
  const windowRows = useMemo(() => toWindowRows(windows.data), [windows.data])

  const loading = summary.isLoading || daily.isLoading || windows.isLoading
  const errored = summary.isError || daily.isError || windows.isError
  const retry = () => {
    void summary.refetch()
    void daily.refetch()
    void windows.refetch()
  }

  return (
    <Card data-testid="settings-usage">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settingsDeep.usage.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("settingsDeep.usage.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-1" data-testid="usage-range-picker">
          <span className="text-xs text-muted-foreground">{t("settingsDeep.usage.range")}</span>
          {RANGES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? "default" : "ghost"}
              onClick={() => setRange(r)}
            >
              {t(`settingsDeep.usage.range.${r}`)}
            </Button>
          ))}
        </div>

        {loading ? (
          <p className="text-xs text-muted-foreground">{t("settingsDeep.common.loading")}</p>
        ) : errored ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive">{t("settingsDeep.common.error")}</p>
            <Button size="sm" variant="outline" onClick={retry}>
              {t("settingsDeep.common.retry")}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              <StatTile
                label={t("settingsDeep.usage.summary.requests")}
                value={formatCompact(summaryView.requests)}
              />
              <StatTile
                label={t("settingsDeep.usage.summary.tokens")}
                value={formatCompact(summaryView.tokens)}
              />
              <StatTile
                label={t("settingsDeep.usage.summary.cost")}
                value={summaryView.costKnown ? `$${summaryView.costUsd.toFixed(4)}` : "≈"}
              />
              <StatTile
                label={t("settingsDeep.usage.summary.successRate")}
                value={`${(summaryView.successRate * 100).toFixed(0)}%`}
              />
              <StatTile
                label={t("settingsDeep.usage.summary.cacheHitRate")}
                value={`${(summaryView.cacheHitRate * 100).toFixed(0)}%`}
              />
            </div>
            {!summaryView.costKnown && (
              <p className="text-xs text-muted-foreground">{t("settingsDeep.usage.costUnknown")}</p>
            )}

            <div className="space-y-1">
              <p className="text-xs font-medium">
                {t("settingsDeep.usage.summaryTitle")} · {t("settingsDeep.usage.col.requests")}
              </p>
              <MiniLineChart points={requestSeries} testId="usage-line" />
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium">
                {t("settingsDeep.usage.dailyTitle")} · {t("settingsDeep.usage.col.cost")}
              </p>
              {costSeries.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("settingsDeep.usage.empty")}</p>
              ) : (
                <DailyBarChart points={costSeries} testId="usage-bars" />
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium">{t("settingsDeep.usage.windowsTitle")}</p>
              <WindowsTable rows={windowRows} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// Re-export so a settings page can pull the whole domain from one module.
export { MiniLineChart, DailyBarChart, WindowsTable } from "./UsageCharts"
export { formatCompact } from "./model"
