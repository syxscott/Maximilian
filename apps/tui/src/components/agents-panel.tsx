import React, { useCallback, useEffect, useRef, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import Spinner from "ink-spinner"

import type { AgentProfilePayload, LeaderboardEntryPayload } from "../api"
import { useSDK } from "../context/sdk"
import { agentDetail, buildAgentRows, leaderboardByRole, type AgentRowView } from "./agents-model"
import { elapsedSeconds } from "./jobs-model"
import "../locales/tui-panels"

/**
 * Agents panel — the TUI face of the evolution domain (GET
 * /api/evolution/agents + GET /api/evolution/leaderboard): one row per agent
 * role (role name · current version · cumulative tasks · avgScore rating
 * dot), sorted avgScore desc. Enter expands the selected role's detail
 * (memory bucket counts + recent review scores + the version-promotion
 * timeline from the leaderboard's decision history), r refreshes (a live
 * "updated Ns ago" hint keeps the cadence visible, the jobs-dialog pattern).
 * Both endpoints are read-only here — evolving a role stays an API/CLI
 * concern.
 */
export function AgentsPanel() {
  const sdk = useSDK()
  const [profiles, setProfiles] = useState<AgentProfilePayload[]>([])
  const [entries, setEntries] = useState<LeaderboardEntryPayload[]>([])
  const [lastRebuilt, setLastRebuilt] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [expandedRole, setExpandedRole] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  // 1s heartbeat so the refresh hint ages without waiting for a keypress.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  // Freeze "now" per data load so relative timestamps age consistently.
  const nowRef = useRef(Date.now())
  const loadedOnceRef = useRef(false)
  if (!isLoading) loadedOnceRef.current = true

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false

    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const [agents, board] = await Promise.all([
          sdk.client.get<{ count: number; profiles: AgentProfilePayload[] }>(
            "/api/evolution/agents?limit=100",
          ),
          sdk.client.get<{ entries?: LeaderboardEntryPayload[]; lastRebuilt?: string }>(
            "/api/evolution/leaderboard",
          ),
        ])
        if (cancelled || ctrl.signal.aborted) return
        setProfiles(Array.isArray(agents?.profiles) ? agents.profiles : [])
        setEntries(Array.isArray(board?.entries) ? board.entries : [])
        setLastRebuilt(typeof board?.lastRebuilt === "string" ? board.lastRebuilt : null)
        nowRef.current = Date.now()
      } catch (err) {
        if (cancelled || ctrl.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled && !ctrl.signal.aborted) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [sdk.client, nonce])

  const rows = buildAgentRows(profiles, entries)
  const byRole = leaderboardByRole(entries)
  const maxCursor = Math.max(0, rows.length - 1)
  const safeCursor = Math.min(cursor, maxCursor)
  const selected = rows.length > 0 ? rows[safeCursor] : undefined

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setCursor((prev) => Math.max(0, Math.min(prev, maxCursor) - 1))
      return
    }
    if (key.downArrow || input === "j") {
      setCursor((prev) => Math.min(maxCursor, Math.min(prev, maxCursor) + 1))
      return
    }
    if (key.return) {
      if (selected) setExpandedRole((prev) => (prev === selected.role ? null : selected.role))
      return
    }
    if (input === "r") {
      nowRef.current = Date.now()
      refresh()
      return
    }
  })

  const now = nowRef.current

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>
          {t("tui.agents", "Agents")}
          {rows.length > 0 ? ` (${rows.length})` : ""}
        </Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {isLoading && !loadedOnceRef.current ? (
          <Text color="gray">
            <Spinner type="dots" /> {t("tui.agents.loading", "Loading agent profiles…")}
          </Text>
        ) : error ? (
          <Text color="red">
            {t("tui.agents.error", { error }, `Failed to load agents: ${error}`)}
          </Text>
        ) : rows.length === 0 ? (
          <Text color="gray">
            {t("tui.agents.empty", "No agent profiles yet — run a task to evolve one.")}
          </Text>
        ) : (
          rows.map((row, index) => (
            <AgentRow
              key={row.key}
              row={row}
              selected={index === safeCursor}
              expanded={expandedRole === row.role}
              detail={agentDetail(
                profiles.find((p) => p?.role === row.role) ?? null,
                byRole.get(row.role) ?? null,
              )}
            />
          ))
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {t("tui.agents.hints", "j/k move · Enter details · r refresh · esc close")}
        </Text>
        {(() => {
          const age = elapsedSeconds(now, Date.now())
          return age !== null ? (
            <Text dimColor>
              {t("tui.agents.refreshAgo", { seconds: age }, `updated ${age}s ago · r refresh`)}
            </Text>
          ) : null
        })()}
      </Box>
    </Box>
  )
}

