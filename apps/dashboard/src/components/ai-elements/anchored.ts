// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Anchored-overlay positioning primitives (chat-demo base/anchored.ts
 * borrowing — only the parts the hover preview chain needs; the portal
 * panel mounts on `document.body` with `position: fixed`, so it must
 * measure itself after mount and re-measure when anything moves it).
 *
 * `useAnchoredPosition`: places a floating panel relative to a trigger
 * element, flipping to the other side when the preferred one doesn't fit.
 * `useDelayedOpen`: enter/leave delay scheduling with a single pending
 * toggle (hover-card semantics — moving from trigger into the card must
 * not close it).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react"

/** Minimum gap between the panel and the viewport edges. */
export const VIEWPORT_PADDING = 8

export type Side = "top" | "bottom"
export type Align = "start" | "center" | "end"

export interface AnchoredPosition {
  top: number
  left?: number
  right?: number
  maxHeight?: number
}

export interface AnchoredOptions {
  /** Preferred side; flips when that side can't fit the panel. */
  side?: Side
  /** Horizontal alignment relative to the trigger. */
  align?: Align
  /** Extra horizontal offset, applied before viewport clamping. */
  alignOffset?: number
  /** Gap between the panel and the trigger. */
  offset?: number
  /** Minimum vertical space that counts as "fits" for the flip decision. */
  minSpace?: number
}

const clampLeft = (left: number, width: number): number =>
  Math.max(VIEWPORT_PADDING, Math.min(left, window.innerWidth - width - VIEWPORT_PADDING))

const alignLeft = (anchor: DOMRect, width: number, align: Align, alignOffset: number): number => {
  if (align === "center") {
    return clampLeft(anchor.left + anchor.width / 2 - width / 2 + alignOffset, width)
  }
  if (align === "end") {
    return Math.max(VIEWPORT_PADDING, anchor.right - width + alignOffset)
  }
  return clampLeft(anchor.left + alignOffset, width)
}

/**
 * Only one side fits → use it; both fit → use the preferred one; neither
 * fits → the side with more room (chat-demo resolveSide parity).
 */
const resolveSide = (
  spaceAbove: number,
  spaceBelow: number,
  preferred: Side,
  needed: number,
): Side => {
  const fitsAbove = spaceAbove >= needed
  const fitsBelow = spaceBelow >= needed
  if (fitsAbove && !fitsBelow) return "top"
  if (fitsBelow && !fitsAbove) return "bottom"
  if (fitsAbove) return preferred
  return spaceAbove > spaceBelow ? "top" : "bottom"
}

/**
 * Position a floating panel relative to a trigger element. The panel is
 * mounted on body with fixed viewport coordinates, so its size is only
 * known after mount — `position` is null until the first measurement.
 */
export const useAnchoredPosition = <T extends HTMLElement, F extends HTMLElement>(
  open: boolean,
  {
    side = "bottom",
    align = "start",
    alignOffset = 0,
    offset = 4,
    minSpace = 160,
  }: AnchoredOptions = {},
) => {
  const anchorRef = useRef<T | null>(null) as MutableRefObject<T | null>
  const floatingRef = useRef<F | null>(null) as MutableRefObject<F | null>
  const [position, setPosition] = useState<AnchoredPosition | null>(null)

  // Skip the state update when nothing actually moved (avoids re-render churn).
  const applyPosition = useCallback((next: AnchoredPosition) => {
    setPosition((previous) =>
      previous &&
      previous.top === next.top &&
      previous.left === next.left &&
      previous.right === next.right &&
      previous.maxHeight === next.maxHeight
        ? previous
        : next,
    )
  }, [])

  const update = useCallback(() => {
    const anchor = anchorRef.current
    const floating = floatingRef.current
    if (!anchor || !floating) return
    const rect = anchor.getBoundingClientRect()
    const spaceAbove = rect.top - offset - VIEWPORT_PADDING
    const spaceBelow = window.innerHeight - rect.bottom - offset - VIEWPORT_PADDING
    const { width, height } = floating.getBoundingClientRect()
    const resolved = resolveSide(spaceAbove, spaceBelow, side, Math.max(minSpace, height))
    applyPosition({
      top: resolved === "top" ? rect.top - offset - height : rect.bottom + offset,
      left: alignLeft(rect, width, align, alignOffset),
    })
  }, [align, alignOffset, applyPosition, minSpace, offset, side])

  // Measure synchronously on open, before the first paint.
  useLayoutEffect(() => {
    if (open) update()
  }, [open, update])

  // While open, follow every source of movement rendering can't predict:
  // panel/trigger resize, window resize, any scrolling container.
  useLayoutEffect(() => {
    if (!open) return
    const floating = floatingRef.current
    if (!floating) return
    const anchor = anchorRef.current
    const observer = new ResizeObserver(() => update())
    observer.observe(floating)
    if (anchor) observer.observe(anchor)
    window.addEventListener("scroll", update, { capture: true, passive: true })
    window.addEventListener("resize", update, { passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener("scroll", update, { capture: true })
      window.removeEventListener("resize", update)
    }
  }, [open, update])

  useEffect(() => {
    if (!open) setPosition(null)
  }, [open])

  return { anchorRef, floatingRef, position }
}

/**
 * Enter/leave delay scheduling for hover panels — at most one pending
 * toggle at a time, so a quick trigger→card move cancels the close.
 */
export const useDelayedOpen = () => {
  const [open, setOpen] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const schedule = useCallback((next: boolean, delay: number) => {
    window.clearTimeout(timer.current)
    if (delay <= 0) {
      setOpen(next)
      return
    }
    timer.current = window.setTimeout(() => setOpen(next), delay)
  }, [])
  const cancel = useCallback(() => window.clearTimeout(timer.current), [])
  return { open, setOpen, schedule, cancel }
}
