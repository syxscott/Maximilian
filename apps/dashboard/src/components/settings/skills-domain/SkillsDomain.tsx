// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SkillsDomain — built-in capability catalog. Static snapshot of the
 * @max/tools tool artifacts (see skills-catalog.ts): grouped by ToolKind
 * with source provenance, plus an explicit "dynamic registry API not
 * wired yet" note. No network access by design.
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { useLocale, t } from "@max/i18n"
import { SKILL_CATALOG } from "./skills-catalog"
import { filterCatalog, groupCatalogByKind, kindCounts, kindLabelKey } from "./model"

export function SkillsDomain() {
  useLocale()
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => filterCatalog(SKILL_CATALOG, query), [query])
  const groups = useMemo(() => groupCatalogByKind(filtered), [filtered])
  const counts = useMemo(() => kindCounts(SKILL_CATALOG), [])

  return (
    <Card data-testid="settings-skills">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("skills.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("skills.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p
          className="rounded border border-dashed px-2 py-1.5 text-xs text-muted-foreground"
          data-testid="skills-source-note"
        >
          {t("skills.sourceNote")}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("skills.searchPlaceholder")}
            className="h-8 max-w-48 text-xs"
            aria-label={t("skills.searchPlaceholder")}
          />
          <span className="flex flex-wrap items-center gap-1" data-testid="skills-kind-counts">
            {(["read", "edit", "search", "execute"] as const).map((kind) => (
              <Badge key={kind} variant="outline" className="h-4 px-1 text-[10px]">
                {t(kindLabelKey(kind))} {counts[kind]}
              </Badge>
            ))}
          </span>
        </div>

        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="skills-empty">
            {t("skills.state.noMatch")}
          </p>
        ) : (
          <div className="space-y-2" data-testid="skills-groups">
            {groups.map((group) => (
              <div key={group.kind} className="rounded border">
                <div className="border-b px-2 py-1">
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {t(kindLabelKey(group.kind))}
                  </Badge>
                </div>
                <ul className="divide-y">
                  {group.entries.map((entry) => (
                    <li
                      key={entry.name}
                      className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5"
                      data-testid={`skills-tool-${entry.name}`}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="font-mono text-xs">{entry.name}</span>
                        <span className="text-xs text-muted-foreground">{t(entry.purposeKey)}</span>
                      </span>
                      <Badge variant="outline" className="h-4 px-1 font-mono text-[10px]">
                        {entry.source}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
