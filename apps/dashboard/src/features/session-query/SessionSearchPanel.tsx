// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SessionSearchPanel — cross-session message search (ui-session /
 * session-query borrowing). Debounced input (300ms) → GET
 * /sessions/search → results sectioned by session, each hit rendered as
 * an ai-elements StatusPill role capsule plus a three-segment snippet
 * with the match emphasized, and a CopyField chip that copies the full
 * message content. Pure presentation: derivation lives in model.ts,
 * fetching in useSessionSearch.ts.
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CopyField, StatusPill } from "@/components/ai-elements"
import { Search } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { groupSearchResults, roleStatus } from "./model"
import { useSessionSearch } from "./useSessionSearch"

const DEBOUNCE_MS = 300

export function SessionSearchPanel({
  workspaceId,
  onOpenSession,
}: {
  /** Optional workspace scope passed through to the search endpoint. */
  workspaceId?: string
  /** Reserved wiring — called when the operator opens a hit's session. */
  onOpenSession?: (sessionId: string) => void
}) {
  useLocale()
  const [rawQuery, setRawQuery] = useState("")
  const query = useDebouncedValue(rawQuery.trim(), DEBOUNCE_MS)
  const search = useSessionSearch(query, workspaceId)
  const view = useMemo(
    () => groupSearchResults(search.data?.results ?? [], query),
    [search.data, query],
  )

  const idle = query.length === 0

  return (
    <Card data-testid="session-search-panel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{t("sessionQuery.title")}</CardTitle>
        {!idle && !search.isPending && search.error === undefined && (
          <Badge variant="secondary" className="h-5 px-2 text-[10px]">
            {t("sessionQuery.resultCount", { count: view.hitCount })}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            data-testid="session-search-input"
            aria-label={t("sessionQuery.title")}
            className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            placeholder={t("sessionQuery.placeholder")}
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
          />
        </div>

        {idle ? (
          <p className="text-xs text-muted-foreground" data-testid="session-search-idle">
            {t("sessionQuery.idle")}
          </p>
        ) : search.isPending ? (
          <p className="text-xs text-muted-foreground" data-testid="session-search-loading">
            {t("sessionQuery.searching")}
          </p>
        ) : search.error ? (
          <p className="text-xs text-destructive" data-testid="session-search-error">
            {t("sessionQuery.error")}
            {search.error instanceof Error ? `: ${search.error.message}` : ""}
          </p>
        ) : view.groups.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="session-search-empty">
            {t("sessionQuery.empty")}
          </p>
        ) : (
          <div className="space-y-3" data-testid="session-search-groups">
            {view.groups.map((group) => (
              <section key={group.sessionId} data-testid="session-search-group">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-foreground">
                    {group.sessionId}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {t("sessionQuery.groupHits", { count: group.hits.length })}
                  </span>
                </div>
                <ul className="space-y-1">
                  {group.hits.map((hit, i) => (
                    <li
                      key={i}
                      className="flex items-start justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50"
                    >
                      <div className="flex min-w-0 items-baseline gap-2">
                        <StatusPill
                          status={roleStatus(hit.role)}
                          label={hit.role}
                          className="shrink-0"
                        />
                        <span
                          className="truncate text-xs text-muted-foreground"
                          data-testid="session-search-snippet"
                          title={hit.highlight.before + hit.highlight.match + hit.highlight.after}
                        >
                          {hit.highlight.before}
                          <strong className="font-semibold text-foreground">
                            {hit.highlight.match}
                          </strong>
                          {hit.highlight.after}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <CopyField field={{ value: hit.content, label: t("sessionQuery.copy") }} />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 px-2 text-[10px]"
                          onClick={() => onOpenSession?.(group.sessionId)}
                        >
                          {t("sessionQuery.openSession")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
