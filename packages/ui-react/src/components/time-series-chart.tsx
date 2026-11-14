// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TimeSeriesChart — dependency-free SVG time-series chart with columns and
 * lines modes.
 *
 * (borrowing) Ported from the OpenAgentCore console `components/charts/
 * TimeSeriesChart.tsx`: stacked or grouped columns, line paths with end
 * dots, `niceTicks` integer axis scale, a tooltip that follows the active
 * bucket (pointer and arrow-key driven), a `visually-hidden` live region so
 * the first keyboard reading is announced, a CJK-aware axis gutter, and a
 * "view data table" toggle that swaps the plot for a plain accessible
 * `<table>` instead of a modal. Upstream's i18n layer became props and
 * English defaults; the CSS became Tailwind utilities on the same structure.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react"
import { Table2 } from "lucide-react"
import { cn } from "../lib/utils.js"
import { axisLabelWidth, formatBucketTime, niceTicks, tickIndices } from "../lib/chart-scale.js"

export interface TimeSeries {
  id: string
  label: string
  /** A CSS colour, normally a `var(--series-n)` or status token. */
  color: string
  values: ReadonlyArray<number | null>
  /** Formatted range total shown beside the legend label. */
  total?: string
}

export interface TimeSeriesChartProps {
  label: string
  kind: "columns" | "lines"
  stacked?: boolean
  /** Bucket start times in epoch seconds. */
  buckets: readonly number[]
  bucketSeconds: number
  series: readonly TimeSeries[]
  formatValue: (value: number) => string
  formatAxis?: (value: number) => string
  height?: number
  /** Columns only: include this series in the tooltip without drawing it. */
  tooltipOnly?: readonly TimeSeries[]
  /** The values are counts, so the axis ticks stay whole numbers. */
  counts?: boolean
  /** Locale for axis and table time labels; defaults to the runtime locale. */
  locale?: string | undefined
  /** Labels for the table toggle; English defaults keep the component i18n-free. */
  labels?: { showTable?: string | undefined; noData?: string | undefined } | undefined
}

/** `left` is a floor: the axis gutter grows to the widest tick label. */
const MARGIN = { top: 10, right: 12, bottom: 24, left: 20 }
/** Space between the tick labels and the plot. */
const AXIS_GAP = 10
const COLUMN_MAX = 24
const GAP = 2
const RADIUS = 4

function topRoundedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const r = Math.min(radius, width / 2, height)
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`
}

function linePath(points: ReadonlyArray<[number, number] | null>): string {
  let path = ""
  let open = false
  for (const point of points) {
    if (!point) {
      open = false
      continue
    }
    path += `${open ? "L" : "M"}${point[0]},${point[1]}`
    open = true
  }
  return path
}

export function TimeSeriesChart({
  label,
  kind,
  stacked = false,
  buckets,
  bucketSeconds,
  series,
  formatValue,
  formatAxis = formatValue,
  height = 168,
  tooltipOnly = [],
  counts = false,
  locale = undefined,
  labels = undefined,
}: TimeSeriesChartProps) {
  const resolvedLocale =
    locale ?? (typeof navigator === "undefined" ? undefined : navigator.language)
  const showTableLabel = labels?.showTable ?? "View data table"
  const noDataLabel = labels?.noData ?? "No data in this range"
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [active, setActive] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    const element = wrapperRef.current
    if (!element || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0)
      if (next > 0) setWidth(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const count = buckets.length
  const bucketAt = (index: number) => buckets[index] ?? 0
  const spanSeconds = count ? bucketAt(count - 1) - bucketAt(0) + bucketSeconds : 0

  const maximum = useMemo(() => {
    let max = 0
    for (let index = 0; index < count; index += 1) {
      if (kind === "columns" && stacked) {
        max = Math.max(
          max,
          series.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0),
        )
      } else {
        for (const entry of series) max = Math.max(max, entry.values[index] ?? 0)
      }
    }
    return max
  }, [count, kind, series, stacked])
  const ticks = niceTicks(maximum, 4, counts)
  const top = ticks[ticks.length - 1] || 1
  // Tick labels start at the card's content edge, under the title and legend;
  // the plot begins after the widest label, so every chart lines up the same way.
  const left = Math.max(
    MARGIN.left,
    Math.ceil(Math.max(0, ...ticks.map((tick) => axisLabelWidth(formatAxis(tick)))) + AXIS_GAP),
  )
  const plotWidth = Math.max(40, width - left - MARGIN.right)
  const band = count ? plotWidth / count : plotWidth
  const y = (value: number) => MARGIN.top + height - (value / top) * height
  const xCenter = (index: number) => left + band * index + band / 2
  const hasData = series.some((entry) =>
    entry.values.some((value) => value !== null && value !== undefined),
  )

  const columnWidth = Math.max(2, Math.min(COLUMN_MAX, band * 0.64))

  function indexFromPointer(event: PointerEvent<SVGRectElement>): number | null {
    const bounds = event.currentTarget.getBoundingClientRect()
    const offset = event.clientX - bounds.left
    const index = Math.floor(offset / band)
    return index >= 0 && index < count ? index : null
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!count) return
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault()
      const delta = event.key === "ArrowRight" ? 1 : -1
      setActive((current) =>
        Math.min(count - 1, Math.max(0, (current ?? (delta > 0 ? -1 : count)) + delta)),
      )
    } else if (event.key === "Escape") {
      setActive(null)
    }
  }

  const tooltipSeries = [...series, ...tooltipOnly]
  const tooltipLeft = active === null ? 0 : xCenter(active)
  const tooltipOnRight = tooltipLeft < width / 2

  return (
    <div className="ts-chart" data-component="time-series-chart">
      {series.length > 1 || series.some((entry) => entry.total) ? (
        <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Legend">
          {series.map((entry) => (
            <li key={entry.id} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block h-2.5 w-2.5 rounded-sm",
                  kind === "lines" && "h-0.5 w-4 rounded-none",
                )}
                style={{ background: entry.color }}
                aria-hidden="true"
              />
              {entry.label}
              {entry.total ? <span className="opacity-80">{entry.total}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <div
          ref={wrapperRef}
          role="group"
          aria-label={label}
          aria-roledescription="chart"
          tabIndex={count ? 0 : -1}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          className="relative outline-none focus-visible:ring-1 focus-visible:ring-ring"
          style={{ height: height + MARGIN.top + MARGIN.bottom }}
        >
          <svg width={width} height={height + MARGIN.top + MARGIN.bottom} aria-hidden="true">
            {ticks.map((tick) => (
              <g key={tick} className="chart-gridline">
                <line
                  x1={left}
                  x2={width - MARGIN.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-border"
                />
                <text
                  x={0}
                  y={y(tick)}
                  dy="0.32em"
                  textAnchor="start"
                  className="fill-muted-foreground text-[10px]"
                >
                  {formatAxis(tick)}
                </text>
              </g>
            ))}
            {tickIndices(count, Math.max(2, Math.min(7, Math.floor(plotWidth / 90)))).map(
              (index) => (
                <text
                  key={index}
                  className="fill-muted-foreground text-[10px]"
                  x={xCenter(index)}
                  y={MARGIN.top + height + 16}
                  textAnchor="middle"
                >
                  {formatBucketTime(bucketAt(index), bucketSeconds, spanSeconds, resolvedLocale)}
                </text>
              ),
            )}
            {active !== null ? (
              kind === "columns" ? (
                <rect
                  className="chart-band-highlight fill-foreground/5"
                  x={left + band * active}
                  y={MARGIN.top}
                  width={band}
                  height={height}
                />
              ) : (
                <line
                  className="chart-crosshair stroke-foreground/30"
                  x1={xCenter(active)}
                  x2={xCenter(active)}
                  y1={MARGIN.top}
                  y2={MARGIN.top + height}
                />
              )
            ) : null}
            {/* Keyed by the bucketing: bars and lines draw in when a range is first shown, not on every refresh. */}
            <g key={`${bucketSeconds}:${count}`} className="chart-series">
              {kind === "columns"
                ? buckets.map((_, index) => {
                    let base = 0
                    const drawn = series
                      .map((entry) => ({ entry, value: entry.values[index] ?? 0 }))
                      .filter((segment) => segment.value > 0)
                    return (
                      <g
                        key={index}
                        className="chart-bar"
                        style={{ "--i": index } as CSSProperties}
                      >
                        {drawn.map(({ entry, value }, position) => {
                          if (!stacked) {
                            const slot = columnWidth / series.length
                            const seriesIndex = series.indexOf(entry)
                            const x = xCenter(index) - columnWidth / 2 + slot * seriesIndex
                            const barHeight = Math.max(1, (value / top) * height)
                            return (
                              <path
                                key={entry.id}
                                d={topRoundedRect(
                                  x,
                                  y(value),
                                  Math.max(1, slot - (series.length > 1 ? GAP : 0)),
                                  barHeight,
                                  RADIUS,
                                )}
                                fill={entry.color}
                              />
                            )
                          }
                          const bottom = y(base)
                          base += value
                          const segmentTop = y(base)
                          const isTop = position === drawn.length - 1
                          const gap = position > 0 ? GAP : 0
                          const segmentHeight = Math.max(1, bottom - segmentTop - gap)
                          const x = xCenter(index) - columnWidth / 2
                          return isTop ? (
                            <path
                              key={entry.id}
                              d={topRoundedRect(x, segmentTop, columnWidth, segmentHeight, RADIUS)}
                              fill={entry.color}
                            />
                          ) : (
                            <rect
                              key={entry.id}
                              x={x}
                              y={segmentTop}
                              width={columnWidth}
                              height={segmentHeight}
                              fill={entry.color}
                            />
                          )
                        })}
                      </g>
                    )
                  })
                : series.map((entry) => {
                    const points = entry.values.map((value, index) =>
                      value === null || value === undefined
                        ? null
                        : ([xCenter(index), y(value)] as [number, number]),
                    )
                    const last = [...points].reverse().find(Boolean) ?? null
                    return (
                      <g key={entry.id}>
                        <path
                          className="chart-line"
                          pathLength={1}
                          d={linePath(points)}
                          stroke={entry.color}
                          fill="none"
                        />
                        {last ? (
                          <circle
                            className="chart-end-dot chart-last-dot"
                            cx={last[0]}
                            cy={last[1]}
                            r={4}
                            fill={entry.color}
                          />
                        ) : null}
                        {active !== null && points[active] ? (
                          <circle
                            className="chart-end-dot"
                            cx={points[active][0]}
                            cy={points[active][1]}
                            r={4}
                            fill={entry.color}
                          />
                        ) : null}
                      </g>
                    )
                  })}
            </g>
            <rect
              className="chart-hit"
              x={left}
              y={MARGIN.top}
              width={plotWidth}
              height={height}
              fill="transparent"
              onPointerMove={(event) => setActive(indexFromPointer(event))}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
          {!hasData ? (
            <p className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
              {noDataLabel}
            </p>
          ) : null}
          {active !== null && hasData ? (
            <div
              className="pointer-events-none absolute top-1 z-10 rounded-md border border-border bg-background/95 px-2 py-1.5 text-xs shadow-md"
              aria-hidden="true"
              style={
                tooltipOnRight ? { left: tooltipLeft + 12 } : { right: width - tooltipLeft + 12 }
              }
            >
              <p className="text-muted-foreground">
                {formatBucketTime(bucketAt(active), bucketSeconds, 0, resolvedLocale)}
                {spanSeconds > 36 * 3600
                  ? ` · ${new Intl.DateTimeFormat(resolvedLocale, { month: "numeric", day: "numeric" }).format(new Date(bucketAt(active) * 1000))}`
                  : ""}
              </p>
              {tooltipSeries.map((entry) => {
                const value = entry.values[active]
                return (
                  <p key={entry.id} className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className="inline-block h-0.5 w-4 rounded-none"
                      style={{ background: entry.color }}
                      aria-hidden="true"
                    />
                    <strong>
                      {value === null || value === undefined ? "—" : formatValue(value)}
                    </strong>
                    <span>{entry.label}</span>
                  </p>
                )
              })}
            </div>
          ) : null}
        </div>
        {/* A persistent live region, so the first keyboard reading is announced too. */}
        <p className="sr-only" aria-live="polite">
          {active !== null && hasData
            ? `${formatBucketTime(bucketAt(active), bucketSeconds, 0, resolvedLocale)}: ${tooltipSeries
                .map((entry) => {
                  const value = entry.values[active]
                  return `${entry.label} ${value === null || value === undefined ? "—" : formatValue(value)}`
                })
                .join(", ")}`
            : ""}
        </p>
      </div>
      {/* The numbers swap in as a plain table, so the chart keeps its layout. */}
      <button
        type="button"
        className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-pressed={showTable}
        aria-label={showTableLabel}
        title={showTableLabel}
        onClick={() => setShowTable((value) => !value)}
      >
        <Table2 size={14} strokeWidth={1.6} aria-hidden="true" />
        {showTableLabel}
      </button>
      {showTable ? (
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-xs" data-slot="time-series-data-table">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 pr-2 text-left font-medium text-muted-foreground">
                  Time
                </th>
                {tooltipSeries.map((entry) => (
                  <th
                    key={entry.id}
                    scope="col"
                    className="py-1 pr-2 text-right font-medium text-muted-foreground"
                  >
                    {entry.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket, index) => (
                <tr key={bucket} className="border-t border-border">
                  <th scope="row" className="py-1 pr-2 text-left font-normal">
                    {new Intl.DateTimeFormat(resolvedLocale, {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      ...(bucketSeconds < 60 ? { second: "2-digit" } : {}),
                      hourCycle: "h23",
                    }).format(new Date(bucket * 1000))}
                  </th>
                  {tooltipSeries.map((entry) => {
                    const value = entry.values[index]
                    return (
                      <td key={entry.id} className="py-1 pr-2 text-right tabular-nums">
                        {value === null || value === undefined ? "—" : formatValue(value)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
