// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * MigrationCandidatesCard — the "system status" entry of the store section:
 * sizing/status of the three surfaces that a store/contract migration would
 * touch (ZCode settings borrowing): the API contract route count, the
 * SQLite session-store schema, and the i18n core dictionary. Source:
 * GET /system/migrations (read-only). Metrics the backend could not read
 * (deployment-shape differences) render honestly as "unknown" — never a
 * guessed value.
 *
 * Follow-ups: the header shows the last successful refresh time and a
 * manual refresh button (invalidates the migrations query), and each of
 * the three status blocks drills down into its raw JSON via <details>.
 */

import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import { MIGRATIONS_QUERY_KEY, useMigrationCandidates } from "@/hooks/useSettingsQueries"
import { formatClock, rawJsonText, toMigrationsStatusView } from "./model"

export function MigrationCandidatesCard() {
  useLocale()
  const queryClient = useQueryClient()
  const { data, dataUpdatedAt, isLoading, isError, refetch, isFetching } = useMigrationCandidates()
  const view = useMemo(() => toMigrationsStatusView(data), [data])
  const refreshedAt = formatClock(dataUpdatedAt)

  return (
    <Card data-testid="settings-migrations">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <CardTitle className="text-sm font-medium">
            {t("settingsDeep.migrations.title")}
          </CardTitle>
          <div className="flex items-center gap-1">
            {refreshedAt !== null && (
              <span
                className="text-[10px] text-muted-foreground"
                data-testid="migrations-refreshed-at"
              >
                {t("settingsDeep.migrations.refreshedAt").replace("{time}", refreshedAt)}
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1 text-[10px]"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: [...MIGRATIONS_QUERY_KEY] })
                void refetch()
              }}
              disabled={isFetching}
              aria-label={t("settingsDeep.migrations.refreshNow")}
              data-testid="migrations-refresh"
            >
              <RefreshCw className="mr-0.5 h-3 w-3" aria-hidden />
              {t("settingsDeep.migrations.refreshNow")}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("settingsDeep.migrations.description")}</p>
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
        ) : (
          <>
            {isFetching && (
              <span className="text-xs text-muted-foreground">
                {t("settingsDeep.common.loading")}
              </span>
            )}
            <div className="grid gap-2 sm:grid-cols-3" data-testid="migrations-grid">
              {/* API contract — click to drill into the raw JSON */}
              <details className="rounded border px-2 py-1.5" data-testid="migrations-api">
                <summary className="cursor-pointer select-none text-[10px] text-muted-foreground">
                  {t("settingsDeep.migrations.api")}
                </summary>
                <p className="mt-1 font-mono text-xs">
                  {t("settingsDeep.migrations.openapiRoutes")}:{" "}
                  <span data-testid="migrations-api-routes">
                    {view.apiRoutes === null
                      ? t("settingsDeep.migrations.unknown")
                      : view.apiRoutes}
                  </span>
                </p>
                <RawJsonSection value={data?.api} testId="migrations-api-json" />
              </details>
              {/* Session store */}
              <details className="rounded border px-2 py-1.5" data-testid="migrations-store">
                <summary className="cursor-pointer select-none text-[10px] text-muted-foreground">
                  {t("settingsDeep.migrations.sessionStore")}
                </summary>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge
                    variant={view.sessionStore.available ? "default" : "outline"}
                    className="h-4 px-1 text-[10px]"
                  >
                    {view.sessionStore.available
                      ? t("settingsDeep.store.available")
                      : t("settingsDeep.store.disabled")}
                  </Badge>
                  {view.sessionStore.schemaVersion !== null && (
                    <span className="font-mono text-xs">v{view.sessionStore.schemaVersion}</span>
                  )}
                </div>
                <p className="font-mono text-xs">
                  {t("settingsDeep.migrations.tables")}:{" "}
                  <span data-testid="migrations-store-tables">
                    {view.sessionStore.tables.length === 0
                      ? t("settingsDeep.migrations.unknown")
                      : view.sessionStore.tables.length}
                  </span>
                </p>
                <RawJsonSection value={data?.sessionStore} testId="migrations-store-json" />
              </details>
              {/* i18n core dictionary */}
              <details className="rounded border px-2 py-1.5" data-testid="migrations-i18n">
                <summary className="cursor-pointer select-none text-[10px] text-muted-foreground">
                  {t("settingsDeep.migrations.i18n")}
                </summary>
                <p className="mt-1 font-mono text-xs">
                  {t("settingsDeep.migrations.locales")}:{" "}
                  <span data-testid="migrations-i18n-locales">
                    {view.i18n.locales === null
                      ? t("settingsDeep.migrations.unknown")
                      : view.i18n.locales}
                  </span>
                </p>
                <p className="font-mono text-xs">
                  {t("settingsDeep.migrations.coreKeys")}:{" "}
                  <span data-testid="migrations-i18n-coreKeys">
                    {view.i18n.coreKeys === null
                      ? t("settingsDeep.migrations.unknown")
                      : view.i18n.coreKeys}
                  </span>
                </p>
                <RawJsonSection value={data?.i18n} testId="migrations-i18n-json" />
              </details>
            </div>
            <p className="text-[10px] text-muted-foreground">{t("settingsDeep.migrations.hint")}</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** <details>-native raw JSON drill-down for one status section. */
function RawJsonSection(props: { value: unknown; testId: string }) {
  const json = rawJsonText(props.value)
  return (
    json !== null && (
      <details className="mt-1" data-testid={props.testId}>
        <summary className="cursor-pointer select-none text-[10px] text-muted-foreground">
          {t("settingsDeep.migrations.rawJson")}
        </summary>
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/50 p-1 font-mono text-[10px]">
          {json}
        </pre>
      </details>
    )
  )
}
