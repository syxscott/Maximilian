// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ConversationTimeline — the workspace conversation as a virtualized,
 * turn-grouped timeline (ZCode v4 ConversationTimeline borrowing). The
 * render layer is the turn-unit pipeline: events + workspace compile
 * into paired/retry-folded render units (components/conversation/model)
 * which group into turns —
 *
 *   turn = user request → planning → per-task groups (tool calls inline
 *   via ToolCallBlock, retry waves collapsed) → completion/failure →
 *   review verdict.
 *
 * Retained surface capabilities, all driven by the pipeline:
 *   - find: buildConversationFindIndex interval matches, filtered to
 *     matching turns with <mark> ranges inside text units;
 *   - turn navigation: anchors on task turns, adjacentAnchor semantics;
 *   - windowing: newest 50 turns + "load earlier";
 *   - share: the pipeline's toConversationMarkdown.
 *
 * Timeline discipline: newest at the bottom, auto-tail (sticks to the
 * bottom while the run is live unless the user scrolled up), and a
 * jump-to-latest affordance when detached.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { adjacentAnchor, turnAnchors, windowItems } from "@/lib/timeline-view"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import type { RuntimeEvent, Workspace } from "@/api"
import {
  buildConversationFindIndex,
  buildTurnFlowItems,
  groupUnitsByTurn,
  toConversationMarkdown,
  type ConversationUnit,
  type FindHit,
} from "@/components/conversation/model"
import { TurnGroup } from "@/components/conversation/TurnGroup"

/** Unit-key → matched ranges inside the unit's text (find highlight). */
function textHighlightMap(matches: ReturnType<typeof buildConversationFindIndex>) {
  const map = new Map<string, FindHit[]>()
  for (const match of matches) {
    for (const hit of match.hits) {
      if (hit.field !== "text") continue
      const existing = map.get(match.key)
      if (existing) existing.push(hit)
      else map.set(match.key, [hit])
    }
  }
  return map
}

const findActive = (query: string): boolean => query.trim().length > 0

/** The turns that contain at least one find match. */
function matchedTurnIdSet(
  matches: ReturnType<typeof buildConversationFindIndex>,
  units: ConversationUnit[],
): Set<string> {
  return new Set(matches.map((match) => units[match.unitIndex]?.turnId ?? match.turnId))
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
  // The pipeline: events → paired/retry-folded units → turn groups.
  const units = useMemo(() => buildTurnFlowItems(events, workspace), [events, workspace])
  const turns = useMemo(() => groupUnitsByTurn(units), [units])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [detached, setDetached] = useState(false)
  const [query, setQuery] = useState("")
  const [visibleCount, setVisibleCount] = useState(50)
  const [cursor, setCursor] = useState(-1)
  const [showFind, setShowFind] = useState(false)
  const [copied, setCopied] = useState(false)

  // Find — interval semantics from buildConversationFindIndex: every
  // occurrence range per unit; matching turns stay visible, non-matching
  // ones drop out, and text ranges render as <mark>.
  const findMatches = useMemo(() => buildConversationFindIndex(units, query), [units, query])
  const matchedTurnIds = useMemo(
    () => (findActive(query) ? matchedTurnIdSet(findMatches, units) : new Set<string>()),
    [findMatches, units, query],
  )
  const highlights = useMemo(() => textHighlightMap(findMatches), [findMatches])

  const displayed = useMemo(
    () => (query.trim() ? turns.filter((turn) => matchedTurnIds.has(turn.turnId)) : turns),
    [turns, query, matchedTurnIds],
  )
  const anchors = useMemo(() => turnAnchors(displayed), [displayed])
  const { window: rendered, hiddenAbove } = useMemo(
    () => windowItems(displayed, visibleCount),
    [displayed, visibleCount],
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
        toConversationMarkdown(units, {
          workspaceTitle: workspace?.userRequest?.slice(0, 60) ?? null,
        }),
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
  }, [units.length, live, detached])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setDetached(!atBottom)
  }

  const findActiveQuery = findActive(query)

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
          {findActiveQuery && (
            <p className="mt-1 text-xs text-muted-foreground">
              {findMatches.length} {t("timeline.matchCount")}
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
        {rendered.map((turn, renderIndex) => (
          <div key={turn.turnId} data-timeline-index={hiddenAbove + renderIndex}>
            <TurnGroup
              turn={turn}
              highlighted={findActiveQuery && matchedTurnIds.has(turn.turnId)}
              textHighlights={findActiveQuery ? highlights : undefined}
            />
          </div>
        ))}
        {turns.length === 0 && (
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
