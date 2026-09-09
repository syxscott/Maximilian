/**
 * VirtualList — react-window v2 wrapper that picks the right renderer based
 * on perf tier and item count.
 *
 *   - high tier + < THRESHOLD items  → plain children (no overhead)
 *   - low tier  or  ≥ THRESHOLD items → `List` from react-window
 *
 * react-window v2 API: pass a `rowComponent` that receives
 * `{ ariaAttributes, index, style }`. Extra props go through `rowProps`.
 */

import { ReactNode } from "react"
import { List } from "react-window"
import { usePerfTier } from "@/lib/perf-tier"

const VIRTUALIZE_THRESHOLD = 50

export interface VirtualListProps<T> {
  items: ReadonlyArray<T>
  itemHeight: number
  height: number | string
  className?: string
  /** Render a single row. The wrapper passes index + item + style. */
  renderRow: (item: T, index: number, style: React.CSSProperties) => ReactNode
  /** Override the virtualization decision (e.g. force-on for tests). */
  forceVirtualized?: boolean
  /**
   * Optional stable key extractor. When provided, rows are keyed by this
   * instead of their array index so list mutations don't trigger React to
   * reorder DOM nodes (which kills focus, animation, and inside-row state
   * for items that aren't `index`-keyed). Falls back to `index` when not
   * provided — fine for static lists, risky for mutating ones.
   */
  getItemKey?: (item: T, index: number) => React.Key
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  const { items, itemHeight, height, className, renderRow, forceVirtualized, getItemKey } = props
  const { effective } = usePerfTier()

  const shouldVirtualize =
    forceVirtualized || items.length >= VIRTUALIZE_THRESHOLD || effective === "low"

  if (!shouldVirtualize) {
    return (
      <div className={className} style={{ height }}>
        {items.map((item, index) => (
          <div key={getItemKey ? getItemKey(item, index) : index}>{renderRow(item, index, {})}</div>
        ))}
      </div>
    )
  }

  // react-window's `defaultHeight` only accepts a number; it sizes the
  // scroll viewport *before* the CSS `height` is measured. For string
  // heights like "calc(100vh - 12rem)" or "60vh" we estimate a sensible
  // fallback so the initial paint isn't blank. The CSS `style.height`
  // below takes over as soon as the resize observer fires.
  const numericDefaultHeight = typeof height === "number" ? height : estimateHeight(height)

  return (
    <List
      className={className}
      defaultHeight={numericDefaultHeight}
      rowCount={items.length}
      rowHeight={itemHeight}
      rowProps={{}}
      rowComponent={({ index, style, ariaAttributes }) => {
        const item = items[index]
        if (item === undefined) {
          // Defensive: react-window may call us with an out-of-range index
          // during fast scroll. Skip rather than render `undefined` and
          // trip React's "object is not a valid React child" check.
          return null
        }
        return (
          <div key={getItemKey ? getItemKey(item, index) : index} style={style} {...ariaAttributes}>
            {renderRow(item, index, style)}
          </div>
        )
      }}
      style={{ height: typeof height === "string" ? height : `${height}px` }}
    />
  )
}

/**
 * Best-effort pixel estimate for a CSS height expression. Used only for
 * react-window's pre-measure `defaultHeight`, so a rough heuristic is
 * fine — the actual layout uses the CSS `style.height` we set below.
 *
 * Supports:
 *   - "600px" → 600
 *   - "60vh" → 60% of (heuristic) viewport (use 1024 as a sensible default
 *     for desktop, capped at 1200)
 *   - "calc(100vh - 12rem)" → vh portion only
 *   - anything else → 600 fallback
 */
function estimateHeight(height: string | number): number {
  if (typeof height === "number") return height
  const trimmed = height.trim()
  // Pure pixel value
  const pxMatch = trimmed.match(/^(\d+(?:\.\d+)?)px$/)
  if (pxMatch) return Math.round(parseFloat(pxMatch[1] ?? "0"))
  // vh value (extract the percentage)
  const vhMatch = trimmed.match(/(\d+(?:\.\d+)?)vh/)
  if (vhMatch) {
    const pct = parseFloat(vhMatch[1] ?? "0")
    // Use a generous desktop estimate; the real viewport is read on the
    // next render via the resize observer.
    const approxViewport = 1024
    return Math.min(1200, Math.max(120, Math.round((pct / 100) * approxViewport)))
  }
  // rem value
  const remMatch = trimmed.match(/(\d+(?:\.\d+)?)rem/)
  if (remMatch) {
    return Math.round(parseFloat(remMatch[1] ?? "0") * 16)
  }
  return 600
}
