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
 *     matching turns with <mark> ranges inside text units; Enter steps
 *     the find cursor through the matches and the CURRENT match's
 *     highlights render amber (others keep the default mark backdrop);
 *   - in-scope hotkeys: Cmd/Ctrl+F opens find only when the focus
 *     already lives inside the timeline, Esc leaves find mode;
 *   - toolbarLead slot: the standalone panel's title badge rides the
 *     toolbar row, so both dock and standalone modes share geometry;
 *   - turn navigation: anchors on task turns, adjacentAnchor semantics
 *     expressed as window anchors;
 *   - live-tail: liveTailState frozen count on the jump affordance
 *     (hidden entirely at a zero pending count);
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

import { useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from "react"
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
  toolbarLead,
}: {
  events: RuntimeEvent[]
  workspace: Workspace | null
  /** true while a run is in flight — enables auto-tail. */
  live: boolean
  /**
   * Optional node rendered at the head of the toolbar row — the panel
   * title badge in full-bleed standalone mode. Riding the toolbar row
   * (instead of an overlaid heading) keeps every mode's geometry
   * identical: no heading row spent, native flex alignment.
   */
  toolbarLead?: ReactNode
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
  /** Find cursor — index into findMatches (the CURRENT match a Enter
   *  step points at). Separate from the turn-navigator `cursor` so the
   *  two navigations never corrupt each other's position. */
  const [findCursor, setFindCursor] = useState(-1)
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

  // The CURRENT match (the one the find cursor points at) — its unit's
  // marks render amber while every other match keeps the default mark
  // background, so the eye can follow Enter-step navigation.
  const findActiveQuery = findActive(query)
  const currentMatch =
    findActiveQuery && findCursor >= 0 ? (findMatches[findCursor] ?? undefined) : undefined
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

  // Find navigation: Enter steps the cursor through findMatches (with
  // wrap-around) and anchors the window at the match's turn, mirroring
  // the turn navigator's anchor semantics.
  const advanceFindCursor = () => {
    if (!findActiveQuery || findMatches.length === 0) {
      setFindCursor(-1)
      return
    }
    const next = findCursor < 0 ? 0 : (findCursor + 1) % findMatches.length
    setFindCursor(next)
    const turnId = findMatches[next]?.turnId
    if (turnId) setAnchorTurnId(turnId)
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

  // A workspace switch drops the tail state: a freeze point recorded as
  // a unit COUNT is meaningless against another stream.
  const workspaceId = workspace?.id
  useEffect(() => {
    setDetached(false)
    setFrozenAt(null)
  }, [workspaceId])

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
    if (atBottom) {
      // Released — drop the freeze point so the NEXT detach records a
      // fresh one; a count never spans two detached episodes.
      setFrozenAt(null)
    } else {
      // Functional update: a fast scroll can fire twice between renders —
      // only the FIRST event (prev === null) records the freeze point, so
      // later arrivals accumulate against it instead of resetting it.
      setFrozenAt((prev) => (prev === null ? units.length : prev))
    }
  }

  // In-scope find hotkey: React's synthetic keydown fires only when the
  // focus already lives inside this container, so Cmd/Ctrl+F here never
  // hijacks the browser's own find elsewhere on the page. Esc leaves
  // find mode entirely (box closed, query cleared, cursor reset).
  const onContainerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault()
      setShowFind(true)
      return
    }
    if (e.key === "Escape" && showFind) {
      e.preventDefault()
      setShowFind(false)
      setQuery("")
      setFindCursor(-1)
    }
  }

  // Opening find hands the focus to the input.
  const findInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (showFind) findInputRef.current?.focus()
  }, [showFind])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={onContainerKeyDown}>
      <div className="mb-2 flex items-center gap-2">
        {toolbarLead}
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
            ref={findInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(-1)
              setFindCursor(-1)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                advanceFindCursor()
              }
            }}
            placeholder={t("timeline.findPlaceholder")}
            aria-label={t("timeline.find")}
            className="h-8 text-xs"
            data-testid="timeline-find"
          />
          {findActiveQuery && (
            <p className="mt-1 text-xs text-muted-foreground">
              {findMatches.length} {t("timeline.matchCount")}
              {currentMatch !== undefined && findCursor >= 0 && (
                <span data-testid="find-current-position">
                  {" "}
                  · {findCursor + 1}/{findMatches.length}
                </span>
              )}
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
            currentUnitKey={currentMatch?.key}
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

      {/* Jump affordance only when detached AND something is actually
          pending — at frozenCount 0 scrolling down is all it takes, so
          the floating button would just cover the tail. */}
      {live && detached && tail.frozenCount > 0 && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
          onClick={() => {
            setDetached(false)
            setAnchorTurnId(null)
            setFrozenAt(null)
            const el = scrollRef.current
            if (el) el.scrollTop = el.scrollHeight
          }}
          data-testid="jump-to-latest"
        >
          ↓ {t("timeline.jumpToLatest")} · +{tail.frozenCount}
        </Button>
      )}
    </div>
  )
}
