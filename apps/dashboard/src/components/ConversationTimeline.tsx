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
 *     and layout doesn't jump;
 *   - true virtual scrolling: `virtualized` swaps the windowed window
 *     for VirtualTurnWindow — the whole displayed stream virtualizes
 *     (visible band only, translate offsets from the per-turn height
 *     estimates), with turn/find anchors mapping to scroll offsets via
 *     scrollOffsetForUnit; live-tail keeps driving the same container.
 *
 * Scroll authority (round-5, ZCode v4 timelineScrollAnchor borrowing):
 * `following` is the reader's scroll authority — only real user input
 * (wheel/touch/keyboard intent events) takes or grants it; the programmatic
 * stick-to-bottom and anchor-jump writes only advance the geometry ledger
 * through their echoes; and every bottom-sticking commit RECONCILES first,
 * so a wheel-up inside the event-dispatch window detaches instead of being
 * yanked back. selectionPinsTail keeps the highest priority (a drag-selection's
 * auto-scroll is never a detach), and liveTailState keeps its frozen-count
 * semantics on top of the authority's attached/detached verdict.
 *
 * Height memory (round-5, ZCode v4 timelineRowHeightCache + pi
 * row-estimate borrowing): real row heights are cached per stable turnId
 * outside the virtualizer (resets and remounts keep them), and the
 * estimator learns height ~ text/width per row kind from the measurements
 * that land — a row's first estimate is pinned (same row + width never
 * moves) so rows below the reader do not shift.
 *
 * Live-tail split (round-5, ZCode v4 conversationTimelineLiveTail
 * borrowing): in virtualized mode the stream's LAST turn renders in
 * normal flow after the spacer (splitLiveTail) — decided by position,
 * never by a running flag — so a streaming tail grows natively instead of
 * waiting a frame for the virtualizer's totalSize backfill, and the
 * history band keeps its array identity across streaming frames.
 *
 * ai-elements density surfaces, all real-data driven:
 *   - stats row: four StatCards (turns/tools/retries/failed) from the
 *     model's statsSummary over the compiled stream;
 *   - toolbar CopyField for the workspace id (self-hiding without a
 *     clipboard, per CopyField's own behavior);
 *   - the empty state renders through EmptyHint (icon + copy) instead
 *     of a bare text row;
 *   - the streaming tail: while the run is live and the reader attached,
 *     the StreamingCursor rides after the last displayed turn (retired
 *     while detached or when no run is in flight).
 *
 * Timeline discipline: newest at the bottom, auto-tail (sticks to the
 * bottom while the run is live unless the user scrolled up), and a
 * jump-to-latest affordance when detached.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react"
import { Input } from "@/components/ui/input"
import { adjacentAnchor, turnAnchors } from "@/lib/timeline-view"
import {
  estimateTurnDepth,
  estimateVirtualHeight,
  expansionKeepsTail,
  formatEstimatedHeight,
  liveTailState,
  markFirstSeen,
  stepNavigationCursor,
  VIRTUAL_HEIGHT_THRESHOLD,
  type NavigationCursors,
} from "@/components/conversation/model"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import type { RuntimeEvent, Workspace } from "@/api"
import { CopyField, EmptyHint, StatCard, StreamingCursor } from "@/components/ai-elements"
import {
  buildConversationFindIndex,
  buildTurnFlowItems,
  groupUnitsByTurn,
  statsSummary,
  toConversationMarkdown,
  type ConversationUnit,
  type FindHit,
} from "@/components/conversation/model"
import { ConversationWindow } from "@/components/conversation/ConversationWindow"
import { VirtualTurnWindow } from "@/components/conversation/VirtualTurnWindow"
import { TurnGroup } from "@/components/conversation/TurnGroup"
import {
  applyScrollEvent,
  initialScrollAuthority,
  isAtBottom,
  isOverflowing,
  keyboardScrollIntent,
  recordGestureIntent,
  reattachToTail,
  reconcileForStickyCommit,
  touchScrollIntent,
  wheelScrollIntent,
  type ScrollAuthorityState,
  type ScrollMetrics,
  type UserScrollIntent,
} from "@/components/conversation/scroll-authority"
import {
  createTurnHeightModel,
  recordTurnMeasurement,
  resolveTurnHeight,
  safeRowHeightStore,
  type TurnHeightModel,
} from "@/components/conversation/row-height-cache"
import {
  partitionLiveTail,
  splitLiveTail,
  type TurnPartition,
} from "@/components/conversation/live-tail-split"

/**
 * Shared EMPTY verdict for the steering flash-once set: steering is rare,
 * so renders that have nothing fresh return this ONE instance and the
 * TurnGroup memo comparator stays identity-stable across frames.
 */
const EMPTY_FRESH_STEERING: ReadonlySet<string> = new Set()

/** A programmatic write's echo window: the scroll event lands within a frame. */
const PROGRAMMATIC_ECHO_WINDOW_MS = 80

/** localStorage access that never throws (private mode, disabled storage). */
function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage
  } catch {
    return null
  }
}

