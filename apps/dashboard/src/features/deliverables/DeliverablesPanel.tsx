// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DeliverablesPanel — final task outputs as a first-class list (deepseek
 * ui-deliverables borrowing: deliverables are listed whether or not the
 * closing prose remembered them). Rows are grouped by agent role with a
 * collapsed 12-line output preview each, a role filter narrows the list
 * to one agent role, and two export buttons assemble the documents in
 * the browser (Markdown of the whole set, JSON of the filtered rows)
 * copying via navigator.clipboard — degrading to a visible manual-copy
 * block when the clipboard API is unavailable or refuses. Every row
 * shows its review score when one can be associated (result
 * `metadata.review`, else the workspace-level review) — no score, no
 * badge, nothing invented.
 *
 * The stats strip mounts the ai-elements widgets: one StatCard per count
 * (deliverables / tasks / roles), a DonutStat ring for the review
 * coverage share, a DeltaBadge for the rows a role filter hides, a
 * CopyField chip beside the export buttons for the workspace id, and a
 * Sparkline tracing the deliverable count per role (seriesByRole — the
 * same grouped views the list renders). The no-deliverables and
 * filtered-to-nothing states use the shared EmptyHint placeholder.
 *
 * Data is either passed in via the `workspace` prop or fetched by
 * `workspaceId` through chatApi.getWorkspace (api.ts is the arch-mandated
 * network chokepoint).
 */

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  CopyField,
  DeltaBadge,
  DonutStat,
  EmptyHint,
  Sparkline,
  StatCard,
} from "@/components/ai-elements"
import { useLocale, t } from "@max/i18n"
import { chatApi } from "@/api"
import {
  canUseClipboard,
  copyText,
  deliverableStats,
  filterByRole,
  groupByRole,
  previewLines,
  reviewCoverage,
  reviewPerTask,
  reviewSummary,
  seriesByRole,
  toDeliverableViews,
  toDeliverablesJson,
  toDeliverablesMarkdown,
  workspaceIdOf,
} from "./model"
import type { DeliverableView, TaskReviewLink } from "./model"

type ExportFormat = "markdown" | "json"

interface ExportResult {
  format: ExportFormat
  status: "copied" | "manual"
  text: string
}

