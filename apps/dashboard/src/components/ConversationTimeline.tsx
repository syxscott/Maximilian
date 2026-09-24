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
 * The window is ConversationWindow (windowTurns): turn-unit windows
 * hugging the tail, a "load earlier" affordance, and anchor semantics —
 * the prev/next turn navigator SETS the anchor, so the window pins
 * itself at the target turn (and can reach turns hidden above the
 * current window, which the old scroll-by-index could not).
 *
 * Retained surface capabilities, all driven by the pipeline:
 *   - find: buildConversationFindIndex interval matches, filtered to
 *     matching turns with <mark> ranges inside text units;
 *   - turn navigation: anchors on task turns, adjacentAnchor semantics
 *     expressed as window anchors;
 *   - live-tail: liveTailState frozen count on the jump affordance;
 *   - share: the pipeline's toConversationMarkdown;
 *   - virtual-height estimation: over VIRTUAL_HEIGHT_THRESHOLD the
 *     toolbar shows the total estimate beside the find box, the
 *     load-earlier label carries the estimated pixel height, and each
 *     card reserves its turn's estimate as a minHeight (plus a
 *     placeholder bar, perItemHeight) so the scrollbar ratio stays real
 *     and layout doesn't jump.
 *
 * Timeline discipline: newest at the bottom, auto-tail (sticks to the
 * bottom while the run is live unless the user scrolled up), and a
 * jump-to-latest affordance when detached.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { adjacentAnchor, turnAnchors } from "@/lib/timeline-view"
import {
  estimateTurnDepth,
  estimateVirtualHeight,
  formatEstimatedHeight,
  liveTailState,
  turnHeight,
  VIRTUAL_HEIGHT_THRESHOLD,
} from "@/components/conversation/model"
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
import { ConversationWindow } from "@/components/conversation/ConversationWindow"

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
  // Full-stream depths — pinned through windowing so a find-filtered
  // window regroups without re-deriving nested depths from lost parents.
  const turnDepth = useMemo(() => estimateTurnDepth(units), [units])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [detached, setDetached] = useState(false)
  const [query, setQuery] = useState("")
  const [anchorTurnId, setAnchorTurnId] = useState<string | null>(null)
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

  // The windowed stream: unfiltered, or cut down to matching turns under
  // an active find (the window then windows only what matched).
  const findActiveQuery = findActive(query)
  const displayedUnits = useMemo(
    () => (findActiveQuery ? units.filter((u) => matchedTurnIds.has(u.turnId)) : units),
    [units, findActiveQuery, matchedTurnIds],
  )
  const displayedTurns = useMemo(
    () => groupUnitsByTurn(displayedUnits, turnDepth),
    [displayedUnits, turnDepth],
  )
  const anchors = useMemo(() => turnAnchors(displayedTurns), [displayedTurns])

  // Virtual-height budget: the estimated pixel height of the render
  // area, surfaced once it crosses the threshold — a hint on the
  // windowing affordance, a total estimate beside the find box, and a
  // per-card minHeight (plus placeholder bar) so the scrollbar ratio
  // stays real and cards don't jump while only a window renders.
  const estimatedHeight = useMemo(() => estimateVirtualHeight(displayedUnits), [displayedUnits])
  const overHeightBudget = estimatedHeight > VIRTUAL_HEIGHT_THRESHOLD
  const turnHeights = useMemo(() => {
    if (!overHeightBudget) return undefined
    const map = new Map<string, number>()
    for (const turn of displayedTurns) {
      map.set(turn.turnId, turnHeight(turn))
    }
    return map
  }, [overHeightBudget, displayedTurns])

  // Turn navigation IS anchor setting: the adjacent task anchor becomes
  // the window anchor, so ConversationWindow pins its head there and
  // scrolls it into view — reaching turns hidden above the window too.
  const navigateTurn = (direction: 1 | -1) => {
    const next = adjacentAnchor(anchors, cursor, direction)
    setCursor(next)
    setAnchorTurnId(displayedTurns[next]?.turnId ?? null)
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

  // Auto-tail via the liveTailState model (round-4 borrowing): while live
  // and attached the view follows the tail; detaching freezes the window
  // and counts what arrives until the user jumps back.
  const [frozenAt, setFrozenAt] = useState<number | null>(null)
  const tail = useMemo(
    () => liveTailState(units, detached && live, { frozenAt: frozenAt ?? undefined }),
    [units, detached, live, frozenAt],
  )

  useEffect(() => {
    const el = scrollRef.current
    // An anchored window scrolls to ITS anchor — never fight it with the
    // tail snap.
    if (!el || !live || detached || anchorTurnId !== null) return
    el.scrollTop = el.scrollHeight
  }, [units.length, live, detached, anchorTurnId])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setDetached(!atBottom)
    if (atBottom) setFrozenAt(null)
    else if (frozenAt === null) setFrozenAt(units.length)
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
        {overHeightBudget && (
          <span
            data-testid="timeline-estimated-height"
            title={t("conversation.window.estimatedHeightTitle")}
            className="text-xs text-muted-foreground"
          >
            {t("conversation.window.totalHeight", {
              height: formatEstimatedHeight(estimatedHeight),
            })}
          </span>
        )}
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
        {turns.length > 0 && displayedUnits.length > 0 && (
          <ConversationWindow
            units={displayedUnits}
            visibleTurns={50}
            loadStep={50}
            anchorTurnId={anchorTurnId}
            onClearAnchor={() => setAnchorTurnId(null)}
            turnDepth={turnDepth}
            highlightTurnIds={findActiveQuery ? matchedTurnIds : undefined}
            textHighlights={findActiveQuery ? highlights : undefined}
            turnHeights={turnHeights}
            loadEarlierHint={
              overHeightBudget
                ? t("conversation.window.estimatedHeight", {
                    height: formatEstimatedHeight(estimatedHeight),
                  })
                : undefined
            }
          />
        )}
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
            setAnchorTurnId(null)
            const el = scrollRef.current
            if (el) el.scrollTop = el.scrollHeight
          }}
          data-testid="jump-to-latest"
        >
          ↓ {t("timeline.jumpToLatest")}
          {tail.frozenCount > 0 ? ` · +${tail.frozenCount}` : ""}
        </Button>
      )}
    </div>
  )
}
