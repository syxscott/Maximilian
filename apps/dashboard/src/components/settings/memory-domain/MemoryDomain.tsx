// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * MemoryDomain — read-only per-role memory viewer over the existing
 * GET /api/evolution/agents surface (facade.profiles). Role selector on
 * top, then one expandable card per memory bucket: full entry list with
 * per-entry full content, the efficacy ledger (injectedCount / deltaSum /
 * mean) and the gating inference badge ("would be skipped under enforce",
 * same thresholds as @max/evolution gatingDecisions). A search box filters
 * entries across buckets. Pure read; no mutations anywhere.
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLocale, t } from "@max/i18n"
import { useSubagentProfiles } from "@/hooks/useSettingsQueries"
import {
  entryPreview,
  pickRole,
  searchRoleEntries,
  toMemoryRoleViews,
  type MemoryBucketView,
} from "./model"

export function MemoryDomain() {
  useLocale()
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [openBuckets, setOpenBuckets] = useState<Record<string, boolean>>({})
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const { data, isLoading, isError, refetch, isFetching } = useSubagentProfiles()

  const roles = useMemo(() => toMemoryRoleViews(data), [data])
  const active = pickRole(roles, selected)
  const hits = useMemo(
    () => (active !== null ? searchRoleEntries(active, query) : { buckets: [], matches: 0 }),
    [active, query],
  )

  const toggleBucket = (name: string) =>
    setOpenBuckets((prev) => ({ ...prev, [name]: !prev[name] }))

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
                  {query.trim() !== "" && (
                    <span className="text-xs text-muted-foreground" data-testid="memory-matches">
                      {t("memory.search.matches").replace("{count}", String(hits.matches))}
                    </span>
                  )}
                  {isFetching && (
                    <span className="text-xs text-muted-foreground">
                      {t("memory.state.loading")}
                    </span>
                  )}
                </div>

                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("memory.search.placeholder")}
                  aria-label={t("memory.search.label")}
                  className="h-8 text-xs"
                  data-testid="memory-search"
                />

                {hits.buckets.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="memory-search-empty">
                    {t("memory.search.noMatch")}
                  </p>
                ) : (
                  hits.buckets.map((bucket) => (
                    <MemoryBucketCard
                      key={bucket.name}
                      bucket={bucket}
                      efficacy={active.efficacy[bucket.name] ?? null}
                      open={openBuckets[bucket.name] === true}
                      onToggle={() => toggleBucket(bucket.name)}
                      openEntry={openEntry}
                      onToggleEntry={(key) => setOpenEntry((prev) => (prev === key ? null : key))}
                    />
                  ))
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function MemoryBucketCard(props: {
  bucket: MemoryBucketView
  efficacy: { injectedCount: number; deltaSum: number; mean: number | null } | null
  open: boolean
  onToggle: () => void
  openEntry: string | null
  onToggleEntry: (key: string) => void
}) {
  const { bucket, efficacy, open, onToggle, openEntry, onToggleEntry } = props
  const skip = efficacy?.mean != null && efficacy.injectedCount >= 3 && efficacy.mean < -0.25
  return (
    <div className="rounded border px-2 py-1.5" data-testid={`memory-bucket-${bucket.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div className="flex flex-wrap items-center gap-1">
          <p className="text-xs font-medium">{t(`memory.bucket.${bucket.name}`)}</p>
          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
            {bucket.count}
          </Badge>
          {skip && (
            <Badge
              variant="destructive"
              className="h-4 px-1 text-[10px]"
              title={t("memory.gating.basis")}
              data-testid={`memory-gating-${bucket.name}`}
            >
              {t("memory.gating.wouldSkip")}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1 text-[10px]"
          onClick={onToggle}
          aria-expanded={open}
          data-testid={`memory-bucket-${bucket.name}-toggle`}
        >
          {open ? t("memory.bucket.collapse") : t("memory.bucket.expand")}
        </Button>
      </div>

      {efficacy !== null ? (
        <p
          className="mt-0.5 font-mono text-[10px] text-muted-foreground"
          data-testid={`memory-efficacy-${bucket.name}`}
        >
          {t("memory.efficacy.injectedCount")} {efficacy.injectedCount} ·{" "}
          {t("memory.efficacy.deltaSum")} {round2(efficacy.deltaSum)} · {t("memory.efficacy.mean")}{" "}
          {efficacy.mean === null ? "—" : round2(efficacy.mean)}
        </p>
      ) : (
        bucket.count > 0 && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">{t("memory.efficacy.noData")}</p>
        )
      )}

      {!open ? (
        bucket.count === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">{t("memory.bucketEmpty")}</p>
        )
      ) : bucket.entries.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{t("memory.bucketEmpty")}</p>
      ) : (
        <ul className="mt-1 space-y-1" data-testid={`memory-bucket-${bucket.name}-entries`}>
          {bucket.entries.map((entry, i) => {
            const key = `${bucket.name}:${i}`
            const expanded = openEntry === key
            return (
              <li key={key} className="rounded border border-border/60 px-1.5 py-1">
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => onToggleEntry(key)}
                  aria-expanded={expanded}
                  data-testid={`memory-entry-${bucket.name}-${i}`}
                >
                  <span className="block break-words text-xs">
                    {expanded ? entry.content : entryPreview(entry.content)}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    <Badge variant="outline" className="h-3.5 px-1 font-mono text-[9px]">
                      {entry.mime}
                    </Badge>
                    <span>
                      {t("memory.entry.at")}: {entry.at ?? t("memory.entry.timeUnknown")}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function round2(value: number): string {
  return String(Math.round(value * 100) / 100)
}