export function DeliverablesPanel({
  workspaceId,
  workspace,
}: {
  /** Fetch the workspace through chatApi when no `workspace` prop is given. */
  workspaceId?: string
  /** Pre-fetched workspace payload; skips the query entirely. */
  workspace?: unknown
}) {
  useLocale()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [roleFilter, setRoleFilter] = useState("")
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)

  const fetchEnabled =
    workspace === undefined && typeof workspaceId === "string" && workspaceId !== ""
  const workspaceQuery = useQuery({
    queryKey: ["deliverables", "workspace", workspaceId],
    queryFn: ({ signal }) => chatApi.getWorkspace(workspaceId as string, signal),
    enabled: fetchEnabled,
    staleTime: 15_000,
  })

  const source = workspace !== undefined ? workspace : workspaceQuery.data
  const views = useMemo(() => toDeliverableViews(source), [source])
  const roles = useMemo(() => groupByRole(views).map((g) => g.role), [views])
  const visibleViews = useMemo(() => filterByRole(views, roleFilter), [views, roleFilter])
  const groups = useMemo(() => groupByRole(visibleViews), [visibleViews])
  const stats = useMemo(() => deliverableStats(visibleViews), [visibleViews])
  const review = useMemo(() => reviewSummary(source), [source])
  const reviewLinks = useMemo(
    () => reviewPerTask(visibleViews, review && review.score !== null ? review.score : null),
    [visibleViews, review],
  )
  const reviewByView = useMemo(() => {
    const map = new Map<DeliverableView, TaskReviewLink>()
    visibleViews.forEach((view, i) => map.set(view, reviewLinks[i]))
    return map
  }, [visibleViews, reviewLinks])
  const coverage = useMemo(() => reviewCoverage(reviewLinks), [reviewLinks])
  const wsId = useMemo(() => workspaceIdOf(workspaceId, source), [workspaceId, source])
  const filterDelta = roleFilter === "" ? 0 : visibleViews.length - views.length

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const exportAs = (format: ExportFormat) => {
    const text =
      format === "markdown" ? toDeliverablesMarkdown(source) : toDeliverablesJson(visibleViews)
    if (!canUseClipboard()) {
      setExportResult({ format, status: "manual", text })
      return
    }
    copyText(text).then(
      () => setExportResult({ format, status: "copied", text }),
      () => setExportResult({ format, status: "manual", text }),
    )
  }

  return (
    <Card data-testid="deliverables-panel">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm font-medium">{t("deliverables.title")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("deliverables.description")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <CopyField field={{ value: wsId ?? "", label: t("deliverables.copyId") }} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportAs("markdown")}
            disabled={views.length === 0}
          >
            {t("deliverables.export")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportAs("json")}
            disabled={visibleViews.length === 0}
            data-testid="deliverables-export-json"
          >
            {t("deliverables.exportJson")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {workspace !== undefined ? null : workspaceQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">{t("deliverables.loading")}</p>
        ) : workspaceQuery.isError ? (
          <div className="space-y-2" data-testid="deliverables-error">
            <p className="text-xs text-destructive">{t("deliverables.error")}</p>
            <Button size="sm" variant="outline" onClick={() => workspaceQuery.refetch()}>
              {t("deliverables.retry")}
            </Button>
          </div>
        ) : null}

        {views.length === 0 ? (
          workspaceQuery.isLoading || workspaceQuery.isError ? null : (
            <div data-testid="deliverables-empty">
              <EmptyHint hint={{ title: t("deliverables.empty") }} />
            </div>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground" data-testid="deliverables-stats">
                {t("deliverables.stats", {
                  total: stats.total,
                  tasks: stats.tasks,
                  roles: stats.roles,
                })}
              </span>
              {/* Per-role output mini trend — derived from the same
                  grouped views as the list (seriesByRole), so it can
                  never contradict the rows below. */}
              <span
                className="flex items-center"
                title={t("deliverables.roleSparkline")}
                data-testid="deliverables-role-sparkline"
              >
                <Sparkline
                  values={seriesByRole(views)}
                  ariaLabel={t("deliverables.roleSparkline")}
                  width={72}
                  height={18}
                />
              </span>
              {filterDelta !== 0 && (
                <span title={t("deliverables.filterDelta", { count: -filterDelta })}>
                  <DeltaBadge delta={filterDelta} />
                </span>
              )}
              {review && review.score !== null && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {t("deliverables.reviewScore", { score: review.score })}
                </Badge>
              )}
              {review && review.issues > 0 && (
                <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                  {t("deliverables.reviewIssues", { issues: review.issues })}
                </Badge>
              )}
              <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                {t("deliverables.filterRole")}
                <select
                  className="h-7 rounded-md border border-border-default bg-background px-1.5 text-xs"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.currentTarget.value)}
                  data-testid="deliverables-role-filter"
                  aria-label={t("deliverables.filterRole")}
                >
                  <option value="">{t("deliverables.filterAll")}</option>
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              data-testid="deliverables-stat-cards"
            >
              <StatCard stat={{ label: t("deliverables.statTotal"), value: stats.total }} />
              <StatCard stat={{ label: t("deliverables.statTasks"), value: stats.tasks }} />
              <StatCard stat={{ label: t("deliverables.statRoles"), value: stats.roles }} />
              <div
                className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
                data-testid="deliverables-coverage"
              >
                <DonutStat
                  value={coverage}
                  ariaLabel={t("deliverables.reviewCoverage")}
                  className="text-foreground"
                />
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {t("deliverables.reviewCoverage")}
                </span>
              </div>
            </div>

            {exportResult?.format === "markdown" && exportResult.status === "copied" && (
              <p className="text-xs text-muted-foreground" data-testid="deliverables-copied">
                {t("deliverables.copied")}
              </p>
            )}
            {exportResult?.format === "markdown" && exportResult.status === "manual" && (
              <div
                className="space-y-1 rounded border border-amber-500/50 p-2"
                data-testid="deliverables-manual"
              >
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("deliverables.copyFailed")}
                </p>
                <Textarea
                  readOnly
                  value={exportResult.text}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-h-32 font-mono text-[10px]"
                  aria-label={t("deliverables.manualHint")}
                />
                <p className="text-[10px] text-muted-foreground">{t("deliverables.manualHint")}</p>
              </div>
            )}
            {exportResult?.format === "json" && exportResult.status === "copied" && (
              <p className="text-xs text-muted-foreground" data-testid="deliverables-json-copied">
                {t("deliverables.jsonCopied")}
              </p>
            )}
            {exportResult?.format === "json" && exportResult.status === "manual" && (
              <div
                className="space-y-1 rounded border border-amber-500/50 p-2"
                data-testid="deliverables-json-manual"
              >
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("deliverables.copyFailed")}
                </p>
                <Textarea
                  readOnly
                  value={exportResult.text}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-h-32 font-mono text-[10px]"
                  aria-label={t("deliverables.manualHint")}
                />
                <p className="text-[10px] text-muted-foreground">{t("deliverables.manualHint")}</p>
              </div>
            )}

            {visibleViews.length === 0 ? (
              <div data-testid="deliverables-filter-empty">
                <EmptyHint hint={{ title: t("deliverables.filterEmpty", { role: roleFilter }) }} />
              </div>
            ) : (
              <div className="space-y-3" data-testid="deliverables-groups">
                {groups.map((group) => (
                  <div key={group.role} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                        {group.role}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {t("deliverables.roleCount", { count: group.items.length })}
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {group.items.map((item, i) => {
                        const key = `${group.role}:${i}`
                        const open = expanded.has(key)
                        const preview = previewLines(item.output)
                        return (
                          <li
                            key={key}
                            className="rounded border"
                            data-testid={`deliverable-${item.taskId || i}`}
                          >
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left"
                              onClick={() => toggle(key)}
                              aria-expanded={open}
                            >
                              <span className="min-w-0 truncate font-mono text-xs">
                                {item.taskId || `#${i + 1}`}
                              </span>
                              <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                                {(() => {
                                  const link = reviewByView.get(item)
                                  if (!link || link.score === null) return null
                                  const badgeText =
                                    link.source === "metadata"
                                      ? t("deliverables.taskReview", { score: link.score })
                                      : t("deliverables.reviewBadge", { score: link.score })
                                  return (
                                    <Badge
                                      variant="outline"
                                      className="h-4 px-1 text-[10px]"
                                      data-testid={`deliverable-review-${item.taskId || i}`}
                                    >
                                      {badgeText}
                                    </Badge>
                                  )
                                })()}
                                {open ? (
                                  t("deliverables.collapse")
                                ) : (
                                  <>
                                    {t("deliverables.expand")}
                                    {preview.hidden > 0 && (
                                      <span>
                                        {t("deliverables.hiddenLines", { lines: preview.hidden })}
                                      </span>
                                    )}
                                  </>
                                )}
                              </span>
                            </button>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t px-2 py-1.5 text-xs">
                              {open ? item.output : preview.text}
                            </pre>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
