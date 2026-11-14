// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SubagentsPanel — live "what are my agents doing" rows (ZCode GUI
 * borrowing: the subagent session side panes; hermes delegate.tsx row
 * borrowing for the one-line activity ticker). One row per task derived
 * from the workspace event stream: goal, status glyph, elapsed timer and
 * a ONE-LINE reel of the run's activity — the growing line list is
 * clipped into a single-line window, new lines push old ones up (CSS
 * transform reel), and only the most recent TICKER_DEPTH lines mount.
 * Pure derivation — no fetching.
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useLocale, t, formatDuration } from "@max/i18n"
import { deriveAgentRuns, type AgentRunState } from "@/lib/agent-events"
import type { RuntimeEvent } from "@/api"
import { useSessionProjectionStore } from "@/stores/sessionProjectionStore"

const STATE_BADGE: Record<
  AgentRunState,
  { variant: "default" | "secondary" | "destructive" | "outline"; key: string; glyph: string }
> = {
  running: { variant: "default", key: "subagents.state.running", glyph: "⟳" },
  completed: { variant: "secondary", key: "subagents.state.completed", glyph: "✓" },
  failed: { variant: "destructive", key: "subagents.state.failed", glyph: "✗" },
  skipped: { variant: "outline", key: "subagents.state.skipped", glyph: "◌" },
}

/** Activity lines the reel keeps mounted (hermes TICKER_DEPTH borrowing). */
const TICKER_DEPTH = 6
/** Uniform reel line box (rem) — rows are clipped so the offset stays exact. */
const LINE_HEIGHT_REM = 1.25
/** Upper bound on retained activity lines per run (reel only needs the tail). */
const ACTIVITY_CAP = 200

// ── Per-run activity derivation (deriveTrajectory label conventions) ────────

export interface AgentActivityLine {
  /** Monotonic id — stable React keys across reel updates. */
  id: number
  /** One-line label, deriveTrajectory style ("tool · bash"). */
  label: string
  /** Outcome flag for tool lines (colors the ✓/✗ mark). */
  ok?: boolean
}

/** Defensive passthrough timestamp read (ms epoch). */
function eventTs(e: RuntimeEvent): number | undefined {
  const raw = (e as { ts?: unknown }).ts
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (typeof raw === "string" && raw !== "") {
    const n = Number(raw)
    if (Number.isFinite(n)) return n
    const parsed = Date.parse(raw)
    if (!Number.isNaN(parsed)) return parsed
  }
  return undefined
}

const asString = (v: unknown, max = 120): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined

/**
 * Activity lines for one task, chronological (deriveAgentRuns' per-run
 * event sequence materialized): tool calls with outcomes, permission
 * prompts, LLM retries, steering waves.
 */
export function deriveAgentActivity(events: RuntimeEvent[], taskId: string): AgentActivityLine[] {
  const out: AgentActivityLine[] = []
  let id = 0
  for (const e of events) {
    // steering-applied addresses tasks through `taskIds` (no taskId field).
    if (e.type === "steering-applied") {
      const ids = Array.isArray((e as { taskIds?: unknown }).taskIds)
        ? ((e as { taskIds?: unknown[] }).taskIds ?? [])
        : []
      if (!ids.includes(taskId)) continue
    } else if ((e as { taskId?: unknown }).taskId !== taskId) {
      continue
    }
    switch (e.type) {
      case "tool-start":
        out.push({ id: id++, label: `tool · ${asString(e.toolName) ?? "?"}` })
        break
      case "tool-end":
        out.push({
          id: id++,
          label: `tool · ${asString(e.toolName) ?? "?"}`,
          ok: typeof e.ok === "boolean" ? e.ok : undefined,
        })
        break
      case "permission-request":
        out.push({ id: id++, label: `permission · ${asString(e.tool) ?? "?"}` })
        break
      case "llm-retry-status":
        out.push({
          id: id++,
          label: `retry · ${asString(e.phase) ?? "waiting"} (attempt ${String(e.attempt ?? "?")})`,
          ok: asString(e.phase) !== "exhausted",
        })
        break
      case "steering-applied":
        out.push({ id: id++, label: "steering-applied" })
        break
      default:
        break
    }
    if (out.length >= ACTIVITY_CAP) break
  }
  return out
}

/** Wall-clock duration between two optional event timestamps. */
function spanMs(start?: number, end?: number): number | undefined {
  if (start === undefined) return undefined
  const finish = end ?? Date.now()
  return Math.max(0, finish - start)
}

// ── One-line activity reel (hermes ToolRunTicker borrowing) ─────────────────

/**
 * A one-line window over a growing list of rows: each new line slides the
 * one before it up and out, so a run's activity reads as a single line
 * ticking over in place. Only the most recent TICKER_DEPTH lines mount.
 */
