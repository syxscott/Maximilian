// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * MigrationCandidatesCard — sizing profile of the three surfaces that a
 * store/contract migration would touch (ZCode settings borrowing): the
 * API contract route count, the SQLite session-store schema, and the i18n
 * core dictionary. Source: GET /system/migrations (read-only). Metrics the
 * backend could not read (deployment-shape differences) render honestly as
 * "unknown" — never a guessed value.
 */

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import { useMigrationCandidates } from "@/hooks/useSettingsQueries"
import { toMigrationsStatusView } from "./model"

export function MigrationCandidatesCard() {
  useLocale()
  const { data, isLoading, isError, refetch, isFetching } = useMigrationCandidates()
  const view = useMemo(() => toMigrationsStatusView(data), [data])

  return (
    <Card data-testid="settings-migrations">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settingsDeep.migrations.title")}</CardTitle>
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
              {/* API contract */}
              <div className="rounded border px-2 py-1.5" data-testid="migrations-api">
                <p className="text-[10px] text-muted-foreground">
                  {t("settingsDeep.migrations.api")}
                </p>
                <p className="font-mono text-xs">
                  {t("settingsDeep.migrations.openapiRoutes")}:{" "}
                  <span data-testid="migrations-api-routes">
                    {view.apiRoutes === null
                      ? t("settingsDeep.migrations.unknown")
                      : view.apiRoutes}
                  </span>
                </p>
              </div>
              {/* Session store */}
              <div className="rounded border px-2 py-1.5" data-testid="migrations-store">
                <p className="text-[10px] text-muted-foreground">
                  {t("settingsDeep.migrations.sessionStore")}
                </p>
                <div className="flex flex-wrap items-center gap-1">
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
              </div>
              {/* i18n core dictionary */}
              <div className="rounded border px-2 py-1.5" data-testid="migrations-i18n">
                <p className="text-[10px] text-muted-foreground">
                  {t("settingsDeep.migrations.i18n")}
                </p>
                <p className="font-mono text-xs">
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
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">{t("settingsDeep.migrations.hint")}</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
