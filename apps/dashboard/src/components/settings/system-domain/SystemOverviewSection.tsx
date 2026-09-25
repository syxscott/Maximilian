// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SystemOverviewSection — the settings center's system aggregate page:
 * one health summary row over the four status subsystems (vault, session
 * store, migrations sizing, oracle lessons) followed by the existing
 * cards, composed as-is. Pure composition — every card keeps its own
 * react-query data path; the summary row subscribes to the same query
 * keys, so react-query serves both from a single fetch.
 */

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { systemApi } from "@/api"
import {
  useMigrationCandidates,
  useSessionStoreStatus,
  ORACLE_LESSONS_QUERY_KEY,
} from "@/hooks/useSettingsQueries"
import { VaultSection, OracleLessonsSection } from "../sections"
import { SessionStoreStatusCard } from "../store-domain/SessionStoreStatusCard"
import { MigrationCandidatesCard } from "../store-domain/MigrationCandidatesCard"
import { toSystemHealthView, type SubsystemState } from "./model"

const STATE_ICONS: Record<SubsystemState, typeof CheckCircle2> = {
  ok: CheckCircle2,
  degraded: AlertTriangle,
  unknown: MinusCircle,
}

const STATE_CLASSES: Record<SubsystemState, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  degraded: "text-amber-600 dark:text-amber-400",
  unknown: "text-muted-foreground",
}

export function SystemOverviewSection() {
  useLocale()

  // Same query keys the composed cards use — react-query dedupes these
  // into one network request per subsystem.
  const vaultQuery = useQuery({
    queryKey: ["settings", "vault"],
    queryFn: ({ signal }) => systemApi.vaultStatus(signal),
    staleTime: 30_000,
  })
  const storeQuery = useSessionStoreStatus()
  const migrationsQuery = useMigrationCandidates()
  const oracleQuery = useQuery({
    queryKey: [...ORACLE_LESSONS_QUERY_KEY],
    queryFn: ({ signal }) => systemApi.oracleLessons(signal),
    staleTime: 60_000,
  })

  const health = useMemo(
    () =>
      toSystemHealthView({
        vault: vaultQuery.isError ? undefined : vaultQuery.data,
        store: storeQuery.isError ? undefined : storeQuery.data,
        migrations: migrationsQuery.isError ? undefined : migrationsQuery.data,
        oracle: oracleQuery.isError ? undefined : oracleQuery.data,
      }),
    [
      vaultQuery.data,
      vaultQuery.isError,
      storeQuery.data,
      storeQuery.isError,
      migrationsQuery.data,
      migrationsQuery.isError,
      oracleQuery.data,
      oracleQuery.isError,
    ],
  )

  return (
    <div className="space-y-3" data-testid="settings-system-overview">
      <div className="flex flex-wrap items-center gap-2" data-testid="system-health-row">
        {health.map(({ id, state }) => {
          const Icon = STATE_ICONS[state]
          return (
            <span
              key={id}
              className="flex items-center gap-1 rounded border px-2 py-1 text-xs"
              data-testid={`system-health-${id}`}
              data-state={state}
            >
              <Icon className={`h-3.5 w-3.5 ${STATE_CLASSES[state]}`} aria-hidden />
              <span className="font-mono">{t(`settingsDeep.system.item.${id}`)}</span>
              <span className={`text-[10px] ${STATE_CLASSES[state]}`}>
                {t(`settingsDeep.system.state.${state}`)}
              </span>
            </span>
          )
        })}
      </div>
      <VaultSection />
      <SessionStoreStatusCard />
      <MigrationCandidatesCard />
      <OracleLessonsSection />
    </div>
  )
}
