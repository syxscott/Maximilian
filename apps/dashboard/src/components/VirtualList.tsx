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

import { ReactNode } from "react";
import { List } from "react-window";
import { usePerfTier } from "@/lib/perf-tier";

const VIRTUALIZE_THRESHOLD = 50;

export interface VirtualListProps<T> {
  items: ReadonlyArray<T>;
  itemHeight: number;
  height: number | string;
  className?: string;
  /** Render a single row. The wrapper passes index + item + style. */
  renderRow: (item: T, index: number, style: React.CSSProperties) => ReactNode;
  /** Override the virtualization decision (e.g. force-on for tests). */
  forceVirtualized?: boolean;
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  const { items, itemHeight, height, className, renderRow, forceVirtualized } = props;
  const { effective } = usePerfTier();

  const shouldVirtualize =
    forceVirtualized || items.length >= VIRTUALIZE_THRESHOLD || effective === "low";

  if (!shouldVirtualize) {
    return (
      <div className={className} style={{ height }}>
        {items.map((item, index) => (
          <div key={index}>{renderRow(item, index, {})}</div>
        ))}
      </div>
    );
  }

  return (
    <List
      className={className}
      defaultHeight={typeof height === "number" ? height : 600}
      rowCount={items.length}
      rowHeight={itemHeight}
      rowProps={{}}
      rowComponent={({ index, style, ariaAttributes }) => {
        const item = items[index]!;
        return (
          <div style={style} {...ariaAttributes}>
            {renderRow(item, index, style)}
          </div>
        );
      }}
      style={{ height: typeof height === "string" ? height : `${height}px` }}
    />
  );
}