import * as React from "react"
import { cn } from "../lib/utils.js"

export interface ProgressCircleProps extends Omit<React.SVGAttributes<SVGSVGElement>, "className"> {
  percentage: number
  size?: number
  strokeWidth?: number
  className?: string
}

export const ProgressCircle = React.forwardRef<SVGSVGElement, ProgressCircleProps>(function ProgressCircle(
  props,
  ref,
) {
  const { percentage, size = 16, strokeWidth = 3, className, ...rest } = props

  const viewBoxSize = 16
  const center = viewBoxSize / 2
  const radius = center - strokeWidth / 2
  const circumference = 2 * Math.PI * radius

  const clampedPercentage = Math.max(0, Math.min(100, percentage || 0))
  const progress = clampedPercentage / 100
  const offset = circumference * (1 - progress)

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      fill="none"
      data-component="progress-circle"
      className={cn(className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampedPercentage}
      {...rest}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        data-slot="progress-circle-background"
        strokeWidth={strokeWidth}
        className="stroke-primary/20"
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        data-slot="progress-circle-progress"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference.toString()}
        strokeDashoffset={offset}
        className="stroke-primary transition-[stroke-dashoffset] duration-300"
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  )
})