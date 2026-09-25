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
 *
 * The migrations payload's real numeric anchors (contract routes,
 * locales, core keys) surface beside its health chip as compact mono
 * badges in the TokenUsageBadge visual style — the style only: those
 * counts are not token usage, so the token component itself stays
 * unmounted and the chips carry the honest settingsDeep.migrations
 * labels instead.
 */

import { Fragment, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { systemApi } from "@/api"
import { SkeletonBlock } from "@/components/ai-elements"
import {
  useMigrationCandidates,
  useSessionStoreStatus,
  ORACLE_LESSONS_QUERY_KEY,
} from "@/hooks/useSettingsQueries"
import { VaultSection, OracleLessonsSection } from "../sections"
import { SessionStoreStatusCard } from "../store-domain/SessionStoreStatusCard"
import { MigrationCandidatesCard } from "../store-domain/MigrationCandidatesCard"
import {
  migrationsMetrics,
  toSystemHealthView,
  type SubsystemId,
  type SubsystemState,
} from "./model"

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

/**
 * Card loading state (ai-elements SkeletonBlock): while a subsystem's
 * first fetch is in flight its composed card is replaced by a rect
 * skeleton — the health row above already speaks "unknown" for the same
 * window, so the body shows a placeholder instead of each card's own
 * partial empty state.
 */
function CardSkeleton({ id }: { id: SubsystemId }) {
  return (
    <div data-testid={`system-card-skeleton-${id}`}>
      <SkeletonBlock shape="rect" />
    </div>
  )
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

  const metrics = useMemo(
    () => migrationsMetrics(migrationsQuery.isError ? undefined : migrationsQuery.data),
    [migrationsQuery.data, migrationsQuery.isError],
  )

  return (
    <div className="space-y-3" data-testid="settings-system-overview">
      <div className="flex flex-wrap items-center gap-2" data-testid="system-health-row">
        {health.map(({ id, state }) => {
          const Icon = STATE_ICONS[state]
          return (
            <Fragment key={id}>
              <span
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
              {id === "migrations" &&
                metrics.map((metric) => (
                  <span
                    key={metric.id}
                    data-testid={`system-metric-${metric.id}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {t(`settingsDeep.migrations.${metric.id}`)}
                    <span className="font-mono tabular-nums text-foreground">{metric.value}</span>
                  </span>
                ))}
            </Fragment>
          )
        })}
      </div>
      {/* Composed cards, each gated on its subsystem's FIRST load: the
          summary row's queries are the same keys the cards use, so the
          section knows the loading window without extra requests. */}
      {vaultQuery.isLoading ? <CardSkeleton id="vault" /> : <VaultSection />}
      {storeQuery.isLoading ? <CardSkeleton id="store" /> : <SessionStoreStatusCard />}
      {migrationsQuery.isLoading ? <CardSkeleton id="migrations" /> : <MigrationCandidatesCard />}
      {oracleQuery.isLoading ? <CardSkeleton id="oracle" /> : <OracleLessonsSection />}
    </div>
  )
}