function AgentRow(props: {
  row: AgentRowView
  selected: boolean
  expanded: boolean
  detail: ReturnType<typeof agentDetail>
}) {
  const { row, selected, expanded, detail } = props
  const score = row.avgScore != null ? row.avgScore.toFixed(1) : t("tui.agents.unrated", "unrated")
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text> </Text>
        <Text color={selected ? "green" : undefined}>{selected ? "❯" : " "}</Text>
        <Text color={row.color}>● </Text>
        <Text color={selected ? "green" : undefined} bold={selected}>
          {row.role}
        </Text>
        <Text dimColor>
          {" "}
          · {row.currentVersion} ·{" "}
          {t("tui.agents.tasks", { count: row.totalTasks }, `${row.totalTasks} tasks`)} · {score} ★
          {row.model != null ? ` · ${row.model}` : ""}
        </Text>
      </Box>
      {expanded ? <AgentDetail row={row} detail={detail} /> : null}
    </Box>
  )
}

function AgentDetail(props: { row: AgentRowView; detail: ReturnType<typeof agentDetail> }) {
  const { row, detail } = props
  const total = detail.totalEntries
  return (
    <Box flexDirection="column" paddingLeft={4} marginBottom={1}>
      <Text dimColor>
        {t("tui.agents.detail.memory", "memory buckets")} (
        {t("tui.agents.detail.memoryTotal", { count: total }, `${count(total)} entries`)}):
      </Text>
      <Text dimColor>
        {" "}
        {detail.buckets.map((b) => `${t(b.labelKey, b.key)} ${b.count}`).join(" · ")}
      </Text>
      <Text dimColor>
        {" "}
        {t("tui.agents.detail.versions", "versions")}: {row.currentVersion}
        {detail.versions.length > 1
          ? ` ${t("tui.agents.detail.versionHistory", { versions: detail.versions.join(", ") }, `(${detail.versions.join(", ")})`)}`
          : ""}
      </Text>
      {detail.recentScores.length > 0 ? (
        <>
          <Text dimColor> {t("tui.agents.detail.recentScores", "recent review scores")}:</Text>
          {detail.recentScores.map((s, i) => (
            <Text key={`${s.version}-${i}`} dimColor>
              {" "}
              {s.score.toFixed(1)} ★ → {s.version}
              {s.at != null ? ` · ${s.at.slice(0, 10)}` : ""}
            </Text>
          ))}
        </>
      ) : (
        <Text dimColor> {t("tui.agents.noScores", "no review decisions recorded yet")}</Text>
      )}
      {detail.promotions.length > 0 ? (
        <>
          <Text dimColor> {t("tui.agents.detail.promotions", "version promotions")}:</Text>
          {detail.promotions.map((p, i) => (
            <Text
              key={`${p.fromVersion}-${p.toVersion}-${i}`}
              dimColor={p.outcome !== "promoted"}
              color={p.outcome === "promoted" ? "green" : undefined}
            >
              {" "}
              {p.fromVersion} → {p.toVersion}
              {p.oldAvgScore != null && p.newAvgScore != null
                ? ` (${p.oldAvgScore.toFixed(1)} → ${p.newAvgScore.toFixed(1)})`
                : ""}
              {p.at != null ? ` · ${p.at.slice(0, 10)}` : ""}
              {p.reason.length > 0 ? ` — ${p.reason}` : ""}
            </Text>
          ))}
        </>
      ) : (
        <Text dimColor> {t("tui.agents.noLeaderboard", "no leaderboard entries yet")}</Text>
      )}
    </Box>
  )
}

function count(n: number): string {
  return Number.isFinite(n) ? String(n) : "0"
}

export default AgentsPanel
