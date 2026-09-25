import * as React from "react"
import { cn } from "../lib/utils.js"

export interface SpinnerRingProps extends React.SVGAttributes<SVGSVGElement> {
  size?: "xs" | "sm" | "md" | "lg"
  speed?: "slow" | "normal" | "fast"
  /** Accessible label; defaults to "Loading". */
  label?: string
}

const SIZE_CLASSES: Record<NonNullable<SpinnerRingProps["size"]>, string> = {
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
}

const SPEED_SECONDS: Record<NonNullable<SpinnerRingProps["speed"]>, string> = {
  slow: "1.6s",
  normal: "0.8s",
  fast: "0.45s",
}

/** Indeterminate circular loading indicator with size and speed variants. */
export const SpinnerRing = React.forwardRef<SVGSVGElement, SpinnerRingProps>(function SpinnerRing(
  { size = "sm", speed = "normal", label = "Loading", className, style, ...rest },
  ref,
) {
  const radius = 10
  const circumference = 2 * Math.PI * radius
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label={label}
      data-component="spinner-ring"
      data-size={size}
      data-speed={speed}
      className={cn("animate-spin text-muted-foreground", SIZE_CLASSES[size], className)}
      style={{ animationDuration: SPEED_SECONDS[speed], ...style }}
      {...rest}
    >
      <circle
        data-slot="spinner-ring-track"
        cx="12"
        cy="12"
        r={radius}
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <circle
        data-slot="spinner-ring-arc"
        cx="12"
        cy="12"
        r={radius}
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * 0.72}
      />
    </svg>
  )
})
