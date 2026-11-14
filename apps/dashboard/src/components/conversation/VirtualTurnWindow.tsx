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
 * Live-tail split (ZCode v4 conversationTimelineLiveTail borrowing):
 * `tailUnits` renders in NORMAL flow after the spacer — the host routes
 * the stream's LAST turn here (splitLiveTail) so a streaming tail grows
 * its DOM natively instead of inside a virtual row whose
 * totalSize/scrollTop backfill lags a frame behind. Position decides
 * the container, never a running flag: a turn keeps its component
 * through Stop and only enters the band when a newer turn appears.
 *
 * Measurement (ZCode v4 timelineRowHeightCache borrowing): a
 * ResizeObserver reports each rendered row's real box through
 * `onMeasure` (keyed by the row's stable key) — the host caches real
 * heights per turn so virtualizer resets and remounts keep them, and
 * the height list converges to the rendered truth.
 *
 * Shared ownership: the timeline passes its own `containerRef` through,
 * so live-tail (auto-bottom, jump-to-latest) and the anchor navigation
 * keep driving the SAME scrolling element they always have, and the
 * onScroll passthrough keeps the detach/freeze machinery wired. The
 * anchor jump marks its scrollTop write through `markProgrammaticScroll`
 * so the host's scroll-authority ledger treats the echo as programmatic
 * (a navigation never reads as a user detach).
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
  tailUnits,
  onMeasure,
  markProgrammaticScroll,
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
  /** Normal-flow rows after the spacer — the live tail (splitLiveTail). */
  tailUnits?: T[]
  /** Real-height report: (stable key, border-box height px, width px). */
  onMeasure?: (key: string, heightPx: number, widthPx: number) => void
  /** Called right before this component's own scrollTop writes (anchor jumps). */
  markProgrammaticScroll?: (targetTop: number) => void
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
  // when the environment never fires the follow-up scroll event. The
  // write is announced first — its echo must ledger as programmatic.
  // The announce callback rides a ref: band identities are stable now,
  // and the effect must not resubscribe per render.
  const markProgrammaticRef = useRef(markProgrammaticScroll)
  markProgrammaticRef.current = markProgrammaticScroll
  useEffect(() => {
    if (anchorIndex === undefined) return
    const el = elRef.current
    if (!el) return
    const target = scrollOffsetForUnit(units, heights, anchorIndex)
    markProgrammaticRef.current?.(target)
    el.scrollTop = target
    setScrollTop(el.scrollTop)
  }, [anchorIndex, units, heights, elRef])

  const win = useMemo(
    () => virtualWindow(units, heights, scrollTop, viewportHeight ?? measured, overscan),
    [units, heights, scrollTop, viewportHeight, measured, overscan],
  )

  // Row measurement (borrowing: ZCode v4 timelineRowHeightCache wiring).
  // The observer lives for the component's lifetime; the latest onMeasure
  // rides a ref so band changes never resubscribe it. It is created
  // LAZILY in the row-attach callback — callback refs run before any
  // effect, so the initially mounted band is observed too. Rows detach
  // through the React 19 ref cleanup; the unmount effect disconnects.
  const onMeasureRef = useRef(onMeasure)
  onMeasureRef.current = onMeasure
  const observerRef = useRef<ResizeObserver | null>(null)
  useEffect(
    () => () => {
      observerRef.current?.disconnect()
      observerRef.current = null
    },
    [],
  )
  const attachRow = (el: HTMLDivElement | null) => {
    if (!el) return
    let observer = observerRef.current
    if (observer === null) {
      if (typeof ResizeObserver !== "function") return
      observer = new ResizeObserver((entries) => {
        const report = onMeasureRef.current
        if (!report) return
        for (const entry of entries) {
          const target = entry.target as HTMLElement
          const key = target.dataset.virtualKey ?? ""
          if (key === "") continue
          const box = entry.borderBoxSize?.[0]
          const heightPx = box ? box.blockSize : target.offsetHeight
          const widthPx = box ? box.inlineSize : target.offsetWidth
          if (heightPx > 0) report(key, heightPx, widthPx)
        }
      })
      observerRef.current = observer
    }
    observer.observe(el)
    return () => observer.unobserve(el)
  }

  const tailCount = tailUnits?.length ?? 0
  if (units.length === 0 && tailCount === 0) {
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
    const key = getKey ? getKey(unit, i) : String(i)
    rows.push(
      <div
        key={key}
        ref={attachRow}
        data-virtual-index={i}
        data-virtual-key={key}
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

  // The normal-flow tail (splitLiveTail): AFTER the spacer, no absolute
  // positioning — its height is the browser's own reflow, no backfill.
  const tailRows: ReactNode[] = []
  for (let i = 0; i < tailCount; i++) {
    const unit = tailUnits?.[i]
    if (unit === undefined) continue
    const index = units.length + i
    const key = getKey ? getKey(unit, index) : String(index)
    tailRows.push(
      <div key={key} ref={attachRow} data-virtual-index={index} data-virtual-key={key}>
        {renderUnit(unit, index)}
      </div>,
    )
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
      {tailRows}
    </div>
  )
}
