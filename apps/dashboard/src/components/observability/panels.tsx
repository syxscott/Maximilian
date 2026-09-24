// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Observability panels (P3) — the analytics surfaces for the systems the
 * runtime already measures:
 *
 *   LeaderboardTable    per-role agent performance (evolution metrics)
 *   TruthReportPanel    prediction-vs-reality calibration (meta truth-audit)
 *   OracleTriadConsole  injection-ceiling measurement console (C2C)
 *
 * Pure model helpers live in lib/observability.ts (tested); these files
 * are presentation only.
 */

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLocale, t, formatNumber } from "@max/i18n"
import {
  evolutionApi,
  truthApi,
  oracleTriadApi,
  type TruthReportData,
  type OracleTriadData,
} from "@/api"
import { verdictTone, pgrLabel, formatPct } from "@/lib/observability"

// ── Leaderboard table ───────────────────────────────────────────────────────

export function LeaderboardTable() {
  useLocale()
  const { data, isLoading } = useQuery({
    queryKey: ["observability", "leaderboard"],
    queryFn: ({ signal }) => evolutionApi.leaderboard(signal),
    staleTime: 60_000,
  })
  const entries = useMemo(() => data?.entries ?? [], [data])

  return (
    <Card data-testid="leaderboard-table">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t("observability.leaderboard.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("observability.leaderboard.empty")}</p>
        ) : (
          <table className="w-full text-xs" data-testid="leaderboard-rows">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">{t("observability.leaderboard.role")}</th>
                <th className="py-1.5 pr-2 font-medium">
                  {t("observability.leaderboard.blueprint")}
                </th>
                <th className="py-1.5 pr-2 font-medium">{t("observability.leaderboard.runs")}</th>
                <th className="py-1.5 pr-2 font-medium">
                  {t("observability.leaderboard.avgScore")}
                </th>
                <th className="py-1.5 font-medium">{t("observability.leaderboard.acceptance")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr
                  key={`${entry.role}-${entry.blueprintId ?? i}`}
                  className="border-b last:border-0"
                >
                  <td className="py-1.5 pr-2 font-mono">{entry.agentRole ?? entry.role ?? "—"}</td>
                  <td className="py-1.5 pr-2 font-mono text-muted-foreground">
                    {entry.blueprintId ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2">{entry.runs ?? entry.sampleSize ?? 0}</td>
                  <td className="py-1.5 pr-2">
                    {entry.avgScore !== undefined
                      ? formatNumber(entry.avgScore, { maximumFractionDigits: 2 })
                      : "—"}
                  </td>
                  <td className="py-1.5">
                    {entry.acceptance !== undefined ? formatPct(entry.acceptance) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

// ── Truth report ────────────────────────────────────────────────────────────

function ErrorDim({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded border p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">
        {value !== undefined ? formatNumber(value, { maximumFractionDigits: 3 }) : "—"}
      </div>
    </div>
  )
}

export function TruthReportPanel() {
  useLocale()
  const { data, isLoading, error } = useQuery({
    queryKey: ["observability", "truth-report"],
    queryFn: ({ signal }) => truthApi.report(signal),
    staleTime: 60_000,
    retry: false,
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground">
          {t("common.loading")}
        </CardContent>
      </Card>
    )
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground">
          {t("observability.truth.unavailable")}
        </CardContent>
      </Card>
    )
  }

  const report = data as TruthReportData
  return (
    <Card data-testid="truth-report">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("observability.truth.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            {t("observability.truth.measurements")}: {report.totalMeasurements}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {report.windowStart?.slice(0, 10)} → {report.windowEnd?.slice(0, 10)}
          </span>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium">{t("observability.truth.absError")}</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <ErrorDim label="cost" value={report.meanAbsoluteError?.costDelta} />
            <ErrorDim label="latency (ms)" value={report.meanAbsoluteError?.latencyDeltaMs} />
            <ErrorDim label="quality" value={report.meanAbsoluteError?.qualityDelta} />
            <ErrorDim label="risk" value={report.meanAbsoluteError?.riskDelta} />
          </div>
        </div>
        {report.verdictCounts && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(report.verdictCounts).map(([verdict, count]) => (
              <Badge key={verdict} variant={verdictTone(verdict)} className="h-4 px-1 text-[10px]">
                {verdict}: {count}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Oracle triad console ────────────────────────────────────────────────────

export function OracleTriadConsole() {
  useLocale()
  const [role, setRole] = useState("")
  const [taskDescription, setTaskDescription] = useState("")
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<OracleTriadData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!role.trim() || !taskDescription.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      setReport(await oracleTriadApi.run({ role: role.trim(), taskDescription }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-testid="oracle-console">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("observability.oracle.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("observability.oracle.description")}</p>
        <div className="flex flex-wrap gap-2">
          <Input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder={t("observability.oracle.rolePlaceholder")}
            aria-label={t("observability.oracle.rolePlaceholder")}
            className="h-8 w-44 font-mono text-xs"
          />
          <Input
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
            placeholder={t("observability.oracle.taskPlaceholder")}
            aria-label={t("observability.oracle.taskPlaceholder")}
            className="h-8 min-w-64 flex-1 text-xs"
          />
          <Button
            size="sm"
            onClick={run}
            disabled={busy || !role.trim() || !taskDescription.trim()}
          >
            {busy ? t("common.loading") : t("observability.oracle.run")}
          </Button>
        </div>
        {error && (
          <p className="text-xs text-destructive" data-testid="oracle-error">
            {error}
          </p>
        )}
        {report && (
          <div className="space-y-2 rounded-md border p-2" data-testid="oracle-report">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                direct {report.direct?.quality ?? "—"}
              </Badge>
              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                few-shot {report.fewShot?.quality ?? "—"}
              </Badge>
              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                oracle {report.oracle?.quality ?? "—"}
              </Badge>
              <Badge
                variant={pgrLabel(report) ? "default" : "secondary"}
                className="h-4 px-1 text-[10px]"
              >
                PGR {report.pgr !== undefined ? formatPct(report.pgr) : "—"}
              </Badge>
              {report.oracleCorpusMissing && (
                <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                  {t("observability.oracle.corpusMissing")}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{report.interpretation}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
