// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TurnGroup — one conversation turn: header (role badge + status +
 * result stats + duration + turn-phase affordances) over its compiled
 * render units. Tool units render through the shared ToolCallBlock
 * registry — the single rendering path for any tool call on this
 * surface. The turn's depth drives the left indent (subagent turns nest
 * under their open parent).
 *
 * Live status: a RUNNING turn's header duration ticks every 5s
 * (LiveTurnDuration) and its running tools carry a spinning Loader2
 * with per-second elapsed counters (RunningToolBadge); steering text
 * units flash once on entry (2s fade); a FAILED turn's failing tool
 * calls default to the expanded error view (turnDefaultExpanded per
 * status) so the error detail needs no click.
 *
 * Render economy (OpenHands messages.tsx borrowing): the component is
 * memoized with a CONTENT comparator (sameTurnRender — the compile
 * re-issues every unit object per frame, so reference equality would
 * never hold) and only stable derived inputs, so a streaming append to
 * the LAST turn re-renders that turn alone and every historical turn
 * skips. Retry-wave expansion lives in the host's list-level registry
 * (expandedRetries/onToggleRetry) so a forced remount keeps the
 * reader's expansion.
 *
 * Turn phase (opencode turn-phase-machine borrowing): the header
 * derives the phase (turnPhaseOfTurn) and its affordances
 * (viewTurnPhase) — a retrying phase renders its attempt/next chip and
 * a live phase carries data-copy-locked for copy affordances.
 *
 * ai-elements density: a completed task's result surfaces in the header
 * — TokenUsageBadge for `result.metadata.usage` and a LatencyMeter
 * rating bar for the task-complete `durationMs` (both via
 * turnResultStats; nothing renders when the payload lacks them) — and
 * task-status / workspace failures render through the shared ErrorBlock
 * (name + message, embedded stacks folded) instead of raw text rows.
 */

import { memo, useState, type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { Badge } from "@/components/ui/badge"
import { ErrorBlock, LatencyMeter, TokenUsageBadge } from "@/components/ai-elements"
import { ToolCallBlock } from "@/components/tool-renderers/registry"
import type { ConversationUnit, FindHit, TurnModel } from "./model"
import {
  elapsedSeconds,
  errorDetailOf,
  formatDuration,
  sameTurnRender,
  turnDefaultExpanded,
  turnResultStats,
} from "./model"
import { turnPhaseOfTurn, viewTurnPhase } from "./turn-phase"
import { RetryWaveGroup } from "./RetryWaveGroup"
import { TextUnitBlock } from "./TextUnitBlock"
import { RUNNING_TOOL_TICK_MS, TURN_ELAPSED_TICK_MS, useNow } from "./useNow"

const ROLE_COLOR: Record<string, string> = {
  user: "bg-blue-500",
  assistant: "bg-slate-500",
  general: "bg-slate-500",
  backend: "bg-emerald-600",
  frontend: "bg-sky-600",
  review: "bg-violet-600",
  system: "bg-muted-foreground",
}

function roleLabel(role: string): string {
  if (role === "user") return t("conversation.role.user")
  if (role === "assistant") return t("conversation.role.assistant")
  if (role === "system") return t("conversation.role.system")
  // Known agent roles localize too; a passthrough role id with no key
  // falls back to its raw string (defensive — agentRole is untyped).
  if (role === "backend") return t("conversation.role.backend")
  if (role === "frontend") return t("conversation.role.frontend")
  if (role === "general") return t("conversation.role.general")
  if (role === "review") return t("conversation.role.review")
  return role
}

function StatusBadge({ status }: { status: TurnModel["status"] }) {
  if (status === "completed") {
    return (
      <Badge variant="secondary" className="h-4 px-1 text-[10px]" data-testid="turn-status">
        ✓ {t("conversation.status.completed")}
      </Badge>
    )
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="h-4 px-1 text-[10px]" data-testid="turn-status">
        ✗ {t("conversation.status.failed")}
      </Badge>
    )
  }
  if (status === "skipped") {
    return (
      <Badge variant="outline" className="h-4 px-1 text-[10px]" data-testid="turn-status">
        {t("conversation.status.skipped")}
      </Badge>
    )
  }
  return (
    <Badge variant="default" className="h-4 px-1 text-[10px]" data-testid="turn-status">
      {t("conversation.status.running")}
    </Badge>
  )
}

