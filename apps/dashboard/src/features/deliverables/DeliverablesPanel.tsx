// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DeliverablesPanel — final task outputs as a first-class list (deepseek
 * ui-deliverables borrowing: deliverables are listed whether or not the
 * closing prose remembered them). Rows are grouped by agent role with a
 * collapsed 12-line output preview each, and an "export all as Markdown"
 * button that assembles the document in the browser and copies it via
 * navigator.clipboard — degrading to a visible manual-copy block when the
 * clipboard API is unavailable or refuses.
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
import { useLocale, t } from "@max/i18n"
import { chatApi } from "@/api"
import {
  canUseClipboard,
  copyText,
  deliverableStats,
  groupByRole,
  previewLines,
  reviewSummary,
  toDeliverableViews,
  toDeliverablesMarkdown,
} from "./model"

type ExportState = "idle" | "copied" | "manual"

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
  const [exportState, setExportState] = useState<ExportState>("idle")
  const [manualMarkdown, setManualMarkdown] = useState("")

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
  const groups = useMemo(() => groupByRole(views), [views])
  const stats = useMemo(() => deliverableStats(views), [views])
  const review = useMemo(() => reviewSummary(source), [source])

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const exportAll = () => {
    const markdown = toDeliverablesMarkdown(source)
    setManualMarkdown(markdown)
    if (!canUseClipboard()) {
      setExportState("manual")
      return
    }
    copyText(markdown).then(
      () => setExportState("copied"),
      () => setExportState("manual"),
    )
  }

  return (
    <Card data-testid="deliverables-panel">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm font-medium">{t("deliverables.title")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("deliverables.description")}</p>
        </div>
        <Button size="sm" variant="outline" onClick={exportAll} disabled={views.length === 0}>
          {t("deliverables.export")}
        </Button>
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
            <p className="text-xs text-muted-foreground" data-testid="deliverables-empty">
              {t("deliverables.empty")}
            </p>
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
            </div>

            {exportState === "copied" && (
              <p className="text-xs text-muted-foreground" data-testid="deliverables-copied">
                {t("deliverables.copied")}
              </p>
            )}
            {exportState === "manual" && (
              <div
                className="space-y-1 rounded border border-amber-500/50 p-2"
                data-testid="deliverables-manual"
              >
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("deliverables.copyFailed")}
                </p>
                <Textarea
                  readOnly
                  value={manualMarkdown}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-h-32 font-mono text-[10px]"
                  aria-label={t("deliverables.manualHint")}
                />
                <p className="text-[10px] text-muted-foreground">{t("deliverables.manualHint")}</p>
              </div>
            )}

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
          </>
        )}
      </CardContent>
    </Card>
  )
}
