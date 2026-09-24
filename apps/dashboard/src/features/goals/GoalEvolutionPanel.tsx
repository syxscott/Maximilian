// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * GoalEvolutionPanel — the evolution视角 under the goal tree ("角色表现"
 * section): the plan's agent roles cross-referenced with the evolution
 * engine's REAL leaderboard metrics (runs / avg score / acceptance per
 * role), plus an on-demand per-role detail (promoted versions, evolution
 * decisions, total tasks) fetched only when the user expands a role.
 *
 * Honest-data discipline: when the evolution engine is disabled or the
 * leaderboard is unreachable the section degrades to an explicit
 * "unavailable" note; roles without leaderboard entries simply don't
 * appear. Nothing is invented. The detail call is lazy (one click = one
 * fetch pair per role) via the generated API clients.
 */

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import {
  getEvolutionAgentsByRole,
  getEvolutionLeaderboard,
  getEvolutionVersionsByRoleDecisions,
} from "@/api-generated"
import { useLocale, t } from "@max/i18n"
import { matchRoleEntries, parseRoleDetail, roleColor } from "./model"

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="tabular-nums">
      <span className="text-muted-foreground">{label} </span>
      {value}
    </span>
  )
}

function RoleDetail({ role }: { role: string }) {
  const detail = useQuery({
    queryKey: ["goals", "evolution-role-detail", role],
    enabled: role.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      Promise.all([
        getEvolutionAgentsByRole(role, signal),
        getEvolutionVersionsByRoleDecisions(role, signal),
      ]),
  })

  if (detail.isPending) {
    return (
      <p
        className="flex items-center gap-1 text-[10px] text-muted-foreground"
        data-testid="goal-evolution-detail-loading"
      >
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {t("goals.evolution.detailLoading")}
      </p>
    )
  }
  if (detail.isError) {
    return (
      <p className="text-[10px] text-muted-foreground" data-testid="goal-evolution-detail-error">
        {t("goals.evolution.detailUnavailable")}
      </p>
    )
  }

  const [profile, decisionLog] = detail.data
  const view = parseRoleDetail(profile, decisionLog)
  return (
    <div
      className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]"
      data-testid="goal-evolution-detail"
    >
      {view.currentVersion !== null && (
        <Metric label={t("goals.evolution.version")} value={view.currentVersion} />
      )}
      {view.versionCount !== null && (
        <Metric label={t("goals.evolution.versions")} value={String(view.versionCount)} />
      )}
      {view.decisionCount !== null && (
        <Metric label={t("goals.evolution.decisions")} value={String(view.decisionCount)} />
      )}
      {view.totalTasks !== null && (
        <Metric label={t("goals.evolution.totalTasks")} value={String(view.totalTasks)} />
      )}
    </div>
  )
}

export function GoalEvolutionPanel({ roles }: { roles: string[] }) {
  useLocale()
  const [expanded, setExpanded] = useState<string | null>(null)

  const leaderboard = useQuery({
    queryKey: ["goals", "evolution-leaderboard"],
    enabled: roles.length > 0,
    staleTime: 60_000,
    queryFn: ({ signal }) => getEvolutionLeaderboard(signal),
  })

  const matched = matchRoleEntries(
    leaderboard.data != null && typeof leaderboard.data === "object"
      ? (leaderboard.data as Record<string, unknown>).entries
      : null,
    roles,
  )

  return (
    <div className="space-y-1" data-testid="goal-evolution-panel">
      <p className="text-xs font-medium text-muted-foreground">{t("goals.evolution.title")}</p>
      <p className="text-[10px] text-muted-foreground">{t("goals.evolution.description")}</p>

      {roles.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="goal-evolution-noroles">
          {t("goals.evolution.noRoles")}
        </p>
      ) : leaderboard.isPending ? (
        <p
          className="flex items-center gap-1 text-xs text-muted-foreground"
          data-testid="goal-evolution-loading"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {t("goals.evolution.loading")}
        </p>
      ) : leaderboard.isError ? (
        <p className="text-xs text-muted-foreground" data-testid="goal-evolution-unavailable">
          {t("goals.evolution.unavailable")}
        </p>
      ) : matched.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="goal-evolution-empty">
          {t("goals.evolution.empty")}
        </p>
      ) : (
        <ul className="space-y-0.5" data-testid="goal-evolution-rows">
          {matched.map((entry) => (
            <li key={entry.role}>
              <button
                type="button"
                className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-accent/40"
                onClick={() => setExpanded(expanded === entry.role ? null : entry.role)}
                aria-expanded={expanded === entry.role}
                data-testid={`goal-evolution-role-${entry.role}`}
              >
                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: roleColor(entry.role) }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs" title={entry.role}>
                    {entry.role}
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
                    <Metric
                      label={t("goals.evolution.runs")}
                      value={entry.runs === null ? "—" : String(entry.runs)}
                    />
                    <Metric
                      label={t("goals.evolution.avgScore")}
                      value={entry.avgScore === null ? "—" : entry.avgScore.toFixed(1)}
                    />
                    <Metric
                      label={t("goals.evolution.acceptance")}
                      value={entry.acceptance === null ? "—" : `${entry.acceptance}%`}
                    />
                  </span>
                </span>
              </button>
              {expanded === entry.role && <RoleDetail role={entry.role} />}
            </li>
          ))}
        </ul>
      )}
      {matched.length > 0 && (
        <p className="text-[10px] text-muted-foreground">{t("goals.evolution.hint")}</p>
      )}
    </div>
  )
}