/**
 * RunningToolBadge — the live feedback for a tool-start without its
 * paired end: a spinning Loader2 plus the elapsed seconds, re-rendered
 * once a second by useNow's interval (cleared on unmount). The clock
 * starts at the tool-start event's ts; a stream without ts falls back
 * to the badge's own mount time (the unit's first-seen moment).
 */
function RunningToolBadge({ startedAt }: { startedAt?: number }) {
  useLocale()
  const [firstSeen] = useState(() => Date.now())
  const now = useNow(RUNNING_TOOL_TICK_MS)
  const seconds = elapsedSeconds(startedAt ?? firstSeen, now)
  return (
    <Badge
      variant="default"
      className="h-4 shrink-0 gap-1 px-1 text-[10px]"
      data-testid="tool-running"
    >
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden data-testid="tool-running-spinner" />
      {t("conversation.tool.running")}
      <span data-testid="tool-running-elapsed" data-seconds={seconds}>
        {t("conversation.tool.elapsed", { seconds })}
      </span>
    </Badge>
  )
}

/**
 * LiveTurnDuration — a RUNNING task turn's header duration: elapsed
 * since the turn's first timestamp (or its first-seen moment), refreshed
 * every 5s while the turn keeps running. It supersedes the frozen
 * start→last-event span, which says nothing about how long an
 * in-flight turn has actually been going.
 */
function LiveTurnDuration({ startedAt }: { startedAt?: number }) {
  useLocale()
  const [firstSeen] = useState(() => Date.now())
  const now = useNow(TURN_ELAPSED_TICK_MS)
  const elapsed = Math.max(0, now - (startedAt ?? firstSeen))
  return (
    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground" data-testid="turn-elapsed">
      {t("conversation.turn.elapsed", { duration: formatDuration(elapsed) })}
    </span>
  )
}

function PermissionLine({ unit }: { unit: Extract<ConversationUnit, { kind: "permission" }> }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-xs"
      data-testid="permission-unit"
      data-permission-state={unit.state}
    >
      <span className="w-4 shrink-0 text-center font-mono text-muted-foreground">⚿</span>
      <span className="font-mono font-medium">{unit.tool}</span>
      {unit.target !== undefined && (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{unit.target}</span>
      )}
      {unit.state === "pending" && (
        <Badge variant="default" className="h-4 px-1 text-[10px]">
          {t("conversation.permission.pending")}
        </Badge>
      )}
      {unit.state === "allowed" && (
        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
          ✓ {t("conversation.permission.allowed")}
        </Badge>
      )}
      {unit.state === "denied" && (
        <Badge variant="destructive" className="h-4 px-1 text-[10px]">
          ✗ {t("conversation.permission.denied")}
        </Badge>
      )}
    </div>
  )
}

/**
 * Render `text` with the find hits' occurrence ranges wrapped in
 * <mark> — the interval semantics come straight from
 * buildConversationFindIndex (start/end per field). When `current` the
 * unit hosts the find cursor's CURRENT match: its marks render amber so
 * they stand out against the other matches' default mark backdrop.
 */
