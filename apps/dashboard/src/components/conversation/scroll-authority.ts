// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Bottom-follow "scroll authority" state machine — pure functions, no
 * DOM/React dependency (borrowing: ZCode v4 timelineScrollAnchor).
 *
 * Semantics:
 * - `following` expresses the READER's scroll authority, not an instant
 *   geometry snapshot: only real user scroll input (wheel / touch /
 *   keyboard intent events) may take it away or grant it back;
 * - programmatic stick-to-bottom writes and measurement-compensation
 *   scroll echoes only update the geometry ledger — they never steal the
 *   authority (a scroll event fired by our own scrollTop write must not
 *   read as a detach);
 * - before a content commit sticks to the bottom, the pending user
 *   intent is RECONCILED against live metrics: a wheel-up inside the
 *   event-dispatch window (the scroll event has not landed yet) or an
 *   unobserved upscroll takes the authority and the commit yields
 *   instead of yanking the reader back to the tail — the fix for
 *   "a streaming commit sticks with a stale following=true";
 * - prepend (load-older) anchor compensation is modeled here too as a
 *   generic pure pair — the wiring waits until pagination exists.
 *
 * Gesture granularity is simplified to three states (wheel / touch /
 * programmatic) per the borrowing's pointer/touch/momentum machine; a
 * bare scroll event with no recorded programmatic origin counts as user
 * input (scrollbar drags have no intent event).
 */

/** Distance from the bottom that still counts as "at the bottom". */
export const BOTTOM_ANCHOR_EPSILON_PX = 48

/**
 * A scrollTop REGRESSION smaller than this is sub-pixel jitter (e.g. a
 * virtualizer measurement shift), never a user upscroll.
 */
export const UNOBSERVED_SCROLL_EPSILON_PX = 2

/** Live scroll geometry of the scrolling container, captured on read. */
export interface ScrollMetrics {
  scrollTop: number
  viewportHeight: number
  contentHeight: number
}

export type UserScrollIntent = "none" | "awayFromBottom" | "towardBottom" | "unknown"

/** Where a scroll event came from: the reader, or one of our own writes. */
export type ScrollEventSource = "user" | "programmatic"

// ── Geometry ────────────────────────────────────────────────────────────────

/** Remaining scrollable distance to the bottom (0 when under one screen). */
export function distanceToBottom(metrics: ScrollMetrics): number {
  const scrollTop = Number.isFinite(metrics.scrollTop) ? metrics.scrollTop : 0
  const viewport = Number.isFinite(metrics.viewportHeight) ? metrics.viewportHeight : 0
  const content = Number.isFinite(metrics.contentHeight) ? metrics.contentHeight : 0
  return Math.max(0, content - viewport - scrollTop)
}

export function isAtBottom(
  metrics: ScrollMetrics,
  epsilonPx: number = BOTTOM_ANCHOR_EPSILON_PX,
): boolean {
  return distanceToBottom(metrics) <= epsilonPx
}

/** True when the content can scroll at all (a wheel on a short stream is not a detach). */
export function isOverflowing(metrics: ScrollMetrics): boolean {
  const viewport = Number.isFinite(metrics.viewportHeight) ? metrics.viewportHeight : 0
  const content = Number.isFinite(metrics.contentHeight) ? metrics.contentHeight : 0
  return content - viewport >= 1
}

// ── Gesture intent classification (wheel / touch / keyboard) ────────────────

/** Wheel deltaY scrolls with scrollTop: negative reads earlier content. */
export function wheelScrollIntent(deltaY: number): UserScrollIntent {
  if (!Number.isFinite(deltaY) || deltaY === 0) return "none"
  return deltaY < 0 ? "awayFromBottom" : "towardBottom"
}

/** Touch drag moves against scrollTop: a downward finger reads earlier content. */
export function touchScrollIntent(previousClientY: number, nextClientY: number): UserScrollIntent {
  if (!Number.isFinite(previousClientY) || !Number.isFinite(nextClientY)) return "none"
  if (nextClientY > previousClientY) return "awayFromBottom"
  if (nextClientY < previousClientY) return "towardBottom"
  return "none"
}

/**
 * Keyboard scroll intent. Keys over an editable target (composer, find
 * box) move the caret, not the timeline — never an intent.
 */
