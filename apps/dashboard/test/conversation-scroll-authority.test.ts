// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Scroll-authority state machine tests (ZCode v4 timelineScrollAnchor
 * borrowing): intent classification per gesture source, the ledger-only
 * programmatic echo rule, commit-time reconciliation against gestures
 * inside the event-dispatch window, and the prepend anchor-compensation
 * pair. The streaming-commit/wheel-up interleave sequence is asserted
 * END TO END through the pure transitions — the component wiring test
 * (conversation.test.tsx, scroll authority) covers the DOM side.
 */
import { describe, expect, it } from "vitest"
import {
  applyScrollEvent,
  BOTTOM_ANCHOR_EPSILON_PX,
  distanceToBottom,
  initialScrollAuthority,
  isAtBottom,
  isOverflowing,
  keyboardScrollIntent,
  prependAnchorAdjustment,
  prependScrollAdjustment,
  recordGestureIntent,
  reconcileForStickyCommit,
  reattachToTail,
  shouldShowBackToBottom,
  touchScrollIntent,
  UNOBSERVED_SCROLL_EPSILON_PX,
  wheelScrollIntent,
  type ScrollAuthorityState,
  type ScrollMetrics,
} from "../src/components/conversation/scroll-authority"

const metrics = (scrollTop: number, viewportHeight = 500, contentHeight = 2000): ScrollMetrics => ({
  scrollTop,
  viewportHeight,
  contentHeight,
})

const BOTTOM = metrics(1500) // 2000 − 500 − 1500 = 0
const ABOVE = metrics(600) // 900px above the bottom

describe("scroll geometry", () => {
  it("computes the remaining distance to the bottom (clamped at 0)", () => {
    expect(distanceToBottom(BOTTOM)).toBe(0)
    expect(distanceToBottom(ABOVE)).toBe(900)
    expect(distanceToBottom(metrics(5000))).toBe(0) // overshoot clamps
    // A malformed scrollTop coerces to 0 (treated as the top edge).
    expect(distanceToBottom(metrics(Number.NaN))).toBe(1500)
  })

  it.each([
    [1500, true],
    [1470, true], // inside the 48px epsilon
    [1452, true], // exactly at the epsilon edge
    [1451, false], // one pixel past it
    [600, false],
  ])("isAtBottom(scrollTop %i) → %s", (scrollTop, expected) => {
    expect(isAtBottom(metrics(scrollTop))).toBe(expected)
  })

  it("matches the timeline's historical 48px at-bottom window", () => {
    expect(BOTTOM_ANCHOR_EPSILON_PX).toBe(48)
  })

  it("reports overflow only when content can actually scroll", () => {
    expect(isOverflowing(metrics(0, 500, 2000))).toBe(true)
    expect(isOverflowing(metrics(0, 500, 500))).toBe(false)
    expect(isOverflowing(metrics(0, 500, 501))).toBe(true)
    expect(isOverflowing(metrics(0, 500, Number.NaN))).toBe(false)
  })
})

describe("gesture intent classification", () => {
  it("classifies wheel deltas: negative reads earlier content", () => {
    expect(wheelScrollIntent(-120)).toBe("awayFromBottom")
    expect(wheelScrollIntent(120)).toBe("towardBottom")
    expect(wheelScrollIntent(0)).toBe("none")
    expect(wheelScrollIntent(Number.NaN)).toBe("none")
  })

  it("classifies touch drags against scrollTop (downward finger = earlier)", () => {
    expect(touchScrollIntent(400, 380)).toBe("towardBottom")
    expect(touchScrollIntent(400, 420)).toBe("awayFromBottom")
    expect(touchScrollIntent(400, 400)).toBe("none")
    expect(touchScrollIntent(Number.NaN, 400)).toBe("none")
  })

  it("classifies scroll keys and ignores editable targets", () => {
    expect(keyboardScrollIntent({ key: "ArrowUp" })).toBe("awayFromBottom")
    expect(keyboardScrollIntent({ key: "PageUp" })).toBe("awayFromBottom")
    expect(keyboardScrollIntent({ key: "Home" })).toBe("awayFromBottom")
    expect(keyboardScrollIntent({ key: "ArrowDown" })).toBe("towardBottom")
    expect(keyboardScrollIntent({ key: "End" })).toBe("towardBottom")
    expect(keyboardScrollIntent({ key: " " })).toBe("towardBottom")
    expect(keyboardScrollIntent({ key: " ", shiftKey: true })).toBe("awayFromBottom")
    expect(keyboardScrollIntent({ key: "ArrowUp", editableTarget: true })).toBe("none")
    expect(keyboardScrollIntent({ key: "a" })).toBe("none")
  })
})

