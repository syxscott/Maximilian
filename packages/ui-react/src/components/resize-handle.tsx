import * as React from "react"
import { cn } from "../lib/utils"

export interface ResizeHandleProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onResize"> {
  direction: "horizontal" | "vertical"
  edge?: "start" | "end"
  size: number
  min: number
  max: number
  onResize: (size: number) => void
  onCollapse?: () => void
  collapseThreshold?: number
}

export const ResizeHandle = React.forwardRef<HTMLDivElement, ResizeHandleProps>(function ResizeHandle(
  props,
  ref,
) {
  const {
    direction,
    edge,
    size,
    min,
    max,
    onResize,
    onCollapse,
    collapseThreshold,
    className,
    ...rest
  } = props

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      const resolvedEdge = edge ?? (direction === "vertical" ? "start" : "end")
      const start = direction === "horizontal" ? e.clientX : e.clientY
      const startSize = size
      let current = startSize

      document.body.style.userSelect = "none"
      document.body.style.overflow = "hidden"

      const onMouseMove = (moveEvent: MouseEvent) => {
        const pos = direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY
        const delta =
          direction === "vertical"
            ? resolvedEdge === "end"
              ? pos - start
              : start - pos
            : resolvedEdge === "start"
              ? start - pos
              : pos - start
        current = startSize + delta
        const clamped = Math.min(max, Math.max(min, current))
        onResize(clamped)
      }

      const onMouseUp = () => {
        document.body.style.userSelect = ""
        document.body.style.overflow = ""
        document.removeEventListener("mousemove", onMouseMove)
        document.removeEventListener("mouseup", onMouseUp)

        const threshold = collapseThreshold ?? 0
        if (onCollapse && threshold > 0 && current < threshold) {
          onCollapse()
        }
      }

      document.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseup", onMouseUp)
    },
    [direction, edge, size, min, max, onResize, onCollapse, collapseThreshold],
  )

  return (
    <div
      ref={ref}
      data-component="resize-handle"
      data-direction={direction}
      data-edge={edge ?? (direction === "vertical" ? "start" : "end")}
      className={cn(
        "shrink-0 select-none touch-none",
        direction === "horizontal"
          ? "cursor-col-resize"
          : edge === "start" || (edge === undefined && direction === "vertical")
            ? "cursor-row-resize"
            : "cursor-row-resize",
        className,
      )}
      onMouseDown={handleMouseDown}
      {...rest}
    />
  )
})