/** Live scroll geometry of the container, captured at read time. */
function readScrollMetrics(el: HTMLElement): ScrollMetrics {
  return {
    scrollTop: el.scrollTop,
    viewportHeight: el.clientHeight,
    contentHeight: el.scrollHeight,
  }
}

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

/**
 * True while an in-container text selection is in progress (hermes
 * assistant-ui thread-list borrowing): a non-collapsed selection whose
 * anchor and focus both live inside `container` means the user is
 * dragging across text. The auto-scroll that drag produces fires scroll
 * events that look exactly like a detach, so while such a selection is
 * live the tail yields (stays attached) instead of detaching.
 */
export function selectionPinsTail(selection: Selection | null, container: Element | null): boolean {
  if (!selection || !container) return false
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection
  if (anchorNode === null || focusNode === null) return false
  // Spec-equivalent of Selection.collapsed (absent from this repo's DOM
  // lib): a selection is collapsed exactly when its endpoints coincide.
  if (anchorNode === focusNode && anchorOffset === focusOffset) return false
  return container.contains(anchorNode) && container.contains(focusNode)
}

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
  virtualized = false,
  viewportHeight,
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
  /**
   * Render through VirtualTurnWindow's TRUE virtual scrolling container
   * (total-height spacer + absolutely positioned visible band) instead
   * of the windowed ConversationWindow. Default false keeps the
   * windowed behavior — existing usages and tests do not regress.
   */
  virtualized?: boolean
  /** Fixed viewport px for the virtual container (measured otherwise). */
  viewportHeight?: number
}) {
  useLocale()
  // The pipeline: events → paired/retry-folded units → turn groups.
  const units = useMemo(() => buildTurnFlowItems(events, workspace), [events, workspace])
  const turns = useMemo(() => groupUnitsByTurn(units), [units])
  // Top stats row (turns/tools/retries/failed) over the compiled stream.
  const summary = useMemo(() => statsSummary(units), [units])
  // Full-stream depths — pinned through windowing so a find-filtered
  // window regroups without re-deriving nested depths from lost parents.
  const turnDepth = useMemo(() => estimateTurnDepth(units), [units])

  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * The reader's scroll authority (following ⇔ attached). ONLY user
   * input changes `following`; our own programmatic writes ledger
   * through their echoes; commits reconcile before sticking.
   */
  const [authority, setAuthority] = useState<ScrollAuthorityState>(initialScrollAuthority)
  const detached = !authority.following
  // The freeze point of the CURRENT detach episode (liveTailState's
  // frozen-count origin). Declared early: gesture handlers freeze it.
  const [frozenAt, setFrozenAt] = useState<number | null>(null)
  const [query, setQuery] = useState("")
  const [anchorTurnId, setAnchorTurnId] = useState<string | null>(null)
  // Workspace id (stream identity) — the live-tail reset, the steering
  // flash-once scope and the workspace id CopyField all key off it.
  const workspaceId = workspace?.id
  /**
   * The two navigations' cursors under the model's EXCLUSIVITY rule
   * (stepNavigationCursor): they share the one window anchor, so turning
   * retires the find cursor and find-stepping retires the turn cursor —
   * neither navigation can jump from, or highlight, a position the other
   * abandoned.
   */
  const [cursors, setCursors] = useState<NavigationCursors>({ cursor: -1, findCursor: -1 })
  const { cursor, findCursor } = cursors
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

  // Steering flash-once (markFirstSeen): a steering unit flares on its
  // FIRST render only. The registry — scoped by stream (workspace id) so
  // the position-derived unit keys of two workspaces never collide — is
  // READ during render (fresh = not yet recorded) and folded in a
  // post-commit effect. That split makes every replay path replay-proof
  // without re-render churn: a workspace switch-away-and-back re-delivers
  // the full event list, and find filtering / the virtual window unmount
  // and remount blocks — all of them find their keys already recorded and
  // mount with the overlay retired. StrictMode's double render is safe
  // too (the registry only grows inside effects), and a prop flip on a
  // still-mounted block cannot re-light it (TextUnitBlock reads `fresh`
  // once at mount). The verdict set is the shared EMPTY instance unless
  // something is actually fresh — the TurnGroup memo comparator relies
  // on that identity stability.
  const seenSteeringRef = useRef<Map<string, number>>(new Map())
  const steeringKeys = useMemo(
    () =>
      displayedUnits
        .filter(
          (u): u is Extract<ConversationUnit, { kind: "text" }> =>
            u.kind === "text" && u.source === "steering",
        )
        .map((u) => u.key),
    [displayedUnits],
  )
  const steeringScope = workspaceId ?? "\u0000stream"
  // Re-read on EVERY render (not memoized): the registry is written by
  // the post-commit effect below, and a virtual-band row remounting
  // after a scroll must see its key already recorded — a memoized
  // verdict would re-flash it. Identity: the shared EMPTY instance
  // unless something is actually fresh (the TurnGroup memo comparator
  // relies on that stability).
  const steeringMarks = markFirstSeen(steeringKeys, seenSteeringRef.current, 0, steeringScope).marks
  const freshSteeringKeys = (() => {
    const fresh = steeringMarks.filter((mark) => mark.fresh).map((mark) => mark.key)
    return fresh.length === 0 ? EMPTY_FRESH_STEERING : new Set(fresh)
  })()
  useEffect(() => {
    seenSteeringRef.current = markFirstSeen(
      steeringKeys,
      seenSteeringRef.current,
      Date.now(),
      steeringScope,
    ).seen
  }, [steeringKeys, steeringScope])

  // Live-tail split (round-5): the LAST displayed turn renders in normal
  // flow, the prefix stays in the virtual band — and the prefix keeps its
  // ARRAY IDENTITY across streaming frames (partitionLiveTail re-uses the
  // previous history when its content is unchanged), so the virtualizer
  // and the height list do not rebuild per token.
  const partitionRef = useRef<TurnPartition | null>(null)
  const partition = partitionLiveTail(displayedTurns, partitionRef.current)
  partitionRef.current = partition
  const split = useMemo(() => splitLiveTail(partition), [partition])

  // Height memory (round-5): one cache+estimator model per stream scope,
  // created lazily and swapped when the workspace id changes. Turn ids
  // are only unique within a stream, so the swap IS the reset.
  const heightScope = workspaceId ?? "\u0000stream"
  const heightModelRef = useRef<TurnHeightModel | null>(null)
  if (heightModelRef.current === null || heightModelRef.current.scope !== heightScope) {
    const storage = safeRowHeightStore(safeLocalStorage())
    heightModelRef.current = createTurnHeightModel(heightScope, { storage })
  }
  const heightModel = heightModelRef.current
  /** Bumped when a real row measurement changes a known height. */
  const [heightsVersion, setHeightsVersion] = useState(0)

  // Mirrors for handlers/effect bodies that must see the latest values
  // without resubscribing (the native gesture listeners attach once).
  const authorityRef = useRef(authority)
  authorityRef.current = authority
  const unitsCountRef = useRef(units.length)
  unitsCountRef.current = units.length
  const displayedTurnsRef = useRef(displayedTurns)
  displayedTurnsRef.current = displayedTurns

  // Programmatic-write ledger: our own scrollTop writes announce
  // themselves (target + echo window); the matching echo scroll event
  // classifies as programmatic and only advances the geometry ledger —
  // it never reads as a user detach ("only the reader takes the
  // authority"). The expected-top match (not the window alone) keeps a
  // USER scroll inside the window from being swallowed.
  const programmaticEchoRef = useRef<{ top: number; until: number } | null>(null)
  const markProgrammaticWrite = useCallback((top: number, el: HTMLElement) => {
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
    programmaticEchoRef.current = {
      top: Math.min(top, maxScrollTop),
      until: Date.now() + PROGRAMMATIC_ECHO_WINDOW_MS,
    }
  }, [])
  const markProgrammaticScroll = useCallback(
    (top: number) => {
      const el = scrollRef.current
      if (el) markProgrammaticWrite(top, el)
    },
    [markProgrammaticWrite],
  )
  const consumeProgrammaticEcho = useCallback((scrollTop: number): boolean => {
    const marker = programmaticEchoRef.current
    if (marker === null || Date.now() > marker.until) return false
    if (Math.abs(scrollTop - marker.top) >= 1) return false
    programmaticEchoRef.current = null
    return true
  }, [])
  const writeScrollTopProgrammatically = useCallback(
    (el: HTMLDivElement, top: number) => {
      markProgrammaticWrite(top, el)
      el.scrollTop = top
    },
    [markProgrammaticWrite],
  )

  // A real user gesture (wheel delta, touch drag, scroll key): an
  // away-from-bottom intent takes the authority IMMEDIATELY (the echo
  // scroll event has not landed yet, but the reader has spoken) and
  // records the freeze point for the jump affordance.
  const handleUserGesture = useCallback((intent: UserScrollIntent) => {
    if (intent === "none") return
    const el = scrollRef.current
    if (!el) return
    const overflowing = isOverflowing(readScrollMetrics(el))
    setAuthority((prev) => recordGestureIntent(prev, intent, overflowing))
    if (intent === "awayFromBottom" && overflowing) {
      setFrozenAt((prev) => (prev === null ? unitsCountRef.current : prev))
    }
  }, [])
  const handleUserGestureRef = useRef(handleUserGesture)
  handleUserGestureRef.current = handleUserGesture

  // Native gesture listeners on the shared container (both modes) —
  // passive: we observe intent, never block scrolling.
  const touchYRef = useRef<number | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      handleUserGestureRef.current(wheelScrollIntent(event.deltaY))
    }
    const onTouchStart = (event: TouchEvent) => {
      touchYRef.current = event.touches[0]?.clientY ?? null
    }
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY
      const prevY = touchYRef.current
      if (nextY !== undefined && prevY !== null) {
        handleUserGestureRef.current(touchScrollIntent(prevY, nextY))
      }
      if (nextY !== undefined) touchYRef.current = nextY
    }
    el.addEventListener("wheel", onWheel, { passive: true })
    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchmove", onTouchMove, { passive: true })
    return () => {
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
    }
  }, [virtualized])

  // Virtualization inputs (virtualized mode): per-turn heights through
  // the three levels — measured (cache) → learned estimate (pinned) →
  // static model estimate — over the split's VIRTUAL band only; the
  // normal-flow tail sizes itself. The anchored turn's index in the
  // displayed stream: the band is a prefix, so the index maps 1:1 (a
  // tail anchor clamps to the band total — its top edge).
  const virtualHeights = useMemo(
    () => (virtualized ? split.virtual.map((turn) => resolveTurnHeight(turn, heightModel)) : []),
    [virtualized, split.virtual, heightModel, heightsVersion],
  )
  const virtualAnchorIndex = useMemo(() => {
    if (!virtualized || anchorTurnId === null) return undefined
    const at = displayedTurns.findIndex((turn) => turn.turnId === anchorTurnId)
    return at >= 0 ? at : undefined
  }, [virtualized, anchorTurnId, displayedTurns])

  /** Row measurement sink (VirtualTurnWindow ResizeObserver reports). */
  const handleRowMeasure = useCallback((key: string, heightPx: number, widthPx: number) => {
    const model = heightModelRef.current
    if (!model) return
    const turn = displayedTurnsRef.current.find((candidate) => candidate.turnId === key)
    if (!turn) return
    if (recordTurnMeasurement(turn, model, heightPx, widthPx)) setHeightsVersion((v) => v + 1)
  }, [])

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
      map.set(turn.turnId, resolveTurnHeight(turn, heightModel))
    }
    return map
  }, [overHeightBudget, displayedTurns, heightModel, heightsVersion])

  // Turn navigation IS anchor setting: the adjacent task anchor becomes
  // the window anchor, so ConversationWindow pins its head there and
  // scrolls it into view — reaching turns hidden above the window too.
  // Stepping RETIRES the find cursor (stepNavigationCursor): the amber
  // "current match" belonged to a turn the user just navigated away from.
  const navigateTurn = (direction: 1 | -1) => {
    const next = adjacentAnchor(anchors, cursor, direction)
    setCursors(stepNavigationCursor("turn", next))
    setAnchorTurnId(displayedTurns[next]?.turnId ?? null)
  }

  // Find navigation: Enter steps the cursor through findMatches (with
  // wrap-around) and anchors the window at the match's turn, mirroring
  // the turn navigator's anchor semantics. Stepping RETIRES the turn
  // cursor the same way — the next prev/next starts fresh instead of
  // jumping from a spot find has already left behind.
  const advanceFindCursor = () => {
    if (!findActiveQuery || findMatches.length === 0) {
      setCursors(stepNavigationCursor("find", -1))
      return
    }
    const next = findCursor < 0 ? 0 : (findCursor + 1) % findMatches.length
    setCursors(stepNavigationCursor("find", next))
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
  // and counts what arrives until the user jumps back. Detachment is the
  // scroll authority's verdict (round-5): user input only.
  const tail = useMemo(
    () => liveTailState(units, detached && live, { frozenAt: frozenAt ?? undefined }),
    [units, detached, live, frozenAt],
  )

  // Windowing x live-tail coexistence: a "load earlier" expansion
  // prepends turns ABOVE the window, which keeps scrollTop unchanged and
  // silently pushes an attached view off the bottom. While the tail
  // states say following (expansionKeepsTail: live + attached +
  // un-anchored) the expansion re-pins the viewport; a detached reader
  // or an anchored dive keeps the viewport exactly where it is.
  const [windowExpansions, setWindowExpansions] = useState(0)

  // Retry-wave expansion registry (OpenHands list-level borrowing): the
  // open state of every wave lives HERE so a forced remount (virtual
  // band unmount, find filter) restores the reader's expansion.
  const [expandedRetries, setExpandedRetries] = useState<ReadonlySet<string>>(() => new Set())
  const toggleRetry = useCallback((key: string, open: boolean) => {
    setExpandedRetries((prev) => {
      const next = new Set(prev)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  // A workspace switch drops the tail state and the height memory scope:
  // a freeze point recorded as a unit COUNT is meaningless against
  // another stream, and turnId height keys are stream-scoped too. The
  // guard keeps the MOUNT from re-rendering (fresh state identities would
  // defeat the bailout the previous detached/frozen reset relied on).
  const prevWorkspaceRef = useRef(workspaceId)
  useEffect(() => {
    if (prevWorkspaceRef.current === workspaceId) return
    prevWorkspaceRef.current = workspaceId
    setAuthority(initialScrollAuthority())
    setFrozenAt(null)
    setExpandedRetries(new Set())
  }, [workspaceId])

  // The stick-to-bottom commit — RECONCILED (round-5, ZCode v4
  // reconcileFollowingForContentAnchor borrowing): before writing, the
  // commit checks the reader's pending gesture intent and the live
  // geometry against the ledger. A wheel-up inside the dispatch window or
  // an unobserved upscroll takes the authority; the commit yields
  // (detach + freeze) instead of dragging the reader back to the tail.
  // The write itself is programmatic — its echo only advances the ledger.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !expansionKeepsTail(live, detached, anchorTurnId !== null)) return
    const verdict = reconcileForStickyCommit(authorityRef.current, readScrollMetrics(el))
    if (!verdict.stick) {
      setAuthority(verdict.state)
      setFrozenAt((prev) => (prev === null ? unitsCountRef.current : prev))
      return
    }
    writeScrollTopProgrammatically(el, el.scrollHeight)
  }, [units.length, live, detached, anchorTurnId, windowExpansions, writeScrollTopProgrammatically])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    // Selection pinning (hermes thread-list borrowing) keeps the highest
    // priority: an in-flight text selection auto-scrolls this container
    // while the user drags upward — that scroll is part of the selection
    // gesture, not a detach. Yield: keep the authority untouched until
    // the selection collapses (mouse release) and a later scroll
    // re-evaluates.
    if (selectionPinsTail(document.getSelection?.() ?? null, el)) return
    const metrics = readScrollMetrics(el)
    const programmatic = consumeProgrammaticEcho(metrics.scrollTop)
    // User scroll: the landing point decides (at bottom ⇔ follow).
    // Programmatic echo: ledger only — the authority is untouched.
    setAuthority((prev) => applyScrollEvent(prev, metrics, programmatic ? "programmatic" : "user"))
    if (!programmatic) {
      if (isAtBottom(metrics)) {
        // Released — drop the freeze point so the NEXT detach records a
        // fresh one; a count never spans two detached episodes.
        setFrozenAt(null)
      } else {
        // Functional update: a fast scroll can fire twice between renders
        // — only the FIRST event (prev === null) records the freeze
        // point, so later arrivals accumulate against it.
        setFrozenAt((prev) => (prev === null ? unitsCountRef.current : prev))
      }
    }
  }

  // In-scope find hotkey: React's synthetic keydown fires only when the
  // focus already lives inside this container, so Cmd/Ctrl+F here never
  // hijacks the browser's own find elsewhere on the page. Esc leaves
  // find mode entirely (box closed, query cleared, cursor reset). Scroll
  // keys classify as user gestures — except over an editable target,
  // where they move the caret, not the timeline.
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
      // Leaving find retires the find cursor only — a turn-navigation
      // position (if the navigator stepped last) stays put.
      setCursors((c) => ({ ...c, findCursor: -1 }))
      return
    }
    const target = e.target
    const editable =
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT")
    handleUserGesture(
      keyboardScrollIntent({ key: e.key, shiftKey: e.shiftKey, editableTarget: editable }),
    )
  }

  // Opening find hands the focus to the input.
  const findInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (showFind) findInputRef.current?.focus()
  }, [showFind])

  // The streaming tail (ai-elements StreamingCursor): while the run is
  // live and the reader is attached, a blinking caret rides after the
  // last displayed turn — the normal-flow tail row in virtualized mode —
  // pure affordance, no data of its own. Detaching (or a dead run)
  // retires it; it comes back on re-attach.
  const showStreamCursor = live && !detached && turns.length > 0

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
        <div className="ml-auto flex items-center gap-2">
          {/* Workspace id as a copyable chip — CopyField hides itself when
              the clipboard API is unavailable (its own contract). */}
          {workspaceId !== undefined && workspaceId !== "" && (
            <CopyField
              field={{ value: workspaceId, label: t("conversation.copy.workspace") }}
              className="h-7 text-xs"
            />
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={copyShare}>
            {copied ? `✓ ${t("timeline.copied")}` : t("timeline.share")}
          </Button>
        </div>
      </div>
      {/* Stats row: four tiles over the compiled stream — hidden entirely
          while the stream is empty (the empty hint speaks then). */}
      {units.length > 0 && (
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="timeline-stats">
          <StatCard stat={{ label: t("conversation.stats.turns"), value: String(summary.turns) }} />
          <StatCard stat={{ label: t("conversation.stats.tools"), value: String(summary.tools) }} />
          <StatCard
            stat={{ label: t("conversation.stats.retries"), value: String(summary.retries) }}
          />
          <StatCard
            stat={{ label: t("conversation.stats.failed"), value: String(summary.failed) }}
          />
        </div>
      )}
      {showFind && (
        <div className="mb-2">
          <Input
            ref={findInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              // A new query invalidates both positions (old match indexes
              // no longer exist) — the model's mutual -1 reset.
              setCursors({ cursor: -1, findCursor: -1 })
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
      {virtualized ? (
        <VirtualTurnWindow
          testId="conversation-timeline"
          containerRef={scrollRef}
          onScroll={onScroll}
          units={split.virtual}
          heights={virtualHeights}
          tailUnits={split.tailRows.length > 0 ? split.tailRows : undefined}
          viewportHeight={viewportHeight}
          anchorIndex={virtualAnchorIndex}
          getKey={(turn) => turn.turnId}
          onMeasure={handleRowMeasure}
          markProgrammaticScroll={markProgrammaticScroll}
          renderUnit={(turn) => (
            <>
              <TurnGroup
                turn={turn}
                highlighted={findActiveQuery ? matchedTurnIds.has(turn.turnId) : false}
                textHighlights={findActiveQuery ? highlights : undefined}
                currentUnitKey={currentMatch?.key}
                freshSteeringKeys={freshSteeringKeys}
                expandedRetries={expandedRetries}
                onToggleRetry={toggleRetry}
              />
              {showStreamCursor && turn.turnId === split.tailRows[0]?.turnId && (
                <div className="mt-1" data-testid="timeline-streaming-cursor">
                  <StreamingCursor />
                </div>
              )}
            </>
          )}
          empty={
            turns.length === 0 ? (
              <div data-testid="timeline-empty">
                <EmptyHint
                  hint={{ title: t("timeline.empty"), hint: t("conversation.empty.hint") }}
                />
              </div>
            ) : undefined
          }
        />
      ) : (
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
              onExpand={() => setWindowExpansions((v) => v + 1)}
              turnDepth={turnDepth}
              highlightTurnIds={findActiveQuery ? matchedTurnIds : undefined}
              textHighlights={findActiveQuery ? highlights : undefined}
              currentUnitKey={currentMatch?.key}
              freshSteeringKeys={freshSteeringKeys}
              expandedRetries={expandedRetries}
              onToggleRetry={toggleRetry}
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
            <div data-testid="timeline-empty">
              <EmptyHint
                hint={{ title: t("timeline.empty"), hint: t("conversation.empty.hint") }}
              />
            </div>
          )}
          {showStreamCursor && (
            <div className="pt-1" data-testid="timeline-streaming-cursor">
              <StreamingCursor />
            </div>
          )}
        </div>
      )}

      {/* Jump affordance only when detached AND something is actually
          pending — at frozenCount 0 scrolling down is all it takes, so
          the floating button would just cover the tail. */}
      {live && detached && tail.frozenCount > 0 && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
          onClick={() => {
            setAuthority((prev) => reattachToTail(prev))
            setAnchorTurnId(null)
            setFrozenAt(null)
            const el = scrollRef.current
            if (el) writeScrollTopProgrammatically(el, el.scrollHeight)
          }}
          data-testid="jump-to-latest"
        >
          ↓ {t("timeline.jumpToLatest")} · +{tail.frozenCount}
        </Button>
      )}
    </div>
  )
}