describe("recordGestureIntent (the reader takes the authority)", () => {
  it("an away-from-bottom intent detaches IMMEDIATELY over overflowing content", () => {
    const next = recordGestureIntent(initialScrollAuthority(), "awayFromBottom", true)
    expect(next.following).toBe(false)
    expect(next.intent).toBe("awayFromBottom")
    // The ledger is geometry, not intent — a gesture does not move it.
    expect(next.ledgerScrollTop).toBe(0)
  })

  it("a wheel-up on non-overflowing content cannot detach (nowhere to scroll)", () => {
    const state = initialScrollAuthority()
    expect(recordGestureIntent(state, "awayFromBottom", false)).toBe(state)
  })

  it("is idempotent for a repeated away intent (same object back)", () => {
    const detached = recordGestureIntent(initialScrollAuthority(), "awayFromBottom", true)
    expect(recordGestureIntent(detached, "awayFromBottom", true)).toBe(detached)
  })

  it("a toward-bottom intent records without granting the follow yet", () => {
    const detached = recordGestureIntent(initialScrollAuthority(), "awayFromBottom", true)
    const heading = recordGestureIntent(detached, "towardBottom", true)
    expect(heading.following).toBe(false)
    expect(heading.intent).toBe("towardBottom")
    // Arrival at the bottom (the echo's geometry) grants it back.
    expect(applyScrollEvent(heading, BOTTOM, "user").following).toBe(true)
  })

  it("a no-direction gesture changes nothing", () => {
    const state = initialScrollAuthority()
    expect(recordGestureIntent(state, "none", true)).toBe(state)
  })
})

describe("applyScrollEvent (echo classification)", () => {
  it("a user scroll decides by its landing point: at bottom ⇔ follow", () => {
    const state = initialScrollAuthority()
    expect(applyScrollEvent(state, ABOVE, "user").following).toBe(false)
    expect(applyScrollEvent(state, BOTTOM, "user").following).toBe(true)
  })

  it("a programmatic echo only advances the ledger — it never steals authority", () => {
    const detached = recordGestureIntent(initialScrollAuthority(), "awayFromBottom", true)
    const echoed = applyScrollEvent(detached, metrics(900), "programmatic")
    expect(echoed.following).toBe(false)
    expect(echoed.ledgerScrollTop).toBe(900)
    // And a pending intent survives a programmatic echo (it belongs to a
    // gesture whose own event has not landed yet).
    expect(echoed.intent).toBe("awayFromBottom")
  })

  it("a user scroll consumes the pending intent (its echo has landed)", () => {
    const withIntent = recordGestureIntent(initialScrollAuthority(), "towardBottom", true)
    const landed = applyScrollEvent(withIntent, ABOVE, "user")
    expect(landed.intent).toBe("none")
    expect(landed.following).toBe(false)
  })

  it("repeated identical user verdicts are stable (same object)", () => {
    const attached = applyScrollEvent(initialScrollAuthority(), BOTTOM, "user")
    expect(applyScrollEvent(attached, BOTTOM, "user")).toBe(attached)
  })
})

describe("reconcileForStickyCommit (commit vs the dispatch window)", () => {
  it("a detached reader is never stuck over (rule 1) — the gesture channel already detached", () => {
    const wheeling = recordGestureIntent(initialScrollAuthority(), "awayFromBottom", true)
    const verdict = reconcileForStickyCommit(wheeling, metrics(600))
    expect(verdict.stick).toBe(false)
    expect(verdict.state.following).toBe(false)
    // The pending intent survives the hold — the reader's echo scroll
    // event consumes it (applyScrollEvent's user branch).
    expect(verdict.state.intent).toBe("awayFromBottom")
  })

  it("an unobserved upscroll (live scrollTop regressed past the ledger) yields (rule 2)", () => {
    const state: ScrollAuthorityState = { following: true, ledgerScrollTop: 1000, intent: "none" }
    const verdict = reconcileForStickyCommit(
      state,
      metrics(1000 - UNOBSERVED_SCROLL_EPSILON_PX - 1),
    )
    expect(verdict.stick).toBe(false)
    expect(verdict.state.following).toBe(false)
    expect(verdict.state.ledgerScrollTop).toBe(997)
    expect(verdict.state.intent).toBe("none")
  })

  it("sub-pixel regressions are jitter, not an upscroll", () => {
    const state: ScrollAuthorityState = { following: true, ledgerScrollTop: 1000, intent: "none" }
    const verdict = reconcileForStickyCommit(state, metrics(1000 - UNOBSERVED_SCROLL_EPSILON_PX))
    expect(verdict.stick).toBe(true)
    expect(verdict.state.following).toBe(true)
  })

  it("no gesture + no regression → stick, following unchanged (rule 3)", () => {
    const state = initialScrollAuthority()
    const verdict = reconcileForStickyCommit(state, metrics(0))
    expect(verdict.stick).toBe(true)
    expect(verdict.state).toBe(state)
  })
})