export function ActivityTicker({ lines }: { lines: AgentActivityLine[] }) {
  const visible = useMemo(() => lines.slice(-TICKER_DEPTH), [lines])
  if (visible.length === 0) return null
  return (
    <div
      className="overflow-hidden"
      style={{ height: `${LINE_HEIGHT_REM}rem` }}
      data-testid="agent-activity-ticker"
    >
      <div
        className="transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={
          {
            transform: `translateY(calc(var(--ticker-index, 0) * ${LINE_HEIGHT_REM}rem * -1))`,
            "--ticker-index": visible.length - 1,
          } as CSSProperties
        }
      >
        {visible.map((line, index) => (
          <div
            key={line.id}
            className="flex items-center gap-1 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground"
            style={{ height: `${LINE_HEIGHT_REM}rem` }}
            data-testid="agent-activity-line"
            data-line-index={index}
          >
            <span
              aria-hidden="true"
              className={line.ok === false ? "text-destructive" : "text-muted-foreground/70"}
            >
              {line.ok === false ? "✗" : "·"}
            </span>
            <span className="truncate">{line.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 1s re-render tick while any run is live (elapsed timers) ────────────────

function useElapsedTick(active: boolean): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [active])
}

// ── Panel ───────────────────────────────────────────────────────────────────

export function SubagentsPanel({ events: eventsProp }: { events?: RuntimeEvent[] }) {
  useLocale()
  // Session projection store (App injects the workspace event stream via
  // setEvents); an explicit prop still wins so callers can render in isolation.
  const storeEvents = useSessionProjectionStore((s) => s.events)
  const events = eventsProp ?? storeEvents
  const runs = useMemo(() => [...deriveAgentRuns(events).values()], [events])
  // Running first, then failures, then the rest — newest task ids first
  // within a group (Map preserves insertion order = stream order).
  const ordered = useMemo(
    () =>
      [...runs].sort((a, b) => {
        const rank = (s: AgentRunState) => (s === "running" ? 0 : s === "failed" ? 1 : 2)
        return rank(a.state) - rank(b.state)
      }),
    [runs],
  )
  useElapsedTick(ordered.some((r) => r.state === "running"))

  // Per-run activity lines + wall-clock spans, keyed by task id. The span
  // rides the events' passthrough `ts` field; missing timestamps omit the
  // timer instead of fabricating one.
  const activity = useMemo(() => {
    const lines = new Map<string, AgentActivityLine[]>()
    const spans = new Map<string, { start?: number; end?: number }>()
    const taskIds = new Set(runs.map((r) => r.taskId))
    for (const run of runs) lines.set(run.taskId, deriveAgentActivity(events, run.taskId))
    for (const e of events) {
      const taskId = asString(e.taskId, 200)
      if (taskId === undefined || !taskIds.has(taskId)) continue
      const ts = eventTs(e)
      if (ts === undefined) continue
      const span = spans.get(taskId) ?? {}
      span.start ??= ts
      span.end = ts
      spans.set(taskId, span)
    }
    return { lines, spans }
  }, [runs, events])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t("subagents.title")}
          <span className="ml-2 text-xs text-muted-foreground">
            {runs.filter((r) => r.state === "running").length} {t("subagents.runningCount")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("subagents.empty")}</p>
        ) : (
          <ul className="space-y-2" data-testid="subagents-list">
            {ordered.map((run) => {
              const meta = STATE_BADGE[run.state]
              const lines = activity.lines.get(run.taskId) ?? []
              const { start, end } = activity.spans.get(run.taskId) ?? {}
              const durationMs =
                run.state === "running" ? spanMs(start) : spanMs(start, end ?? undefined)
              return (
                <li key={run.taskId} className="rounded-md border p-2">
                  {/* Goal line: status glyph + goal + elapsed timer — the two
                      things that identify what the child is doing (hermes
                      DelegateRowView borrowing). The glyph rides the goal
                      row, NEVER the reel wrapper: opacity on the wrapper
                      would open a stacking context and let old reel lines
                      paint through the window. */}
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={
                        run.state === "failed"
                          ? "font-mono text-xs text-destructive"
                          : run.state === "running"
                            ? "font-mono text-xs text-primary"
                            : "font-mono text-xs text-muted-foreground"
                      }
                      data-testid="agent-state-glyph"
                    >
                      {meta.glyph}
                    </span>
                    <span className="min-w-0 truncate font-mono text-xs font-medium">
                      {run.agentRole} · {run.taskId}
                    </span>
                    <Badge variant={meta.variant} className="h-4 px-1 text-[10px]">
                      {t(meta.key)}
                    </Badge>
                    {run.permissionPending && (
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        {t("subagents.permissionPending")}
                      </Badge>
                    )}
                    {run.steeringCount > 0 && (
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        ⇄ {run.steeringCount}
                      </Badge>
                    )}
                    {/* Elapsed timer: ticks while running (the 1s panel
                        tick re-renders), freezes at the wall-clock span
                        once the run ends. Omitted without timestamps. */}
                    {durationMs !== undefined && (
                      <span
                        className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground"
                        data-testid="agent-elapsed"
                      >
                        {formatDuration(durationMs)}
                      </span>
                    )}
                  </div>
                  <ActivityTicker lines={lines} />
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
