import * as React from "react"
import { cn } from "../lib/utils.js"

export interface LoadingSkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Width. Accepts a number (px) or any CSS unit. */
  width?: number | string
  /** Height. Accepts a number (px) or any CSS unit. */
  height?: number | string
  /** Shape variant. */
  variant?: "text" | "circular" | "rectangular" | "rounded"
  /** Number of lines to render (text variant only). */
  lines?: number
  /** When true, runs the shimmer animation. */
  animate?: boolean
}

function toSize(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === "number" ? `${value}px` : value
}

const SkeletonBar = React.forwardRef<HTMLDivElement, LoadingSkeletonProps>(function SkeletonBar(
  { width, height, variant = "text", animate = true, className, style, ...rest },
  ref,
) {
  const shape =
    variant === "circular"
      ? "rounded-full"
      : variant === "rectangular"
        ? ""
        : variant === "rounded"
          ? "rounded-md"
          : "rounded-sm"

  return (
    <div
      ref={ref}
      data-component="loading-skeleton"
      data-variant={variant}
      data-animate={animate ? true : undefined}
      className={cn(
        "bg-muted",
        shape,
        animate && "animate-pulse",
        className,
      )}
      style={{
        width: toSize(width),
        height: toSize(height ?? (variant === "text" ? "0.85em" : undefined)),
        ...style,
      }}
      {...rest}
    />
  )
})

export const LoadingSkeleton = Object.assign(SkeletonBar, {
  /** Convenience: render a stack of text-line skeletons. */
  Text: React.forwardRef<HTMLDivElement, Omit<LoadingSkeletonProps, "variant" | "lines"> & {
    lines?: number
    gap?: number
  }>(function LoadingSkeletonText({ lines = 3, gap = 6, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        role="status"
        aria-busy="true"
        aria-live="polite"
        className={cn("flex flex-col", className)}
        style={{ gap }}
      >
        {Array.from({ length: lines }, (_, i) => (
          <SkeletonBar
            key={i}
            variant="text"
            width={i === lines - 1 ? "60%" : "100%"}
            {...rest}
          />
        ))}
      </div>
    )
  }),
})