function HighlightedText({
  text,
  hits,
  current = false,
}: {
  text: string
  hits: FindHit[] | undefined
  current?: boolean
}) {
  if (!hits || hits.length === 0) return <>{text}</>
  const nodes: ReactNode[] = []
  let cursor = 0
  hits.forEach((hit, i) => {
    if (hit.start > cursor) nodes.push(text.slice(cursor, hit.start))
    nodes.push(
      current ? (
        <mark
          key={i}
          className="rounded-sm bg-amber-300 text-foreground"
          data-testid="mark-current"
        >
          {text.slice(hit.start, hit.end)}
        </mark>
      ) : (
        <mark key={i}>{text.slice(hit.start, hit.end)}</mark>
      ),
    )
    cursor = hit.end
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <>{nodes}</>
}

function TurnUnitView({
  unit,
  textHighlights,
  currentUnitKey,
  defaultExpanded = false,
  freshSteeringKeys,
  settled = true,
  retryOpen,
  onToggleRetry,
}: {
  unit: ConversationUnit
  textHighlights?: Map<string, FindHit[]>
  currentUnitKey?: string
  /**
   * The turn's defaultExpanded (turnDefaultExpanded per status): inside
   * a FAILED turn the tool blocks default to the registry's expanded
   * view so the error detail surfaces without a click.
   */
  defaultExpanded?: boolean
  /** Steering flash-once verdict (see TurnGroup's prop of the same name). */
  freshSteeringKeys?: ReadonlySet<string>
  /** Streaming verdict for markdown bodies (last unit of a running turn streams). */
  settled?: boolean
  /** Host registry state for a retry wave's expansion (see RetryWaveGroup). */
  retryOpen?: boolean
  /** Host toggle sink for a retry wave's expansion. */
  onToggleRetry?: (key: string, open: boolean) => void
}) {
  switch (unit.kind) {
    case "task":
      // Turn-opening marker — the TurnGroup header above IS its render.
      return null
    case "text":
      // Steering / system segments (textUnits provenance stamped by
      // withTextUnitEvents) render through TextUnitBlock — per-source
      // styling (purple for steering) with the find highlights kept
      // working inside the block. Steering additionally flashes once —
      // on its FIRST render only (the flash-once registry's fresh set;
      // replays and remounts mount with the overlay retired). Bodies
      // render markdown (streaming until the turn settles — the LAST
      // unit of a RUNNING turn is still being produced); the
      // find-highlight override keeps the plain-text body instead.
      if (unit.source !== undefined) {
        return (
          <TextUnitBlock
            unit={{ source: unit.source, text: unit.text, taskId: unit.taskId }}
            flash={unit.source === "steering"}
            fresh={freshSteeringKeys?.has(unit.key) ?? true}
            settled={settled}
          >
            <HighlightedText
              text={unit.text}
              hits={textHighlights?.get(unit.key)}
              current={unit.key === currentUnitKey}
            />
          </TextUnitBlock>
        )
      }
      return (
        <p
          className={`whitespace-pre-wrap text-sm ${unit.role === "user" ? "text-foreground" : "text-foreground/90"}`}
          data-testid="turn-text"
        >
          <HighlightedText
            text={unit.text}
            hits={textHighlights?.get(unit.key)}
            current={unit.key === currentUnitKey}
          />
        </p>
      )
    case "tool":
      // Single rendering path: the per-tool registry owns the call UI.
      // A running call adds the live spinner + elapsed badge beside it;
      // a failing call inside a FAILED turn defaults to the expanded
      // (ErrorBlock) view instead of the truncated one-line error row.
      return (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ToolCallBlock
              tool={unit.tool}
              input={unit.input}
              ok={unit.ok}
              durationMs={unit.durationMs}
              error={unit.error}
              defaultOpen={defaultExpanded && unit.ok === false}
            />
          </div>
          {unit.state === "running" && <RunningToolBadge startedAt={unit.at} />}
        </div>
      )
    case "retry":
      return <RetryWaveGroup unit={unit} open={retryOpen} onToggle={onToggleRetry} />
    case "permission":
      return <PermissionLine unit={unit} />
    case "task-status":
      // Error detail through the shared ErrorBlock (name + message,
      // embedded stacks folded behind a <details>) — the wrapper keeps
      // the unit's testid hook for the pipeline tests.
      return unit.error !== undefined ? (
        <div data-testid="turn-task-error">
          <ErrorBlock error={errorDetailOf(unit.error)} />
        </div>
      ) : null
    case "review":
      return (
        <p className="text-sm text-foreground" data-testid="turn-review">
          {t("conversation.review.score", { score: String(unit.score ?? "—") })}
          {unit.summary !== undefined && (
            <span className="text-muted-foreground"> — {unit.summary}</span>
          )}
        </p>
      )
    case "failed":
      // Same ErrorBlock path as task-status failures — the workspace-level
      // verdict renders with the name/message/stack treatment too.
      return (
        <div data-testid="turn-failed">
          <ErrorBlock error={errorDetailOf(unit.error)} />
        </div>
      )
  }
}

export interface TurnGroupProps {
  turn: TurnModel
  /** Find-active marker — amber border on turns that contain a match. */
  highlighted?: boolean
  /** Unit key → matched ranges inside the unit's text (find highlight). */
  textHighlights?: Map<string, FindHit[]>
  /** Unit key of the find cursor's CURRENT match — a tier above the
   *  plain amber "contains a match" border, and the unit's marks render
   *  amber instead of the default mark backdrop. */
  currentUnitKey?: string
  /**
   * Steering flash-once verdict: unit keys of steering segments on their
   * FIRST-ever render (the conversation model's markFirstSeen fresh set,
   * kept by the timeline). Units absent from the set mount with the
   * flash overlay retired — a replayed stream or a remounted block never
   * re-flashes. undefined = every steering unit counts as fresh (direct
   * usages and tests keep the mount flash).
   */
  freshSteeringKeys?: ReadonlySet<string>
  /**
   * Retry-wave expansion registry (OpenHands list-level borrowing): the
   * host keeps open-state per retry unit key so a forced remount
   * (virtual band unmount, find filter) restores the expansion.
   */
  expandedRetries?: ReadonlySet<string>
  /** Toggle sink for the registry above. */
  onToggleRetry?: (key: string, open: boolean) => void
}

/**
 * Memo comparator over CONTENT, not references: the compile re-issues
 * every TurnModel/unit object per frame, so the OpenHands-style "only
 * stable keys" rule runs through sameTurnRender (header fields +
 * per-unit content). Everything else the render reads arrives as
 * identity-stable props from the timeline (memoized derived maps, the
 * EMPTY steering set, a useState-backed retry registry).
 */
/**
 * Exported for the render-stability test suite (it must spy THROUGH the
 * real comparator, not a re-implementation).
 */
export function turnGroupPropsEqual(prev: TurnGroupProps, next: TurnGroupProps): boolean {
  return (
    prev.highlighted === next.highlighted &&
    prev.currentUnitKey === next.currentUnitKey &&
    prev.textHighlights === next.textHighlights &&
    prev.freshSteeringKeys === next.freshSteeringKeys &&
    prev.expandedRetries === next.expandedRetries &&
    prev.onToggleRetry === next.onToggleRetry &&
    sameTurnRender(prev.turn, next.turn)
  )
}

export const TurnGroup = memo(function TurnGroup({
  turn,
  highlighted = false,
  textHighlights,
  currentUnitKey,
  freshSteeringKeys,
  expandedRetries,
  onToggleRetry,
}: TurnGroupProps) {
  useLocale()
  const hostsCurrentMatch =
    currentUnitKey !== undefined && turn.units.some((unit) => unit.key === currentUnitKey)
  // Failed turns surface their error detail without a click — the tool
  // blocks inside default to the expanded (ErrorBlock) view.
  const defaultExpanded = turnDefaultExpanded(turn.status)
  // The turn's completed-task result: usage for the token badge and the
  // latency the meter rates — both absent for running/failed turns.
  const result = turnResultStats(turn)
  // Turn phase (opencode borrowing): the header's affordances derive
  // from the machine, not from ad-hoc status checks.
  const phase = turnPhaseOfTurn(turn)
  const phaseView = viewTurnPhase(phase)
  // The turn's last unit is the one still streaming when the turn runs —
  // every earlier body is settled markdown.
  const streamingUnitKey =
    turn.status === "running" && turn.units.length > 0
      ? turn.units[turn.units.length - 1]?.key
      : undefined
  return (
    <section
      className={`rounded-lg border bg-card/60 p-3 ${
        hostsCurrentMatch
          ? "border-amber-500"
          : highlighted
            ? "border-amber-500/60"
            : "border-border"
      }`}
      style={{ marginLeft: (turn.depth - 1) * 16 }}
      data-testid="turn-group"
      data-turn-id={turn.turnId}
      data-turn-depth={turn.depth}
      data-current-turn={hostsCurrentMatch ? "true" : undefined}
      data-phase={phase.status}
      data-copy-locked={phaseView.hideCopy ? "true" : undefined}
    >
      <header className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${ROLE_COLOR[turn.role] ?? "bg-slate-500"}`}
        />
        <span className="text-xs font-medium">{roleLabel(turn.role)}</span>
        {turn.taskId !== undefined && (
          <span className="truncate font-mono text-xs text-muted-foreground">{turn.taskId}</span>
        )}
        {/* Lifecycle badges only exist for task turns — message turns
            (user request, narration, review) have no running state. */}
        {turn.turnId.startsWith("task-") && <StatusBadge status={turn.status} />}
        {/* Turn-phase affordance (opencode borrowing): a RETRYING phase
            shows its attempt → next chip; live phases lock Copy (the
            data attribute), settled phases keep their last text. */}
        {phaseView.retry !== undefined && (
          <Badge
            variant="outline"
            className="h-4 shrink-0 px-1 text-[10px] text-amber-600"
            data-testid="turn-phase-retry"
          >
            {t("conversation.phase.retrying", {
              attempt: String(phaseView.retry.attempt),
              next: String(phaseView.retry.next),
            })}
          </Badge>
        )}
        {/* Result stats (ai-elements density): token usage + rated
            latency of the completed task, straight from the task-complete
            payload; absent payloads render nothing. */}
        {result.usage !== undefined && (
          <span data-testid="turn-usage">
            <TokenUsageBadge usage={result.usage} />
          </span>
        )}
        {result.durationMs !== undefined && (
          <span data-testid="turn-latency">
            <LatencyMeter ms={result.durationMs} />
          </span>
        )}
        {/* A RUNNING task turn's duration is LIVE (refreshed every 5s);
            a finished one keeps the frozen start→end span. */}
        {turn.turnId.startsWith("task-") && turn.status === "running" ? (
          <LiveTurnDuration startedAt={turn.startedAt} />
        ) : (
          turn.durationMs !== undefined && (
            <span
              className="ml-auto shrink-0 text-[10px] text-muted-foreground"
              data-testid="turn-duration"
            >
              {t("conversation.turn.duration", { duration: formatDuration(turn.durationMs) })}
            </span>
          )
        )}
      </header>
      {turn.units.length > 0 && (
        <div className="mt-2 space-y-1">
          {turn.units.map((unit) => (
            <TurnUnitView
              key={unit.key}
              unit={unit}
              textHighlights={textHighlights}
              currentUnitKey={currentUnitKey}
              defaultExpanded={defaultExpanded}
              freshSteeringKeys={freshSteeringKeys}
              settled={unit.key !== streamingUnitKey}
              retryOpen={expandedRetries?.has(unit.key)}
              onToggleRetry={onToggleRetry}
            />
          ))}
        </div>
      )}
    </section>
  )
}, turnGroupPropsEqual)

TurnGroup.displayName = "TurnGroup"
