import * as React from "react"
import { cn } from "../lib/utils.js"

export type SplitPaneDirection = "horizontal" | "vertical"

export interface SplitPaneProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onResize"> {
  /** Split axis: `horizontal` puts the first pane on the left. */
  direction?: SplitPaneDirection
  /** First pane size as a fraction of the container (0..1), controlled. */
  size?: number
  defaultSize?: number
  minSize?: number
  maxSize?: number
  /** Keyboard resize step as a fraction. */
  step?: number
  onSizeChange?: (size: number) => void
  first: React.ReactNode
  second: React.ReactNode
  /** Accessible label for the drag handle. */
  ariaLabel?: string
}

/**
 * Clamp a pane fraction into `[min, max]`. Min/max are swapped defensively so
 * an inverted range never produces NaN.
 */
export function clampSize(size: number, min: number, max: number): number {
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  return Math.min(high, Math.max(low, size))
}

export const SplitPane = React.forwardRef<HTMLDivElement, SplitPaneProps>(
  function SplitPane(props, ref) {
    const {
      direction = "horizontal",
      size,
      defaultSize = 0.5,
      minSize = 0.1,
      maxSize = 0.9,
      step = 0.05,
      onSizeChange,
      first,
      second,
      ariaLabel,
      className,
      ...rest
    } = props

    const containerRef = React.useRef<HTMLDivElement | null>(null)
    const isControlled = size !== undefined
    const [internalSize, setInternalSize] = React.useState(defaultSize)
    const current = clampSize(isControlled ? size : internalSize, minSize, maxSize)

    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        containerRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      },
      [ref],
    )

    const commit = React.useCallback(
      (next: number) => {
        const clamped = clampSize(next, minSize, maxSize)
        if (!isControlled) setInternalSize(clamped)
        onSizeChange?.(clamped)
      },
      [isControlled, minSize, maxSize, onSizeChange],
    )

    const startDrag = (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const extent = direction === "horizontal" ? rect.width : rect.height
      if (extent <= 0) return
      const startPos = direction === "horizontal" ? event.clientX : event.clientY
      const startSize = current

      document.body.style.userSelect = "none"
      const onMove = (moveEvent: MouseEvent) => {
        const pos = direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY
        commit(startSize + (pos - startPos) / extent)
      }
      const onUp = () => {
        document.body.style.userSelect = ""
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    }

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      const forward =
        direction === "horizontal"
          ? { decrease: "ArrowLeft", increase: "ArrowRight" }
          : { decrease: "ArrowUp", increase: "ArrowDown" }
      if (event.key === forward.decrease) {
        event.preventDefault()
        commit(current - step)
      } else if (event.key === forward.increase) {
        event.preventDefault()
        commit(current + step)
      } else if (event.key === "Home") {
        event.preventDefault()
        commit(minSize)
      } else if (event.key === "End") {
        event.preventDefault()
        commit(maxSize)
      }
    }

    const percent = Math.round(current * 10000) / 100

    return (
      <div
        ref={setRefs}
        data-component="split-pane"
        data-direction={direction}
        className={cn(
          "flex h-full w-full",
          direction === "horizontal" ? "flex-row" : "flex-col",
          className,
        )}
        {...rest}
      >
        <div
          data-slot="split-pane-first"
          className="min-h-0 min-w-0 overflow-hidden"
          style={{ flexBasis: `${percent}%` }}
        >
          {first}
        </div>
        <div
          role="separator"
          aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
          aria-valuemin={Math.round(minSize * 100)}
          aria-valuemax={Math.round(maxSize * 100)}
          aria-valuenow={Math.round(percent)}
          aria-label={ariaLabel}
          tabIndex={0}
          data-slot="split-pane-handle"
          className={cn(
            "shrink-0 select-none touch-none bg-border transition-colors hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            direction === "horizontal" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
          )}
          onMouseDown={startDrag}
          onKeyDown={onKeyDown}
        />
        <div data-slot="split-pane-second" className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {second}
        </div>
      </div>
    )
  },
)
