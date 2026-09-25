import React, { useCallback, useEffect, useRef, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import Spinner from "ink-spinner"

import type { AgentProfilePayload } from "../api"
import { useSDK } from "../context/sdk"
import { useClipboard } from "../context/clipboard"
import { useToast } from "./toast"
import { buildAgentRows } from "./agents-model"
import { elapsedSeconds } from "./jobs-model"
import {
  MEMORY_GATING_EPS,
  MEMORY_GATING_MIN_SAMPLES,
  buildMemoryExport,
  cycleEfficacyFilter,
  filterBuckets,
  formatSigned,
  memoryExportJson,
  memoryPanelView,
  sortEfficacy,
  type EfficacyFilter,
  type MemoryEntryView,
  type MemoryPanelView,
} from "./memory-model"
import "../locales/tui-panels"

/** i18n keys + honest fallbacks for the f-key filter chip. */
const EFFICACY_FILTER_LABELS: Record<EfficacyFilter, { key: string; fallback: string }> = {
  all: { key: "tui.memory.efficacy.filter.all", fallback: "all" },
  "skip-only": { key: "tui.memory.efficacy.filter.skipOnly", fallback: "skip-only" },
  "inject-only": { key: "tui.memory.efficacy.filter.injectOnly", fallback: "inject-only" },
}

/**
 * Memory panel — the TUI's read-side counterpart to the deepseek
 * ui-conversation memory explorer: pick one agent role (same data source as
 * the Agents panel, GET /api/evolution/agents) and browse its memory's four
 * buckets (userFeedback / reviewSuggestions / commonErrors / goodExamples)
 * — per-bucket count headers, one-line truncated entries with a mime badge,
 * Enter expands the full content — plus the efficacy ledger (injectedCount /
 * deltaSum / mean) with the gating-inference badge. The badge thresholds are
 * the engine's (@max/evolution gatingDecisions: skip iff samples ≥ 3 AND
 * mean < −0.25, strictly), exported from ./memory-model so UI and engine
 * can't drift. The ledger is sorted worst-first (mean ascending — the gated
 * bucket heads the list) and f cycles a bucket filter over it
 * (all → skip-only → inject-only).
 *
 * e exports the role's memory as JSON. The TUI has no Blob-download surface
 * (that's the dashboard's pattern), so it copies to the clipboard and
 * surfaces the result through the toast — the same success/failure channel
 * the jobs dialog uses. esc closes the panel (DialogProvider-owned).
 */
export function MemoryPanel() {
  const sdk = useSDK()
  const toast = useToast()
  const clipboard = useClipboard()
  const [profiles, setProfiles] = useState<AgentProfilePayload[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [roleCursor, setRoleCursor] = useState(0)
  const [itemCursor, setItemCursor] = useState(0)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  // f-key filter over the efficacy ledger: all → skip-only → inject-only.
  const [efficacyFilter, setEfficacyFilter] = useState<EfficacyFilter>("all")
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
        const agents = await sdk.client.get<{ count: number; profiles: AgentProfilePayload[] }>(
          "/api/evolution/agents?limit=100",
        )
        if (cancelled || ctrl.signal.aborted) return
        setProfiles(Array.isArray(agents?.profiles) ? agents.profiles : [])
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

  // Same data source and ordering as the Agents panel (avgScore desc rows).
  const roles = buildAgentRows(profiles, [])
  const maxRoleCursor = Math.max(0, roles.length - 1)
  const safeRoleCursor = Math.min(roleCursor, maxRoleCursor)
  const selectedRole = roles.length > 0 ? roles[safeRoleCursor]!.role : null

  const profile = role != null ? (profiles.find((p) => p?.role === role) ?? null) : null
  const view: MemoryPanelView | null = role != null ? memoryPanelView(profile ?? null) : null
  const flatEntries = view?.flatEntries ?? []
  const maxItemCursor = Math.max(0, flatEntries.length - 1)
  const safeItemCursor = Math.min(itemCursor, maxItemCursor)
  const selectedEntry = flatEntries.length > 0 ? flatEntries[safeItemCursor] : undefined

  const exportRoleMemory = useCallback(async () => {
    if (role == null) return
    const doc = buildMemoryExport(role, profile)
    const text = memoryExportJson(doc)
    try {
      const write = clipboard.write
      if (!write) throw new Error(t("tui.memory.exportUnavailable", "clipboard unavailable"))
      await write(text)
      toast.show({
        variant: "success",
        message: t(
          "tui.memory.exported",
          { role, bytes: text.length },
          `Memory JSON for ${role} copied to clipboard (${text.length} bytes)`,
        ),
        duration: 2500,
      })
    } catch (err) {
      toast.show({
        variant: "error",
        message: t(
          "tui.memory.exportFailed",
          { error: err instanceof Error ? err.message : String(err) },
          `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
        duration: 4000,
      })
    }
  }, [clipboard, profile, role, toast])

  useInput((input, key) => {
    if (input === "r") {
      nowRef.current = Date.now()
      refresh()
      return
    }
    if (role == null) {
      // Role picker view.
      if (key.upArrow || input === "k") {
        setRoleCursor((prev) => Math.max(0, Math.min(prev, maxRoleCursor) - 1))
        return
      }
      if (key.downArrow || input === "j") {
        setRoleCursor((prev) => Math.min(maxRoleCursor, Math.min(prev, maxRoleCursor) + 1))
        return
      }
      if (key.return && selectedRole != null) {
        setRole(selectedRole)
        setItemCursor(0)
        setExpandedKey(null)
      }
      return
    }
    // Role memory view.
    if (key.upArrow || input === "k") {
      setItemCursor((prev) => Math.max(0, Math.min(prev, maxItemCursor) - 1))
      return
    }
    if (key.downArrow || input === "j") {
      setItemCursor((prev) => Math.min(maxItemCursor, Math.min(prev, maxItemCursor) + 1))
      return
    }
    if (key.return && selectedEntry != null) {
      setExpandedKey((prev) => (prev === selectedEntry.key ? null : selectedEntry.key))
      return
    }
    if (input === "e") {
      void exportRoleMemory()
      return
    }
    if (input === "f") {
      // Cycle the efficacy-ledger bucket filter (all → skip-only → inject-only).
      setEfficacyFilter((prev) => cycleEfficacyFilter(prev))
      return
    }
    if (input === "b" || key.backspace || key.delete) {
      setRole(null)
      setItemCursor(0)
      setExpandedKey(null)
    }
  })

  const now = nowRef.current

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>
          {t("tui.memory", "Memory")}
          {role != null ? ` — ${role}` : roles.length > 0 ? ` (${roles.length})` : ""}
        </Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {isLoading && !loadedOnceRef.current ? (
          <Text color="gray">
            <Spinner type="dots" /> {t("tui.memory.loading", "Loading agent profiles…")}
          </Text>
        ) : error ? (
          <Text color="red">
            {t("tui.memory.error", { error }, `Failed to load agents: ${error}`)}
          </Text>
        ) : role == null ? (
          roles.length === 0 ? (
            <Text color="gray">
              {t("tui.memory.empty", "No agent profiles yet — run a task to evolve one.")}
            </Text>
          ) : (
            roles.map((row, index) => (
              <Box key={row.key} flexDirection="row">
                <Text> </Text>
                <Text color={index === safeRoleCursor ? "green" : undefined}>
                  {index === safeRoleCursor ? "❯" : " "}
                </Text>
                <Text color={row.color}>● </Text>
                <Text
                  color={index === safeRoleCursor ? "green" : undefined}
                  bold={index === safeRoleCursor}
                >
                  {row.role}
                </Text>
                <Text dimColor>
                  {" "}
                  · {t("tui.agents.tasks", { count: row.totalTasks }, `${row.totalTasks} tasks`)}
                  {row.avgScore != null ? ` · ${row.avgScore.toFixed(1)} ★` : ""}
                </Text>
              </Box>
            ))
          )
        ) : (
          <RoleMemoryView
            view={view}
            cursor={safeItemCursor}
            expandedKey={expandedKey}
            hasProfile={profile != null}
            filter={efficacyFilter}
          />
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {role == null
            ? t("tui.memory.hints.roles", "j/k move · Enter open · r refresh · esc close")
            : t(
                "tui.memory.hints.role",
                "j/k move · Enter expand · b roles · e export · f filter · r refresh · esc close",
              )}
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

function RoleMemoryView(props: {
  view: MemoryPanelView | null
  cursor: number
  expandedKey: string | null
  hasProfile: boolean
  filter: EfficacyFilter
}) {
  const { view, cursor, expandedKey, hasProfile, filter } = props
  if (view == null || !hasProfile) {
    return (
      <Text color="gray">{t("tui.memory.roleVanished", "Profile gone — press r to refresh.")}</Text>
    )
  }
  // Running flat index across all bucket entries — the cursor maps onto it.
  let flatIndex = -1
  return (
    <Box flexDirection="column">
      {view.buckets.map((bucket) => (
        <Box key={bucket.key} flexDirection="column">
          <Text bold color="cyan">
            {t(bucket.labelKey, bucket.key)} ({bucket.count})
          </Text>
          {bucket.count === 0 ? (
            <Text dimColor> {t("tui.memory.emptyBucket", "(empty)")}</Text>
          ) : (
            bucket.entries.map((entry) => {
              flatIndex += 1
              return (
                <EntryLine
                  key={entry.key}
                  entry={entry}
                  selected={flatIndex === cursor}
                  expanded={expandedKey === entry.key}
                />
              )
            })
          )}
        </Box>
      ))}
      <EfficacyLedger view={view} filter={filter} />
    </Box>
  )
}

function mimeColor(mime: string): string {
  if (mime === "application/json") return "cyan"
  if (mime === "text/digest") return "magenta"
  return "gray"
}

function EntryLine(props: { entry: MemoryEntryView; selected: boolean; expanded: boolean }) {
  const { entry, selected, expanded } = props
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text> </Text>
        <Text color={selected ? "green" : undefined}>{selected ? "❯" : " "}</Text>
        <Text> </Text>
        <Text color={mimeColor(entry.mime)}>[{entry.mime}]</Text>
        <Text color={selected ? "green" : undefined}> {entry.preview}</Text>
      </Box>
      {expanded ? (
        <Box flexDirection="column" paddingLeft={4}>
          {entry.content.length === 0 ? (
            <Text dimColor>{t("tui.memory.emptyContent", "(no content)")}</Text>
          ) : (
            entry.content.split("\n").map((line, i) => (
              <Text key={`${entry.key}:${i}`} color="green">
                {line}
              </Text>
            ))
          )}
        </Box>
      ) : null}
    </Box>
  )
}

function EfficacyLedger(props: { view: MemoryPanelView; filter: EfficacyFilter }) {
  const { view, filter } = props
  const total = view.efficacy.length
  if (total === 0) {
    return <Text dimColor> {t("tui.memory.noEfficacy", "no efficacy records yet")}</Text>
  }
  // Worst-first (mean ascending) with the f-key filter applied — the model
  // layer owns both so the panel just paints the rows it is handed.
  const rows = filterBuckets(sortEfficacy(view.efficacy), filter)
  const filterLabel = EFFICACY_FILTER_LABELS[filter] ?? EFFICACY_FILTER_LABELS.all!
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        {t("tui.memory.efficacy", "efficacy ledger")}
        <Text dimColor>
          {" "}
          ·{" "}
          {t(
            "tui.memory.efficacy.rule",
            { eps: MEMORY_GATING_EPS, samples: MEMORY_GATING_MIN_SAMPLES },
            `gate: skip when mean < -${MEMORY_GATING_EPS} over ≥ ${MEMORY_GATING_MIN_SAMPLES} samples`,
          )}
          {"  "}· f: {t(filterLabel.key, filterLabel.fallback)} ({rows.length}/{total})
        </Text>
      </Text>
      {rows.length === 0 ? (
        <Text dimColor>
          {" "}
          {t("tui.memory.efficacy.filter.empty", "no buckets match this filter")}
        </Text>
      ) : (
        rows.map((row) => (
          <Box key={row.bucket} flexDirection="row">
            <Text> </Text>
            <Text>{t(row.labelKey, row.bucket)}</Text>
            <Text dimColor>
              {" "}
              ·{" "}
              {t(
                "tui.memory.efficacy.injected",
                { count: row.injectedCount },
                `injected {count}`,
              )}{" "}
              · Δ {formatSigned(row.deltaSum)} · mean {formatSigned(row.mean)}
            </Text>
            {row.decision === "skip" ? (
              <Text color="red" bold>
                {" "}
                [{t("tui.memory.gating.skip", "gated")}]
              </Text>
            ) : row.evidence === "insufficient" ? (
              <Text dimColor> [{t("tui.memory.gating.unsampled", "inject · unsampled")}]</Text>
            ) : (
              <Text color="green"> [{t("tui.memory.gating.inject", "inject")}]</Text>
            )}
          </Box>
        ))
      )}
    </Box>
  )
}

export default MemoryPanel