export function keyboardScrollIntent(input: {
  key: string
  shiftKey?: boolean
  editableTarget?: boolean
}): UserScrollIntent {
  if (input.editableTarget === true) return "none"
  switch (input.key) {
    case "ArrowUp":
    case "PageUp":
    case "Home":
      return "awayFromBottom"
    case "ArrowDown":
    case "PageDown":
    case "End":
      return "towardBottom"
    case " ":
      return input.shiftKey === true ? "awayFromBottom" : "towardBottom"
    default:
      return "none"
  }
}

// ── The authority state ─────────────────────────────────────────────────────

export interface ScrollAuthorityState {
  /** The reader wants the tail followed (⇔ the timeline's attached state). */
  following: boolean
  /**
   * Last scrollTop the LEDGER observed — scroll-event reads plus the
   * echoes of our own programmatic writes. Content commits reconcile
   * against it to spot an upscroll whose event has not landed yet.
   */
  ledgerScrollTop: number
  /**
   * Gesture intent recorded by wheel/touch/keyboard and not yet consumed
   * by its echo scroll event (or a commit reconciliation).
   */
  intent: UserScrollIntent
}

/** Session start / stream switch: open following the tail. */
export function initialScrollAuthority(): ScrollAuthorityState {
  return { following: true, ledgerScrollTop: 0, intent: "none" }
}

/**
 * Re-attach without touching the ledger (jump-to-latest, an explicit
 * re-follow): the following write itself is programmatic and lands at
 * the bottom, so its echo must not read as a fresh user verdict.
 */
export function reattachToTail(state: ScrollAuthorityState): ScrollAuthorityState {
  if (state.following && state.intent === "none") return state
  return { ...state, following: true, intent: "none" }
}

/**
 * A real user gesture (wheel delta, touch drag, scroll key). An
 * away-from-bottom intent takes the authority IMMEDIATELY — the echo
 * scroll event has not landed yet, but the reader has spoken (rule 1 of
 * the borrowing's reconciliation). It only detaches over overflowing
 * content: a wheel-up on a one-screen stream cannot scroll anywhere.
 * A toward-bottom intent records without attaching — arrival at the
 * bottom (the echo's geometry) grants the follow back.
 */
export function recordGestureIntent(
  state: ScrollAuthorityState,
  intent: UserScrollIntent,
  overflowing: boolean,
): ScrollAuthorityState {
  if (intent === "none") return state
  if (intent === "awayFromBottom") {
    if (!overflowing) return state
    if (!state.following && state.intent === "awayFromBottom") return state
    return { ...state, following: false, intent: "awayFromBottom" }
  }
  if (state.intent === intent) return state
  return { ...state, intent }
}

/**
 * One scroll event, classified by origin. Programmatic echoes (our own
 * stick-to-bottom writes, anchor jumps, measurement compensation) only
 * advance the ledger — they never change `following` and never consume a
 * pending user intent. A user scroll decides by its final landing point:
 * at bottom ⇔ follow.
 */
export function applyScrollEvent(
  state: ScrollAuthorityState,
  metrics: ScrollMetrics,
  source: ScrollEventSource,
): ScrollAuthorityState {
  if (source !== "user") {
    if (state.ledgerScrollTop === metrics.scrollTop) return state
    return { ...state, ledgerScrollTop: metrics.scrollTop }
  }
  const following = isAtBottom(metrics)
  if (
    state.following === following &&
    state.intent === "none" &&
    state.ledgerScrollTop === metrics.scrollTop
  ) {
    return state
  }
  return { following, ledgerScrollTop: metrics.scrollTop, intent: "none" }
}

// ── Commit-time reconciliation (before a programmatic stick) ────────────────

export interface StickyCommitVerdict {
  /** The authority AFTER the reconciliation (persist by the caller). */
  state: ScrollAuthorityState
  /** Whether the commit may perform its stick-to-bottom write. */
  stick: boolean
}