describe("streaming commit ↔ wheel-up interleave (the swallow fix, end to end)", () => {
  it("a wheel-up between commits is never yanked back to the tail", () => {
    // Attached, mid-stream.
    let state = applyScrollEvent(initialScrollAuthority(), BOTTOM, "user")
    expect(state.following).toBe(true)

    // The reader wheels up. The echo scroll event has not landed yet.
    state = recordGestureIntent(state, wheelScrollIntent(-120), true)
    expect(state.following).toBe(false)

    // A streaming commit lands INSIDE the dispatch window: the old code
    // stuck with the stale following=true and dragged the reader back.
    const commit = reconcileForStickyCommit(state, metrics(600))
    expect(commit.stick).toBe(false)

    // The reader's echo lands: detached, intent consumed, ledger current.
    state = applyScrollEvent(commit.state, metrics(600), "user")
    expect(state.following).toBe(false)
    expect(state.intent).toBe("none")

    // Further streaming commits hold the reading position.
    expect(reconcileForStickyCommit(state, metrics(600, 500, 2200)).stick).toBe(false)

    // Recovery: wheel down, land at the bottom → follow again, commits
    // stick again.
    state = recordGestureIntent(state, wheelScrollIntent(120), true)
    state = applyScrollEvent(state, BOTTOM, "user")
    expect(state.following).toBe(true)
    expect(reconcileForStickyCommit(state, metrics(1500, 500, 2400)).stick).toBe(true)
  })
})

describe("reattachToTail / jump affordance", () => {
  it("re-attaches and clears the intent without touching the ledger", () => {
    const detached = recordGestureIntent(initialScrollAuthority(), "awayFromBottom", true)
    const reattached = reattachToTail({ ...detached, ledgerScrollTop: 900 })
    expect(reattached.following).toBe(true)
    expect(reattached.intent).toBe("none")
    expect(reattached.ledgerScrollTop).toBe(900)
  })

  it("is a no-op when already following cleanly (same object)", () => {
    const state = initialScrollAuthority()
    expect(reattachToTail(state)).toBe(state)
  })

  it.each([
    [true, 0, false],
    [true, 5, false],
    [false, 0, false], // nothing pending — scrolling down is all it takes
    [false, 5, true],
  ])("shouldShowBackToBottom(following=%s, rows=%i) → %s", (following, rows, expected) => {
    expect(shouldShowBackToBottom(following, rows)).toBe(expected)
  })
})

describe("prepend anchor compensation (generic load-older model, unwired)", () => {
  it("a real prepend shifts scrollTop by the prepended height", () => {
    expect(
      prependScrollAdjustment({
        prevFirstKey: "t5",
        nextFirstKey: "t0",
        prevTotalSize: 1000,
        nextTotalSize: 1400,
      }),
    ).toBe(400)
  })

  it("appends / replaces / clears / first renders never move the scroll", () => {
    expect(
      prependScrollAdjustment({
        prevFirstKey: "t0",
        nextFirstKey: "t5",
        prevTotalSize: 1000,
        nextTotalSize: 1400,
      }),
    ).toBeNull()
    expect(
      prependScrollAdjustment({
        prevFirstKey: "t5",
        nextFirstKey: "t5",
        prevTotalSize: 1000,
        nextTotalSize: 1400,
      }),
    ).toBeNull()
    expect(
      prependScrollAdjustment({
        prevFirstKey: null,
        nextFirstKey: "t0",
        prevTotalSize: 0,
        nextTotalSize: 100,
      }),
    ).toBeNull()
    expect(
      prependScrollAdjustment({
        prevFirstKey: "t0",
        nextFirstKey: null,
        prevTotalSize: 100,
        nextTotalSize: 0,
      }),
    ).toBeNull()
  })

  it("a shrinking or non-finite total is not a prepend", () => {
    expect(
      prependScrollAdjustment({
        prevFirstKey: "t5",
        nextFirstKey: "t0",
        prevTotalSize: 1000,
        nextTotalSize: 800,
      }),
    ).toBeNull()
    expect(
      prependScrollAdjustment({
        prevFirstKey: "t5",
        nextFirstKey: "t0",
        prevTotalSize: Number.NaN,
        nextTotalSize: 1400,
      }),
    ).toBeNull()
  })

  it("the anchor-offset form restores a snapshot position across intervening writes", () => {
    // Pixel semantics (ZCode v4): `start` is the anchor's stream offset in
    // px, `offsetTop` its viewport-relative top edge. Prepend moves the
    // anchor from 1000px to 1400px; the restore target is 1400 − 120, so
    // from a live scrollTop of 500 the write is +780.
    const previous = { key: "t3", offsetTop: 120, start: 1000 }
    const next = { key: "t3", offsetTop: 260, start: 1400 }
    expect(prependAnchorAdjustment(previous, next, 500)).toBe(780)
    expect(prependAnchorAdjustment(previous, { ...next, key: "t4" }, 500)).toBeNull()
    expect(prependAnchorAdjustment(previous, next, Number.NaN)).toBeNull()
    expect(prependAnchorAdjustment({ ...previous, offsetTop: Number.NaN }, next, 500)).toBeNull()
  })
})
