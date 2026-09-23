// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ConversationTimeline — the workspace conversation as a virtualized,
 * turn-grouped timeline (ZCode v4 ConversationTimeline borrowing). Built
 * from the SAME runtime event stream as every other live surface, plus
 * the workspace's plan/review objects:
 *
 *   turn = user request → planning → per-task groups (tool calls inline
 *   via ToolCallBlock) → completion/failure → review verdict.
 *
 * Timeline discipline: newest at the bottom, auto-tail (sticks to the
 * bottom while the run is live unless the user scrolled up), and a
 * jump-to-latest affordance when detached.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import {
  filterByQuery,
  matchIndices,
  windowItems,
  turnAnchors,
  adjacentAnchor,
  toShareMarkdown,
} from "@/lib/timeline-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import type { RuntimeEvent, Workspace } from "@/api"
import { ToolCallBlock } from "@/components/tool-renderers/registry"

export interface TimelineItem {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  kind: "user" | "plan" | "task" | "review" | "failed"
  /** Stable key for React. */
  key: string
  taskId?: string
  agentRole?: string
  title: string
  /** Tool calls belonging to this group, in stream order. */
  toolCalls?: Array<{
    tool: string
    input: unknown
    ok?: boolean
    durationMs?: number
    error?: string
  }>
  status?: "running" | "completed" | "failed" | "skipped"
  score?: number
  error?: string
}

/**
 * Model layer: project events + workspace into grouped timeline items.
 * Pure — unit-tested in isolation.
 */
export function buildTimelineItems(
  events: RuntimeEvent[],
  workspace: Workspace | null,
): TimelineItem[] {
  const items: TimelineItem[] = []
  const byTask = new Map<string, TimelineItem>()

  if (workspace?.userRequest) {
    items.push({ kind: "user", key: "user", title: workspace.userRequest })
  }

  for (const e of events) {
    switch (e.type) {
      case "task-start": {
        const item: TimelineItem = {
          kind: "task",
          key: `task-${String(e.taskId)}`,
          taskId: String(e.taskId),
          agentRole: typeof e.agentRole === "string" ? e.agentRole : undefined,
          title: String(e.taskId),
          toolCalls: [],
          status: "running",
        }
        byTask.set(String(e.taskId), item)
        items.push(item)
        break
      }
      case "tool-start": {
        const item = byTask.get(String(e.taskId))
        if (item) {
          item.toolCalls = item.toolCalls ?? []
          item.toolCalls.push({ tool: String(e.toolName ?? "?"), input: e.input })
        }
        break
      }
      case "tool-end": {
        const item = byTask.get(String(e.taskId))
        if (item?.toolCalls) {
          const last = [...item.toolCalls]
            .reverse()
            .find((c) => c.tool === String(e.toolName ?? "?") && c.ok === undefined)
          if (last) {
            last.ok = typeof e.ok === "boolean" ? e.ok : undefined
            last.durationMs = typeof e.durationMs === "number" ? e.durationMs : undefined
            last.error = typeof e.error === "string" ? e.error : undefined
          }
        }
        break
      }
      case "task-complete":
      case "task-failed":
      case "task-skipped": {
        // Events may arrive without a prior task-start (stream join
        // mid-run) — create the group instead of dropping the outcome.
        const id = String(e.taskId)
        const item = byTask.get(id) ?? {
          kind: "task" as const,
          key: `task-${id}`,
          taskId: id,
          agentRole: typeof e.agentRole === "string" ? e.agentRole : undefined,
          title: id,
          toolCalls: [],
        }
        byTask.set(id, item)
        if (!items.includes(item)) items.push(item)
        if (e.type === "task-complete") item.status = "completed"
        if (e.type === "task-failed") {
          item.status = "failed"
          item.error = typeof e.error === "string" ? e.error : undefined
        }
        if (e.type === "task-skipped") {
          item.status = "skipped"
          item.error = typeof e.reason === "string" ? e.reason : undefined
        }
        break
      }
      default:
        break
    }
  }

  if (workspace?.status === "failed" && workspace?.error) {
    items.push({ kind: "failed", key: "failed", title: workspace.error, error: workspace.error })
  }
  if (workspace?.review && typeof workspace.review.score === "number") {
    items.push({
      kind: "review",
      key: "review",
      title: "review",
      score: workspace.review.score,
    })
  }
  return items
}

const ROLE_COLOR: Record<string, string> = {
  general: "bg-slate-500",
  backend: "bg-emerald-600",
  frontend: "bg-sky-600",
  review: "bg-violet-600",
}

