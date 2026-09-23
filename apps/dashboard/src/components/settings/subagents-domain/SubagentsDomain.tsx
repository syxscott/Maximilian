// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SubagentsDomain — per-role profile cards over the evolution facade's
 * profile store (GET /evolution/agents, no new backend). Card shows role,
 * version, score, execution count and feedback count; expanding reveals
 * memory-bucket counts with short entry previews.
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLocale, t } from "@max/i18n"
import { useSubagentProfiles } from "@/hooks/useSettingsQueries"
import { bucketPreview, filterProfiles, toSubagentProfileViews, windowList } from "./model"

const MAX_VISIBLE = 12

export function SubagentsDomain() {
  useLocale()
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const { data, isLoading, isError, refetch, isFetching } = useSubagentProfiles()

  const profiles = useMemo(() => toSubagentProfileViews(data), [data])
  const filtered = useMemo(() => filterProfiles(profiles, query), [profiles, query])
  const page = windowList(filtered, MAX_VISIBLE)

  return (
    <Card data-testid="settings-subagents">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settingsDeep.subagents.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("settingsDeep.subagents.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("settingsDeep.common.loading")}</p>
        ) : isError ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive">{t("settingsDeep.common.error")}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {t("settingsDeep.common.retry")}
            </Button>
          </div>
        ) : profiles.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settingsDeep.subagents.empty")}</p>
        ) : (
          <>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("settingsDeep.subagents.searchPlaceholder")}
              className="h-8 text-xs"
              aria-label={t("settingsDeep.subagents.searchPlaceholder")}
            />
            <ul className="space-y-1" data-testid="subagents-list">
              {page.items.map((p) => {
                const open = expanded === p.role
                return (
                  <li key={p.role} className="rounded border">
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-center justify-between gap-1 px-2 py-1.5 text-left"
                      onClick={() => setExpanded(open ? null : p.role)}
                      aria-expanded={open}
                    >
                      <span className="font-mono text-xs">{p.role}</span>
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                          {t("settingsDeep.subagents.version")} {p.version}
                        </Badge>
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">
                          {t("settingsDeep.subagents.score")}{" "}
                          {p.avgScore !== null ? p.avgScore.toFixed(1) : "—"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {t("settingsDeep.subagents.executions")} {p.executionCount}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t("settingsDeep.subagents.feedback")}{" "}
                          {t("settingsDeep.subagents.feedbackEntries").replace(
                            "{count}",
                            String(p.recentFeedbackCount),
                          )}
                        </span>
                      </span>
                    </button>
                    {open && (
                      <div
                        className="space-y-2 border-t px-2 py-1.5"
                        data-testid={`subagents-detail-${p.role}`}
                      >
                        <p className="text-xs text-muted-foreground font-medium">
                          {t("settingsDeep.subagents.memory")}
                        </p>
                        {p.memoryBuckets.every((b) => b.entries.length === 0) ? (
                          <p className="text-xs text-muted-foreground">
                            {t("settingsDeep.subagents.memoryEmpty")}
                          </p>
                        ) : (
                          p.memoryBuckets
                            .filter((b) => b.entries.length > 0)
                            .map((b) => (
                              <div key={b.name} className="rounded border px-2 py-1">
                                <p className="text-xs font-medium">
                                  {t(`settingsDeep.subagents.bucket.${b.name}`)}{" "}
                                  <span className="text-muted-foreground">
                                    ({b.entries.length})
                                  </span>
                                </p>
                                <ul className="mt-1 space-y-0.5">
                                  {bucketPreview(b).map((entry, i) => (
                                    <li
                                      key={i}
                                      className="whitespace-pre-wrap break-words text-xs text-muted-foreground"
                                    >
                                      {entry}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))
                        )}
                        {p.successRate !== null && (
                          <p className="text-xs text-muted-foreground">
                            {t("settingsDeep.subagents.successRate")}:{" "}
                            {(p.successRate * 100).toFixed(0)}%
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {page.hidden > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="subagents-more">
                {t("settingsDeep.common.showing")
                  .replace("{shown}", String(page.shown))
                  .replace("{total}", String(page.total))}
              </p>
            )}
            {isFetching && (
              <p className="text-xs text-muted-foreground">{t("settingsDeep.common.loading")}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
