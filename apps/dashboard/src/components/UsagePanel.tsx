/**
 * Usage panel — shows token spend, cost, success rate, and cache hit rate
 * over a selectable time range. Data comes from /api/obs/usage/{summary,daily}.
 *
 * Bar chart is inline SVG to keep the bundle small (no chart lib needed).
 */

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useUsageDaily, useUsageSummary } from "@/lib/api/hooks"
import type { UsageRange, UsageSummary, DailyUsageEntry, LatencyStats } from "@/api"
import { useLocale, t, formatTokens, formatPercent } from "@max/i18n"

const RANGES: Array<{ key: UsageRange; labelKey: string }> = [
  { key: "today", labelKey: "usage.range.today" },
  { key: "1d", labelKey: "usage.range.1d" },
  { key: "7d", labelKey: "usage.range.7d" },
  { key: "14d", labelKey: "usage.range.14d" },
  { key: "30d", labelKey: "usage.range.30d" },
  { key: "all", labelKey: "usage.range.all" },
]

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`
}

export function UsagePanel() {
  useLocale()
  const [range, setRange] = useState<UsageRange>("7d")
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useUsageSummary(range)
  const { data: daily, isLoading: dailyLoading } = useUsageDaily(range)

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{t("usage.title")}</h2>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.key}
              variant={range === r.key ? "default" : "secondary"}
              size="sm"
              onClick={() => setRange(r.key)}
            >
              {t(r.labelKey)}
            </Button>
          ))}
        </div>
      </div>

      {summaryError && (
        <Card className="bg-destructive/10 border-destructive/30">
          <CardContent className="py-3 px-4 text-sm text-destructive">
            Failed to load usage summary — evolution/metrics may be disabled.
          </CardContent>
        </Card>
      )}

      {summaryLoading || !summary ? (
        <p className="text-muted-foreground text-sm">{t("usage.summary.loading")}</p>
      ) : (
        <>
          <SummaryCards summary={summary} />
          <LatencyCard latency={summary.latency} />
        </>
      )}

      {dailyLoading || !daily ? (
        <p className="text-muted-foreground text-sm">{t("usage.daily.loading")}</p>
      ) : (
        <DailyTrendCard daily={daily.daily} range={range} />
      )}
    </div>
  )
}

function SummaryCards({ summary }: { summary: UsageSummary }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <MetricCard label={t("usage.metric.totalCost")} value={formatUsd(summary.totalCostUsd)} />
      <MetricCard
        label={t("usage.metric.tokens")}
        value={formatTokens(summary.realTotalTokens)}
        sub={t("usage.metric.tokensCached", { cached: formatTokens(summary.totalCacheReadTokens) })}
      />
      <MetricCard
        label={t("usage.metric.successRate")}
        value={formatPercent(summary.successRate, 1)}
      />
      <MetricCard
        label={t("usage.metric.cacheHitRate")}
        value={formatPercent(summary.cacheHitRate, 1)}
      />
      <MetricCard
        label={t("usage.metric.inputTokens")}
        value={formatTokens(summary.totalInputTokens)}
      />
      <MetricCard
        label={t("usage.metric.outputTokens")}
        value={formatTokens(summary.totalOutputTokens)}
      />
      <MetricCard label={t("usage.metric.requests")} value={String(summary.totalRequests)} />
      <MetricCard
        label={t("usage.metric.unpriced")}
        value={String(summary.unpricedRequestCount)}
        alert={summary.unpricedRequestCount > 0}
      />
    </div>
  )
}

function MetricCard({
  label,
  value,
  sub,
  alert,
}: {
  label: string
  value: string
  sub?: string
  alert?: boolean
}) {
  return (
    <Card className={alert ? "bg-destructive/10 border-destructive/30" : "bg-muted/30"}>
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-xs text-muted-foreground font-normal">{label}</CardTitle>
      </CardHeader>
      <CardContent className="py-1 px-3">
        <p className={`text-xl font-semibold ${alert ? "text-destructive" : "text-foreground"}`}>
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  // formatDuration treats ms as a wall-clock duration (e.g. "5m 12s").
  // We want a single number with a unit suffix for the latency card, so
  // we keep ms<1000 raw and use the helper only for the seconds branch.
  return `${(ms / 1000).toFixed(2)}s`
}

function LatencyCard({ latency }: { latency: LatencyStats }) {
  return (
    <Card className="bg-muted/30">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-base text-foreground">{t("usage.latency.title")}</CardTitle>
      </CardHeader>
      <CardContent className="py-2 px-4">
        {latency.sampleCount === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            {t("usage.latency.empty")}
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="p50" value={formatMs(latency.p50Ms)} />
            <MetricCard label="p95" value={formatMs(latency.p95Ms)} />
            <MetricCard label="p99" value={formatMs(latency.p99Ms)} />
            <MetricCard
              label="avg"
              value={formatMs(latency.avgMs)}
              sub={`${latency.sampleCount} samples`}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DailyTrendCard({ daily, range }: { daily: DailyUsageEntry[]; range: UsageRange }) {
  const maxCost = Math.max(1e-9, ...daily.map((d) => d.totalCostUsd))
  const totalCost = daily.reduce((a, d) => a + d.totalCostUsd, 0)
  const totalReq = daily.reduce((a, d) => a + d.requestCount, 0)
  return (
    <Card className="bg-muted/30">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-foreground">{t("usage.daily.title")}</CardTitle>
          <Badge variant="outline">
            {range} · {totalReq} requests · {formatUsd(totalCost)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="py-2 px-4">
        {daily.length === 0 || totalReq === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">{t("usage.daily.empty")}</p>
        ) : (
          <DailyBars daily={daily} maxCost={maxCost} />
        )}
      </CardContent>
    </Card>
  )
}

function DailyBars({ daily, maxCost }: { daily: DailyUsageEntry[]; maxCost: number }) {
  const W = 600
  const H = 120
  const padX = 8
  const padY = 8
  const innerW = W - padX * 2
  const innerH = H - padY * 2
  const barWidth = daily.length > 0 ? innerW / daily.length - 4 : 0
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-32"
      role="img"
      aria-label="Daily cost bar chart"
    >
      {daily.map((d, i) => {
        const x = padX + i * (innerW / Math.max(daily.length, 1))
        const h = (d.totalCostUsd / maxCost) * innerH
        const y = padY + (innerH - h)
        return (
          <g key={d.date}>
            <rect
              x={x}
              y={y}
              width={Math.max(barWidth, 1)}
              height={h}
              className="fill-primary/70 hover:fill-primary"
              rx={1}
            >
              <title>
                {d.date}: {d.requestCount} req · {formatUsd(d.totalCostUsd)}
              </title>
            </rect>
          </g>
        )
      })}
    </svg>
  )
}
