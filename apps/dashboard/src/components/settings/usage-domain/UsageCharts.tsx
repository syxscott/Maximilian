// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Inline-SVG chart primitives (no dependency borrowing) — a mini line
 * chart, a daily bar chart and the rolling-windows table. Geometry comes
 * from ./model so these components are pure renderers.
 */

import { useLocale, t } from "@max/i18n"
import { DataGrid, type DataGridColumn } from "@max/ui-react"
import {
  dailyBars,
  formatCompact,
  polylinePoints,
  type BreakdownRow,
  type DailyPoint,
  type WindowRow,
} from "./model"

/** Mini line chart: single polyline + baseline, ~no chrome. */
export function MiniLineChart({
  points,
  width = 320,
  height = 72,
  pad = 6,
  testId,
}: {
  points: DailyPoint[]
  width?: number
  height?: number
  pad?: number
  testId?: string
}) {
  const values = points.map((p) => p.value)
  const poly = polylinePoints(values, width, height, pad)
  if (!poly) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={testId}>
        {t("settingsDeep.common.empty")}
      </p>
    )
  }
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={t("settingsDeep.usage.dailyTitle")}
      data-testid={testId}
      className="max-w-full"
    >
      <polyline
        points={poly}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary"
      />
    </svg>
  )
}

/** Daily bar chart: one rect per day, hover title carries date + value. */
export function DailyBarChart({
  points,
  width = 320,
  height = 96,
  pad = 6,
  testId,
}: {
  points: DailyPoint[]
  width?: number
  height?: number
  pad?: number
  testId?: string
}) {
  const dates = points.map((p) => p.date)
  const values = points.map((p) => p.value)
  const bars = dailyBars(dates, values, width, height, pad)
  if (bars.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={testId}>
        {t("settingsDeep.common.empty")}
      </p>
    )
  }
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={t("settingsDeep.usage.dailyTitle")}
      data-testid={testId}
      className="max-w-full"
    >
      {bars.map((b) => (
        <rect
          key={b.label}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          className="fill-primary/70"
          rx="1"
        >
          <title>{`${b.label}: ${formatCompact(b.value)}`}</title>
        </rect>
      ))}
    </svg>
  )
}

/**
 * Per-session / per-role range breakdown (token-monitor sessionUsageArchive
 * borrowing): the rows behind `?groupBy=session|agentRole`, rendered through
 * the shared DataGrid so sorting and density match the rest of the app.
 *
 * Header labels are inline English on purpose: the files owned by this change
 * are the usage-domain components, and adding locale keys would edit a shared
 * file outside that scope. Numeric cells go through formatCompact.
 */
export function SessionBreakdownTable({ rows, testId }: { rows: BreakdownRow[]; testId?: string }) {
  useLocale()
  const columns: Array<DataGridColumn<BreakdownRow>> = [
    {
      key: "key",
      header: "Session",
      sortable: true,
      value: (row) => row.key,
      render: (row) => <span className="font-mono">{row.key}</span>,
    },
    { key: "agentRole", header: "Agent role", sortable: true, value: (row) => row.agentRole },
    {
      key: "requests",
      header: t("settingsDeep.usage.col.requests"),
      sortable: true,
      align: "right",
      value: (row) => row.requests,
      render: (row) => formatCompact(row.requests),
    },
    {
      key: "inputTokens",
      header: t("settingsDeep.usage.col.input"),
      sortable: true,
      align: "right",
      value: (row) => row.inputTokens,
      render: (row) => formatCompact(row.inputTokens),
    },
    {
      key: "outputTokens",
      header: t("settingsDeep.usage.col.output"),
      sortable: true,
      align: "right",
      value: (row) => row.outputTokens,
      render: (row) => formatCompact(row.outputTokens),
    },
    {
      key: "realTokens",
      header: t("settingsDeep.usage.summary.tokens"),
      sortable: true,
      align: "right",
      value: (row) => row.realTokens,
      render: (row) => formatCompact(row.realTokens),
    },
    {
      key: "costUsd",
      header: t("settingsDeep.usage.col.cost"),
      sortable: true,
      align: "right",
      value: (row) => row.costUsd,
      render: (row) =>
        row.costKnown ? `$${row.costUsd.toFixed(4)}` : t("settingsDeep.store.countUnknown"),
    },
    {
      key: "successRate",
      header: t("settingsDeep.usage.summary.successRate"),
      sortable: true,
      align: "right",
      value: (row) => row.successRate,
      render: (row) => `${(row.successRate * 100).toFixed(0)}%`,
    },
  ]
  return (
    <div data-testid={testId}>
      <DataGrid
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        defaultSort={{ key: "realTokens", direction: "desc" }}
        emptyState={
          <p className="text-xs text-muted-foreground">{t("settingsDeep.common.empty")}</p>
        }
      />
    </div>
  )
}

/** Rolling windows (5h/24h/7d/30d) as a plain table. */
export function WindowsTable({ rows }: { rows: WindowRow[] }) {
  useLocale()
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("settingsDeep.common.empty")}</p>
  }
  return (
    <table className="w-full text-xs" data-testid="usage-windows-table">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 pr-2 font-medium">{t("settingsDeep.usage.window")}</th>
          <th className="py-1 pr-2 text-right font-medium">
            {t("settingsDeep.usage.col.requests")}
          </th>
          <th className="py-1 pr-2 text-right font-medium">{t("settingsDeep.usage.col.input")}</th>
          <th className="py-1 pr-2 text-right font-medium">{t("settingsDeep.usage.col.output")}</th>
          <th className="py-1 text-right font-medium">{t("settingsDeep.usage.col.cost")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.window} className="border-t">
            <td className="py-1 pr-2 font-mono">{r.window}</td>
            <td className="py-1 pr-2 text-right">{formatCompact(r.requests)}</td>
            <td className="py-1 pr-2 text-right">{formatCompact(r.inputTokens)}</td>
            <td className="py-1 pr-2 text-right">{formatCompact(r.outputTokens)}</td>
            <td className="py-1 text-right">
              {r.costUsd === null
                ? t("settingsDeep.store.countUnknown")
                : `$${r.costUsd.toFixed(4)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
