// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TurnGroup — one conversation turn: header (role badge + status +
 * duration) over its compiled render units. Tool units render through
 * the shared ToolCallBlock registry — the single rendering path for any
 * tool call on this surface. The turn's depth drives the left indent
 * (subagent turns nest under their open parent).
 */

import type { ReactNode } from "react"
import { useLocale, t } from "@max/i18n"
import { Badge } from "@/components/ui/badge"
import { ToolCallBlock } from "@/components/tool-renderers/registry"
import type { ConversationUnit, FindHit, TurnModel } from "./model"
import { formatDuration } from "./model"
import { RetryWaveGroup } from "./RetryWaveGroup"

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
 * buildConversationFindIndex (start/end per field).
 */
function HighlightedText({ text, hits }: { text: string; hits: FindHit[] | undefined }) {
  if (!hits || hits.length === 0) return <>{text}</>
  const nodes: ReactNode[] = []
  let cursor = 0
  hits.forEach((hit, i) => {
    if (hit.start > cursor) nodes.push(text.slice(cursor, hit.start))
    nodes.push(<mark key={i}>{text.slice(hit.start, hit.end)}</mark>)
    cursor = hit.end
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <>{nodes}</>
}

function TurnUnitView({
  unit,
  textHighlights,
}: {
  unit: ConversationUnit
  textHighlights?: Map<string, FindHit[]>
}) {
  switch (unit.kind) {
    case "task":
      // Turn-opening marker — the TurnGroup header above IS its render.
      return null
    case "text":
      return (
        <p
          className={`whitespace-pre-wrap text-sm ${unit.role === "user" ? "text-foreground" : "text-foreground/90"}`}
          data-testid="turn-text"
        >
          <HighlightedText text={unit.text} hits={textHighlights?.get(unit.key)} />
        </p>
      )
    case "tool":
      // Single rendering path: the per-tool registry owns the call UI;
      // a running call just adds the live badge beside it.
      return (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ToolCallBlock
              tool={unit.tool}
              input={unit.input}
              ok={unit.ok}
              durationMs={unit.durationMs}
              error={unit.error}
            />
          </div>
          {unit.state === "running" && (
            <Badge
              variant="default"
              className="h-4 shrink-0 px-1 text-[10px]"
              data-testid="tool-running"
            >
              {t("conversation.tool.running")}
            </Badge>
          )}
        </div>
      )
    case "retry":
      return <RetryWaveGroup unit={unit} />
    case "permission":
      return <PermissionLine unit={unit} />
    case "task-status":
      return unit.error !== undefined ? (
        <p className="break-all font-mono text-xs text-destructive" data-testid="turn-task-error">
          {unit.error}
        </p>
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
      return (
        <p className="break-all font-mono text-xs text-destructive" data-testid="turn-failed">
          {unit.error}
        </p>
      )
  }
}

export function TurnGroup({
  turn,
  highlighted = false,
  textHighlights,
}: {
  turn: TurnModel
  /** Find-active marker — amber border on turns that contain a match. */
  highlighted?: boolean
  /** Unit key → matched ranges inside the unit's text (find highlight). */
  textHighlights?: Map<string, FindHit[]>
}) {
  useLocale()
  return (
    <section
      className={`rounded-lg border bg-card/60 p-3 ${highlighted ? "border-amber-500/60" : "border-border"}`}
      style={{ marginLeft: (turn.depth - 1) * 16 }}
      data-testid="turn-group"
      data-turn-id={turn.turnId}
      data-turn-depth={turn.depth}
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
        {turn.durationMs !== undefined && (
          <span
            className="ml-auto shrink-0 text-[10px] text-muted-foreground"
            data-testid="turn-duration"
          >
            {t("conversation.turn.duration", { duration: formatDuration(turn.durationMs) })}
          </span>
        )}
      </header>
      {turn.units.length > 0 && (
        <div className="mt-2 space-y-1">
          {turn.units.map((unit) => (
            <TurnUnitView key={unit.key} unit={unit} textHighlights={textHighlights} />
          ))}
        </div>
      )}
    </section>
  )
}
