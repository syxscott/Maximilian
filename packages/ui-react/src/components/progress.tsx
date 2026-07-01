import * as React from "react"
import { cn } from "../lib/utils"

export interface ProgressProps {
  value?: number
  min?: number
  max?: number
  children?: React.ReactNode
  className?: string
  hideLabel?: boolean
  showValueLabel?: boolean
  getValueLabel?: (value: number, max: number) => string
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(function Progress(props, ref) {
  const {
    value = 0,
    min = 0,
    max = 100,
    children,
    className,
    hideLabel,
    showValueLabel,
    getValueLabel,
  } = props

  const percentage = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
  const valueLabel = getValueLabel
    ? getValueLabel(value, max)
    : `${Math.round(percentage)}%`

  return (
    <div
      ref={ref}
      data-component="progress"
      role="progressbar"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueLabel}
      className={cn("flex w-full flex-col gap-2", className)}
    >
      {(children || showValueLabel) && (
        <div data-slot="progress-header" className="flex items-center justify-between gap-2">
          {children && (
            <span
              data-slot="progress-label"
              className={cn("text-sm font-medium", hideLabel && "sr-only")}
            >
              {children}
            </span>
          )}
          {showValueLabel && (
            <span data-slot="progress-value-label" className="text-sm tabular-nums text-muted-foreground">
              {valueLabel}
            </span>
          )}
        </div>
      )}
      <div
        data-slot="progress-track"
        className="relative h-2 w-full overflow-hidden rounded-full bg-primary/20"
      >
        <div
          data-slot="progress-fill"
          className="h-full bg-primary transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
})