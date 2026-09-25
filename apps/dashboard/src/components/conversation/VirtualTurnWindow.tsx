// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * VirtualTurnWindow — TRUE virtual scrolling over the turn stream (the
 * upgrade of ConversationWindow's windowed + placeholder-height
 * rendering): a fixed-height scrolling viewport, an inner spacer at the
 * stream's full ESTIMATED height, and only the visible band of items
 * absolutely positioned inside it (transform translateY). All window
 * arithmetic lives in the model — virtualWindow computes the visible
 * range + fill heights from the per-item estimates, scrollOffsetForUnit
 * maps an anchor index to a scroll offset — so this component only
 * renders, measures and scrolls.
 *
 * Shared ownership: the timeline passes its own `containerRef` through,
 * so live-tail (auto-bottom, jump-to-latest) and the anchor navigation
 * keep driving the SAME scrolling element they always have, and the
 * onScroll passthrough keeps the detach/freeze machinery wired.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from "react"
import { useLocale, t } from "@max/i18n"
import { DEFAULT_VIRTUAL_OVERSCAN, scrollOffsetForUnit, virtualWindow } from "./model"

export function VirtualTurnWindow<T>({
  units,
  heights,
  renderUnit,
  getKey,
  overscan = DEFAULT_VIRTUAL_OVERSCAN,
  viewportHeight,
  anchorIndex,
  containerRef,
  onScroll,
  testId = "virtual-turn-window",
  className = "min-h-0 flex-1 overflow-y-auto pr-1",
  empty,
}: {
  /** The item stream (turn models on the timeline surface). */
  units: T[]
  /** Per-item ESTIMATED pixel heights, aligned 1:1 with `units`. */
  heights: number[]
  /** Render slot: one visible item → node. */
  renderUnit: (unit: T, index: number) => ReactNode
  /** Stable React key for an item (default: its stream index). */
  getKey?: (unit: T, index: number) => string
  /** Items rendered beyond each viewport edge (default model default). */
  overscan?: number
  /** Fixed viewport px — measured clientHeight otherwise (jsdom: 0). */
  viewportHeight?: number
  /** When set/changed, the container scrolls this item to the top. */
  anchorIndex?: number
  /** External ref to the scrolling container (shared ownership). */
  containerRef?: RefObject<HTMLDivElement | null>
  /** Passthrough scroll handler (live-tail detachment on the timeline). */
  onScroll?: (event: UIEvent<HTMLDivElement>) => void
  /** data-testid of the scrolling container (spacer derives from it). */
  testId?: string
  className?: string
  /** Rendered when the stream is empty. */
  empty?: ReactNode
}) {
  useLocale()
  const localRef = useRef<HTMLDivElement | null>(null)
  const elRef = containerRef ?? localRef
  const [scrollTop, setScrollTop] = useState(0)
  const [measured, setMeasured] = useState(0)

  // Measure the viewport once on mount — jsdom reports 0, so tests (and
  // embedded contexts) can pin a viewportHeight instead.
  useEffect(() => {
    const el = elRef.current
    if (el && el.clientHeight > 0) setMeasured(el.clientHeight)
  }, [])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    setScrollTop(el.scrollTop)
    if (el.clientHeight > 0) setMeasured(el.clientHeight)
    onScroll?.(event)
  }

  // Anchor jump: scrollOffsetForUnit maps the index to the offset that
  // lands the item's top edge at the viewport top. State updates even
  // when the environment never fires the follow-up scroll event.
  useEffect(() => {
    if (anchorIndex === undefined) return
    const el = elRef.current
    if (!el) return
    el.scrollTop = scrollOffsetForUnit(units, heights, anchorIndex)
    setScrollTop(el.scrollTop)
  }, [anchorIndex, units, heights, elRef])

  const win = useMemo(
    () => virtualWindow(units, heights, scrollTop, viewportHeight ?? measured, overscan),
    [units, heights, scrollTop, viewportHeight, measured, overscan],
  )

  if (units.length === 0) {
    return empty !== undefined ? <div data-testid={`${testId}-empty`}>{empty}</div> : null
  }

  // The visible band: each row pinned to its cumulative estimate via
  // translateY. minHeight (not height) keeps underestimated rows from
  // clipping — the same anti-jump trade the placeholder bars make.
  const rows: ReactNode[] = []
  let offset = win.padTop
  for (let i = win.start; i < win.end; i++) {
    const unit = units[i]
    if (unit === undefined) continue
    const h = heights[i] ?? 0
    rows.push(
      <div
        key={getKey ? getKey(unit, i) : i}
        data-virtual-index={i}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          transform: `translateY(${offset}px)`,
          minHeight: h > 0 ? h : undefined,
        }}
      >
        {renderUnit(unit, i)}
      </div>,
    )
    offset += h
  }

  return (
    <div
      ref={elRef}
      className={className}
      data-testid={testId}
      aria-label={t("conversation.virtual.label")}
      onScroll={handleScroll}
    >
      <div
        data-testid={`${testId}-spacer`}
        data-total-height={win.total}
        data-window-start={win.start}
        data-window-end={win.end}
        style={{ height: win.total, position: "relative", width: "100%" }}
      >
        {rows}
      </div>
    </div>
  )
}
