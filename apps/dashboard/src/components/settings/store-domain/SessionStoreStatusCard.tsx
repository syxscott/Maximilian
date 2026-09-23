// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SessionStoreStatusCard — lightweight migrations/info domain: schema
 * version, database path and per-table row counts for the SQLite session
 * side store (GET /system/session-store).
 */

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import { useSessionStoreStatus } from "@/hooks/useSettingsQueries"
import { toStoreStatusView } from "./model"

export function SessionStoreStatusCard() {
  useLocale()
  const { data, isLoading, isError, refetch, isFetching } = useSessionStoreStatus()
  const view = useMemo(() => toStoreStatusView(data), [data])

  return (
    <Card data-testid="settings-session-store">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settingsDeep.store.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("settingsDeep.store.description")}</p>
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
            <div className="flex items-center gap-2">
              <Badge
                variant={view.available ? "default" : "outline"}
                className="h-4 px-1 text-[10px]"
                data-testid="store-available-badge"
              >
                {view.available
                  ? t("settingsDeep.store.available")
                  : t("settingsDeep.store.disabled")}
              </Badge>
              {view.schemaVersion !== null && (
                <span className="text-xs text-muted-foreground">
                  {t("settingsDeep.store.schemaVersion")}: {view.schemaVersion}
                </span>
              )}
              {isFetching && (
                <span className="text-xs text-muted-foreground">
                  {t("settingsDeep.common.loading")}
                </span>
              )}
            </div>
            {view.path && (
              <p className="break-all font-mono text-xs text-muted-foreground">
                {t("settingsDeep.store.path")}: {view.path}
              </p>
            )}
            {!view.available && (
              <p className="text-xs text-muted-foreground">
                {t("settingsDeep.store.disabledHint")}
              </p>
            )}
            {view.tables.length > 0 && (
              <div>
                <p className="text-xs font-medium">{t("settingsDeep.store.tables")}</p>
                <div
                  className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3"
                  data-testid="store-table-grid"
                >
                  {view.tables.map((tb) => (
                    <div key={tb.name} className="rounded border px-2 py-1.5">
                      <p className="text-[10px] text-muted-foreground">
                        {t(`settingsDeep.store.table.${tb.name}`)}
                      </p>
                      <p className="font-mono text-xs" data-table={tb.name}>
                        {tb.count === null ? t("settingsDeep.store.countUnknown") : tb.count}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