/**
 * Reconcile the reader's scroll authority BEFORE a content commit sticks
 * to the bottom (borrowing: ZCode v4 reconcileFollowingForContentAnchor).
 * Following is scroll-event driven, but a scroll event lands one frame
 * after the gesture: a wheel-up (or a test's programmatic scrollTop
 * write) that falls inside a total-size-changing commit would otherwise
 * be stuck over by a STALE following=true, and the rebound would read
 * the yank back as attached — the whole upscroll swallowed.
 *
 * Rules, in order (metrics are read LIVE at commit time):
 * 1. not following → hold (a detached reader is never yanked; the gesture
 *    channel already detached it — recordGestureIntent acts immediately);
 * 2. an unobserved upscroll (live scrollTop REGRESSED past the ledger)
 *    → detach + hold: a scroll whose event has not landed yet, caught via
 *    geometry (scrollbar drags and momentum have no intent event);
 * 3. otherwise → stick, following stays true.
 */
export function reconcileForStickyCommit(
  state: ScrollAuthorityState,
  metrics: ScrollMetrics,
): StickyCommitVerdict {
  if (!state.following) return { state, stick: false }
  const scrollTop = Number.isFinite(metrics.scrollTop) ? metrics.scrollTop : 0
  if (scrollTop < state.ledgerScrollTop - UNOBSERVED_SCROLL_EPSILON_PX) {
    return {
      state: { ...state, following: false, ledgerScrollTop: scrollTop, intent: "none" },
      stick: false,
    }
  }
  return { state, stick: true }
}

// ── Prepend (load-older) anchor compensation — generic, unwired ─────────────
//
// Prepending history rows above the window keeps scrollTop unchanged and
// silently pushes the reader's content down. With stable row keys the
// existing rows keep their measured heights, so the recovery is exactly a
// scrollTop shift of the prepended height: scrollTop' = scrollTop + Δtotal.
// The wiring waits until a load-older pagination exists; the model is
// generic and tested now.

export interface PrependAnchorInput {
  /** Stream key of the first rendered row BEFORE the prepend (null = no rows yet). */
  prevFirstKey: string | number | null
  /** Stream key of the first rendered row AFTER the prepend (null = rows cleared). */
  nextFirstKey: string | number | null
  /** Total pixel height of the rendered stream before the prepend. */
  prevTotalSize: number
  /** Total pixel height of the rendered stream after the prepend. */
  nextTotalSize: number
}

/**
 * The scrollTop shift a real prepend needs: positive only when the first
 * row's key got SMALLER (history genuinely grew at the head). Appends,
 * replacements, clears and first renders return null — leave the scroll
 * position alone (bottom anchoring owns those).
 */
export function prependScrollAdjustment(input: PrependAnchorInput): number | null {
  if (input.prevFirstKey === null || input.nextFirstKey === null) return null
  if (input.nextFirstKey >= input.prevFirstKey) return null
  const delta = input.nextTotalSize - input.prevTotalSize
  if (!Number.isFinite(delta) || delta <= 0) return null
  return delta
}

/** A stable anchor's viewport offset, snapshotted at load-older trigger time. */
export interface PrependVirtualAnchor {
  /** The anchor row's stream key (same-key rows are comparable). */
  key: string | number
  /** Anchor top edge relative to the viewport top at snapshot time. */
  offsetTop: number
  /** The anchor's stream start index after the prepend. */
  start: number
}

/**
 * Restore an anchor's viewport position across a prepend: compute the
 * absolute target from the snapshot taken BEFORE intervening writes could
 * touch scrollTop, then subtract the live scrollTop — re-adding only the
 * measurement.start delta would double-count the intermediate shift.
 * Same-key anchors only; non-finite inputs yield null (no write).
 */
export function prependAnchorAdjustment(
  previous: PrependVirtualAnchor,
  next: PrependVirtualAnchor,
  currentScrollTop: number,
): number | null {
  if (previous.key !== next.key) return null
  if (
    !Number.isFinite(previous.offsetTop) ||
    !Number.isFinite(next.start) ||
    !Number.isFinite(currentScrollTop)
  ) {
    return null
  }
  return next.start - previous.offsetTop - currentScrollTop
}

/**
 * Jump-to-latest affordance visibility: only when the reader detached
 * AND there is something to jump to.
 */
export function shouldShowBackToBottom(following: boolean, rowCount: number): boolean {
  return !following && rowCount > 0
}
