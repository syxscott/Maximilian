// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * MemoryDomain — read-only per-role memory viewer over the existing
 * GET /api/evolution/agents surface (facade.profiles). Role selector on
 * top, then one card per memory bucket with a count and a short preview
 * of the most recent entries. Pure read; no mutations anywhere.
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import { useSubagentProfiles } from "@/hooks/useSettingsQueries"
import {
  MEMORY_BUCKETS,
  bucketPreviews,
  pickRole,
  toMemoryRoleViews,
  type MemoryBucketName,
} from "./model"

export function MemoryDomain() {
  useLocale()
  const [selected, setSelected] = useState<string | null>(null)
  const { data, isLoading, isError, refetch, isFetching } = useSubagentProfiles()

  const roles = useMemo(() => toMemoryRoleViews(data), [data])
  const active = pickRole(roles, selected)

  return (
    <Card data-testid="settings-memory">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("memory.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("memory.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("memory.state.loading")}</p>
        ) : isError ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive">{t("memory.state.error")}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {t("memory.state.retry")}
            </Button>
          </div>
        ) : roles.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="memory-empty">
            {t("memory.state.empty")}
          </p>
        ) : (
          <>
            <div
              className="flex flex-wrap gap-1"
              role="tablist"
              aria-label={t("memory.roleSelector")}
              data-testid="memory-role-selector"
            >
              {roles.map((r) => (
                <Button
                  key={r.role}
                  size="sm"
                  variant={active?.role === r.role ? "default" : "ghost"}
                  className="h-7 px-2 font-mono text-[11px]"
                  onClick={() => setSelected(r.role)}
                  aria-pressed={active?.role === r.role}
                >
                  {r.role}
                </Button>
              ))}
            </div>

            {active !== null && (
              <div className="space-y-2" data-testid={`memory-role-${active.role}`}>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">
                    {t("memory.version")} {active.version}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t("memory.totalEntries").replace("{count}", String(active.totalEntries))}
                  </span>
                  {isFetching && (
                    <span className="text-xs text-muted-foreground">
                      {t("memory.state.loading")}
                    </span>
                  )}
                </div>
                {MEMORY_BUCKETS.map((name: MemoryBucketName) => {
                  const bucket = active.buckets.find((b) => b.name === name)
                  const previews = bucket !== undefined ? bucketPreviews(bucket) : []
                  return (
                    <div
                      key={name}
                      className="rounded border px-2 py-1.5"
                      data-testid={`memory-bucket-${name}`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium">{t(`memory.bucket.${name}`)}</p>
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                          {bucket?.count ?? 0}
                        </Badge>
                      </div>
                      {previews.length === 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("memory.bucketEmpty")}
                        </p>
                      ) : (
                        <ul className="mt-1 space-y-0.5">
                          {previews.map((entry, i) => (
                            <li
                              key={i}
                              className="whitespace-pre-wrap break-words text-xs text-muted-foreground"
                            >
                              {entry}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
