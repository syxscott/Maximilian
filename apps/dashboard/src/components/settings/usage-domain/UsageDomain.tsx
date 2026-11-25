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
  useUsageBreakdown,
  useUsageDaily,
  useUsageSummary,
  useUsageWindows,
  type UsageRange,
} from "@/hooks/useSettingsQueries"
import { formatCompact, toBreakdownRows, toDailySeries, toSummaryView, toWindowRows } from "./model"
import { DailyBarChart, MiniLineChart, SessionBreakdownTable, WindowsTable } from "./UsageCharts"

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
  // Session drill-down rides the same range; absent on old backends, where
  // the table simply renders its empty state.
  const breakdown = useUsageBreakdown(range, "session")

  const summaryView = useMemo(() => toSummaryView(summary.data), [summary.data])
  const requestSeries = useMemo(() => toDailySeries(daily.data, "requests"), [daily.data])
  const costSeries = useMemo(() => toDailySeries(daily.data, "cost"), [daily.data])
  const windowRows = useMemo(() => toWindowRows(windows.data), [windows.data])
  const sessionRows = useMemo(() => toBreakdownRows(breakdown.data), [breakdown.data])

  const loading = summary.isLoading || daily.isLoading || windows.isLoading || breakdown.isLoading
  const errored = summary.isError || daily.isError || windows.isError || breakdown.isError
  const retry = () => {
    void summary.refetch()
    void daily.refetch()
    void windows.refetch()
    void breakdown.refetch()
  }

  return (
    <Card data-testid="settings-usage">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settingsDeep.usage.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("settingsDeep.usage.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="flex items-center gap-1"
          data-testid="usage-range-picker"
          title={t("settingsDeep.usage.chartsHint")}
        >
          <span className="text-xs text-muted-foreground">{t("settingsDeep.usage.range")}</span>
          {RANGES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? "default" : "ghost"}
              title={t(`settingsDeep.usage.range.${r}.description`)}
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

            <div className="space-y-1" title={t("settingsDeep.usage.tableHint")}>
              <p className="text-xs font-medium">{t("settingsDeep.usage.windowsTitle")}</p>
              <WindowsTable rows={windowRows} />
            </div>

            {/* Per-session drill-down for the selected range (token-monitor
                sessionUsageArchive borrowing). Heading is inline English to
                keep this change inside the usage-domain files. */}
            <div className="space-y-1">
              <p className="text-xs font-medium">Sessions</p>
              <SessionBreakdownTable rows={sessionRows} testId="usage-session-table" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// Re-export so a settings page can pull the whole domain from one module.
export { MiniLineChart, DailyBarChart, WindowsTable, SessionBreakdownTable } from "./UsageCharts"
export { formatCompact } from "./model"