export function ConversationTimeline({
  events,
  workspace,
  live,
}: {
  events: RuntimeEvent[]
  workspace: Workspace | null
  /** true while a run is in flight — enables auto-tail. */
  live: boolean
}) {
  useLocale()
  const items = useMemo(() => buildTimelineItems(events, workspace), [events, workspace])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [detached, setDetached] = useState(false)
  const [query, setQuery] = useState("")
  const [visibleCount, setVisibleCount] = useState(50)
  const [cursor, setCursor] = useState(-1)
  const [showFind, setShowFind] = useState(false)
  const [copied, setCopied] = useState(false)

  const matches = useMemo(() => matchIndices(items, query), [items, query])
  const filtered = useMemo(
    () => (query.trim() ? filterByQuery(items, query) : items),
    [items, query],
  )
  const anchors = useMemo(() => turnAnchors(filtered), [filtered])
  const { window: rendered, hiddenAbove } = useMemo(
    () => windowItems(filtered, visibleCount),
    [filtered, visibleCount],
  )

  const jumpTo = (index: number) => {
    const el = scrollRef.current?.querySelector(`[data-timeline-index="${index}"]`)
    el?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const navigateTurn = (direction: 1 | -1) => {
    const next = adjacentAnchor(anchors, cursor, direction)
    setCursor(next)
    jumpTo(next)
  }

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(
        toShareMarkdown(items, workspace?.userRequest?.slice(0, 60)),
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  // Auto-tail: stick to the bottom while live, unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !live || detached) return
    el.scrollTop = el.scrollHeight
  }, [items.length, live, detached])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setDetached(!atBottom)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setShowFind(!showFind)}
          aria-expanded={showFind}
        >
          ⌕ {t("timeline.find")}
        </Button>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => navigateTurn(-1)}
            aria-label={t("timeline.prevTurn")}
          >
            ↑ {t("timeline.prevTurn")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => navigateTurn(1)}
            aria-label={t("timeline.nextTurn")}
          >
            ↓ {t("timeline.nextTurn")}
          </Button>
        </div>
        <div className="ml-auto">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={copyShare}>
            {copied ? `✓ ${t("timeline.copied")}` : t("timeline.share")}
          </Button>
        </div>
      </div>
      {showFind && (
        <div className="mb-2">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(-1)
            }}
            placeholder={t("timeline.findPlaceholder")}
            aria-label={t("timeline.find")}
            className="h-8 text-xs"
            data-testid="timeline-find"
          />
          {query.trim() && (
            <p className="mt-1 text-xs text-muted-foreground">
              {matches.length} {t("timeline.matchCount")}
            </p>
          )}
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
        data-testid="conversation-timeline"
      >
        {hiddenAbove > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full text-xs"
            onClick={() => setVisibleCount((v) => v + 50)}
            data-testid="load-earlier"
          >
            ↑ {t("timeline.loadEarlier", { count: String(hiddenAbove) })}
          </Button>
        )}
        {rendered.map((item, renderIndex) => (
          <div
            key={item.key}
            data-timeline-index={
              visibleCount < filtered.length ? hiddenAbove + renderIndex : renderIndex
            }
            className={`rounded-lg border bg-card/60 p-3 ${
              query.trim() ? "border-amber-500/60" : "border-border"
            }`}
          >
            <div className="flex items-center gap-2">
              {item.kind === "user" && (
                <Badge variant="outline" className="border-blue-500 text-blue-400">
                  {t("chat.you")}
                </Badge>
              )}
              {item.kind === "task" && (
                <>
                  <span
                    className={`h-2 w-2 rounded-full ${ROLE_COLOR[item.agentRole ?? "general"] ?? "bg-slate-500"}`}
                  />
                  <span className="font-mono text-xs font-medium">{item.agentRole}</span>
                  {item.status === "running" && (
                    <Badge variant="default" className="h-4 px-1 text-[10px]">
                      {t("subagents.state.running")}
                    </Badge>
                  )}
                  {item.status === "completed" && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      ✓
                    </Badge>
                  )}
                  {item.status === "failed" && (
                    <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                      ✗
                    </Badge>
                  )}
                  {item.status === "skipped" && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      {t("subagents.state.skipped")}
                    </Badge>
                  )}
                </>
              )}
              {item.kind === "review" && (
                <Badge variant="outline" className="border-green-500 text-green-500">
                  {t("chat.commander")}
                </Badge>
              )}
              {item.kind === "failed" && <Badge variant="destructive">{t("chat.error")}</Badge>}
              {item.kind === "task" && (
                <span className="truncate text-xs text-muted-foreground">{item.taskId}</span>
              )}
            </div>

            {item.kind === "user" && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.title}</p>
            )}

            {item.toolCalls && item.toolCalls.length > 0 && (
              <div className="mt-2 space-y-1">
                {item.toolCalls.map((call, i) => (
                  <ToolCallBlock key={`${item.key}-tool-${i}`} {...call} />
                ))}
              </div>
            )}

            {item.error && (
              <p className="mt-2 break-all font-mono text-xs text-destructive">{item.error}</p>
            )}
            {item.kind === "review" && (
              <p className="mt-2 text-sm text-foreground">
                {t("chat.completed", { score: String(item.score ?? "") })}
              </p>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("timeline.empty")}</p>
        )}
      </div>

      {live && detached && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
          onClick={() => {
            setDetached(false)
            const el = scrollRef.current
            if (el) el.scrollTop = el.scrollHeight
          }}
          data-testid="jump-to-latest"
        >
          ↓ {t("timeline.jumpToLatest")}
        </Button>
      )}
    </div>
  )
}
