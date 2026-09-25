import * as React from "react"
import { cn } from "../lib/utils.js"

export interface VisibleRange {
  startIndex: number
  /** Inclusive last index to render; -1 when the list is empty. */
  stopIndex: number
  /** Offset (px) of the first rendered item, used as the top spacer. */
  padStart: number
  totalHeight: number
  /** Cumulative offsets per item (`offsets[i]` = top edge of item i). */
  offsets: number[]
}

export interface ComputeVisibleRangeOptions {
  itemCount: number
  scrollOffset: number
  viewportHeight: number
  /** Per-item estimated heights, used until an item has been measured. */
  estimatedHeights: number[]
  /** Extra items rendered on each side of the visible window. */
  overscan?: number
  /** Measured heights by item index; wins over the estimate. */
  measuredHeights?: Record<number, number>
}

function heightAt(
  index: number,
  estimatedHeights: number[],
  measuredHeights: Record<number, number>,
): number {
  const measured = measuredHeights[index]
  if (measured !== undefined && measured > 0) return measured
  const estimate = estimatedHeights[index]
  return estimate > 0 ? estimate : 0
}

/**
 * Pure windowing math: given the scroll position, the viewport and the
 * (estimated + measured) item heights, compute which items to render.
 */
export function computeVisibleRange(options: ComputeVisibleRangeOptions): VisibleRange {
  const {
    itemCount,
    scrollOffset,
    viewportHeight,
    estimatedHeights,
    overscan = 3,
    measuredHeights = {},
  } = options

  if (itemCount <= 0) {
    return { startIndex: 0, stopIndex: -1, padStart: 0, totalHeight: 0, offsets: [0] }
  }

  const offsets: number[] = new Array(itemCount + 1)
  offsets[0] = 0
  for (let i = 0; i < itemCount; i++) {
    offsets[i + 1] = offsets[i] + heightAt(i, estimatedHeights, measuredHeights)
  }
  const totalHeight = offsets[itemCount]

  // First item whose bottom edge is below the scroll offset.
  let lo = 0
  let hi = itemCount - 1
  let first = 0
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (offsets[mid + 1] > scrollOffset) {
      first = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }

  let last = first
  while (last < itemCount && offsets[last] < scrollOffset + viewportHeight) last++

  return {
    startIndex: Math.max(0, first - overscan),
    stopIndex: Math.min(itemCount - 1, last - 1 + overscan),
    padStart: offsets[Math.max(0, first - overscan)],
    totalHeight,
    offsets,
  }
}

export interface VirtualListEnhancedProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  /** Estimated height (px) for an item before it has been measured. */
  estimateItemHeight: (item: T, index: number) => number
  itemKey?: (item: T, index: number) => string | number
  overscan?: number
  /** Fixed container height; a number is treated as px. */
  height?: number | string
  /** Override the measured viewport height (useful in non-layout environments). */
  viewportHeight?: number
  onRangeChange?: (range: { startIndex: number; stopIndex: number }) => void
  className?: string
}

/**
 * Virtualized list with estimated heights + overscan and dynamic measurement:
 * rendered rows report their real height back and the offsets recompute, so
 * estimates only matter for rows that have never been on screen.
 */
export function VirtualListEnhanced<T>(props: VirtualListEnhancedProps<T>) {
  const {
    items,
    renderItem,
    estimateItemHeight,
    itemKey,
    overscan = 3,
    height,
    viewportHeight: viewportHeightProp,
    onRangeChange,
    className,
  } = props

  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const nodeRefs = React.useRef<Map<number, HTMLElement>>(new Map())
  const measuredRef = React.useRef<Record<number, number>>({})
  const [scrollOffset, setScrollOffset] = React.useState(0)
  const [measuredViewport, setMeasuredViewport] = React.useState(0)
  const [measurementVersion, setMeasurementVersion] = React.useState(0)

  const estimatedHeights = React.useMemo(
    () => items.map((item, index) => estimateItemHeight(item, index)),
    [items],
  )

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (container.clientHeight > 0) setMeasuredViewport(container.clientHeight)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (container.clientHeight > 0) setMeasuredViewport(container.clientHeight)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [height])

  const viewportHeight =
    measuredViewport > 0
      ? measuredViewport
      : typeof viewportHeightProp === "number"
        ? viewportHeightProp
        : 0

  const range = React.useMemo(
    () =>
      computeVisibleRange({
        itemCount: items.length,
        scrollOffset,
        viewportHeight,
        estimatedHeights,
        overscan,
        measuredHeights: measuredRef.current,
      }),
    [items.length, scrollOffset, viewportHeight, estimatedHeights, overscan, measurementVersion],
  )

  // Dynamic measurement: read real heights off the rendered rows after commit
  // and recompute when any of them diverges from the current estimate.
  React.useLayoutEffect(() => {
    let changed = false
    nodeRefs.current.forEach((node, index) => {
      const measured = node.offsetHeight
      if (measured > 0 && measuredRef.current[index] !== measured) {
        measuredRef.current[index] = measured
        changed = true
      }
    })
    if (changed) setMeasurementVersion((version) => version + 1)
  })

  React.useEffect(() => {
    onRangeChange?.({ startIndex: range.startIndex, stopIndex: range.stopIndex })
  }, [onRangeChange, range.startIndex, range.stopIndex])

  const setNode = React.useCallback((index: number) => {
    return (node: HTMLElement | null) => {
      if (node) nodeRefs.current.set(index, node)
      else nodeRefs.current.delete(index)
    }
  }, [])

  const visible: React.ReactNode[] = []
  if (items.length > 0) {
    for (let index = range.startIndex; index <= range.stopIndex; index++) {
      const item = items[index]
      const key = itemKey?.(item, index) ?? index
      visible.push(
        <div
          key={key}
          ref={setNode(index)}
          data-slot="virtual-list-item"
          data-index={index}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${range.offsets[index]}px)`,
          }}
        >
          {renderItem(item, index)}
        </div>,
      )
    }
  }

  return (
    <div
      ref={containerRef}
      data-component="virtual-list-enhanced"
      className={cn("overflow-y-auto", className)}
      style={height !== undefined ? { height: height as number | string } : undefined}
      onScroll={(event) => setScrollOffset(event.currentTarget.scrollTop)}
    >
      <div
        data-slot="virtual-list-inner"
        style={{ position: "relative", height: range.totalHeight }}
      >
        {visible}
      </div>
    </div>
  )
}
