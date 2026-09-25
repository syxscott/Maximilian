import * as React from "react"
import { cn } from "../lib/utils.js"

export interface ResizableGridColumn {
  /** Optional stable key, only used as metadata. */
  key?: string
  /** Weight when the grid is uncontrolled. Defaults to 1. */
  initial?: number
}

export interface ResizableGridProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  columns: Array<ResizableGridColumn>
  /** Controlled column weights (fr units). */
  size?: number[]
  defaultSize?: number[]
  /** Minimum weight per column. Defaults to 0.05. */
  minColumnSize?: number
  /** Keyboard resize step in weight units. Defaults to 0.05. */
  step?: number
  onSizeChange?: (size: number[]) => void
  /** One child per column; extra children are ignored. */
  children: React.ReactNode
  /** Accessible label applied to every drag handle. */
  ariaLabel?: string
}

/**
 * Pure resize of a weight pair: move `delta` of weight between column `index`
 * and its right neighbor, keeping both at or above `min`. Values are rounded
 * to 9 decimals so float drift never leaks into controlled callbacks.
 */
export function resizeColumns(
  sizes: number[],
  index: number,
  delta: number,
  min: number,
): number[] {
  const next = [...sizes]
  const right = index + 1
  if (index < 0 || right >= next.length) return next
  const total = next[index] + next[right]
  const left = Math.min(Math.max(min, next[index] + delta), total - min)
  next[index] = Math.round(left * 1e9) / 1e9
  next[right] = Math.round((total - left) * 1e9) / 1e9
  return next
}

/**
 * Build the `grid-template-columns` value: one `fr` track per column with an
 * inline handle track between neighbors.
 */
export function buildGridTemplate(sizes: number[], handleWidth = 8): string {
  return sizes.map((size, i) => (i === 0 ? `${size}fr` : `${handleWidth}px ${size}fr`)).join(" ")
}

function defaultSizes(columns: Array<ResizableGridColumn>): number[] {
  return columns.map((column) => column.initial ?? 1)
}

export const ResizableGrid = React.forwardRef<HTMLDivElement, ResizableGridProps>(
  function ResizableGrid(props, ref) {
    const {
      columns,
      size,
      defaultSize,
      minColumnSize = 0.05,
      step = 0.05,
      onSizeChange,
      children,
      ariaLabel,
      className,
      ...rest
    } = props

    const containerRef = React.useRef<HTMLDivElement | null>(null)
    const isControlled = size !== undefined
    const [internalSizes, setInternalSizes] = React.useState(
      () => defaultSize ?? defaultSizes(columns),
    )
    const sizes = isControlled ? size : internalSizes

    const commit = React.useCallback(
      (next: number[]) => {
        if (!isControlled) setInternalSizes(next)
        onSizeChange?.(next)
      },
      [isControlled, onSizeChange],
    )

    const cells = React.Children.toArray(children)

    const startDrag = (index: number, event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      const startX = event.clientX
      const startSizes = sizes

      document.body.style.userSelect = "none"
      const onMove = (moveEvent: MouseEvent) => {
        const delta = (moveEvent.clientX - startX) / rect.width
        commit(resizeColumns(startSizes, index, delta, minColumnSize))
      }
      const onUp = () => {
        document.body.style.userSelect = ""
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    }

    const onKeyDown = (index: number, event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        commit(resizeColumns(sizes, index, -step, minColumnSize))
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        commit(resizeColumns(sizes, index, step, minColumnSize))
      }
    }

    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        containerRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      },
      [ref],
    )

    return (
      <div
        ref={setRefs}
        data-component="resizable-grid"
        className={cn("grid h-full w-full", className)}
        style={{ gridTemplateColumns: buildGridTemplate(sizes) }}
        {...rest}
      >
        {sizes.map((weight, index) => (
          <React.Fragment key={columns[index]?.key ?? index}>
            {index > 0 && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-valuemin={Math.round(minColumnSize * 100)}
                aria-valuemax={100}
                aria-valuenow={Math.round(
                  (sizes[index - 1] / sizes.reduce((sum, s) => sum + s, 0)) * 100,
                )}
                aria-label={ariaLabel}
                tabIndex={0}
                data-slot="resizable-grid-handle"
                data-index={index}
                className="cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 focus-visible:bg-primary/40 focus-visible:outline-none"
                onMouseDown={(event) => startDrag(index - 1, event)}
                onKeyDown={(event) => onKeyDown(index - 1, event)}
              />
            )}
            <div data-slot="resizable-grid-cell" className="min-w-0 overflow-hidden">
              {cells[index] ?? null}
            </div>
          </React.Fragment>
        ))}
      </div>
    )
  },
)
