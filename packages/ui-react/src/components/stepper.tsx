import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "../lib/utils.js"

export type StepState = "completed" | "current" | "upcoming"

/**
 * Pure state resolution for a step index against the current index.
 */
export function getStepState(index: number, currentIndex: number): StepState {
  if (index < currentIndex) return "completed"
  if (index === currentIndex) return "current"
  return "upcoming"
}

export interface StepperStep {
  id?: string
  label: React.ReactNode
  description?: React.ReactNode
}

export interface StepperProps extends React.HTMLAttributes<HTMLElement> {
  steps: Array<StepperStep>
  /** Zero-based index of the current step, controlled. */
  current?: number
  defaultCurrent?: number
  onStepChange?: (index: number) => void
  /** Render steps as buttons that navigate on click. */
  clickable?: boolean
  orientation?: "horizontal" | "vertical"
  /** Accessible label factory, e.g. `(index) => \`Step ${index + 1}\``. */
  stepLabel?: (index: number, state: StepState) => string
}

export const Stepper = React.forwardRef<HTMLElement, StepperProps>(function Stepper(
  {
    steps,
    current,
    defaultCurrent = 0,
    onStepChange,
    clickable,
    orientation = "horizontal",
    stepLabel,
    className,
    ...rest
  },
  ref,
) {
  const isControlled = current !== undefined
  const [internalCurrent, setInternalCurrent] = React.useState(defaultCurrent)
  const activeIndex = Math.min(
    Math.max(0, isControlled ? current : internalCurrent),
    Math.max(0, steps.length - 1),
  )

  const goTo = (index: number) => {
    if (!isControlled) setInternalCurrent(index)
    onStepChange?.(index)
  }

  return (
    <nav
      ref={ref}
      data-component="stepper"
      data-orientation={orientation}
      className={cn("flex", orientation === "horizontal" ? "flex-row" : "flex-col", className)}
      {...rest}
    >
      <ol
        className={cn("flex", orientation === "horizontal" ? "flex-row items-center" : "flex-col")}
      >
        {steps.map((step, index) => {
          const state = getStepState(index, activeIndex)
          const body = (
            <>
              <span
                aria-hidden="true"
                data-slot="stepper-indicator"
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  state === "completed" && "border-primary bg-primary text-primary-foreground",
                  state === "current" && "border-primary text-primary",
                  state === "upcoming" && "border-border text-muted-foreground",
                )}
              >
                {state === "completed" ? <Check className="h-4 w-4" /> : index + 1}
              </span>
              <span data-slot="stepper-text" className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    "text-sm leading-tight",
                    state === "upcoming" ? "text-muted-foreground" : "text-foreground font-medium",
                  )}
                >
                  {step.label}
                </span>
                {step.description && (
                  <span className="text-xs text-muted-foreground">{step.description}</span>
                )}
              </span>
            </>
          )
          return (
            <li
              key={step.id ?? index}
              data-slot="stepper-step"
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "relative flex min-w-0 gap-2",
                orientation === "horizontal" ? "flex-row items-center" : "flex-col",
                index < steps.length - 1 &&
                  (orientation === "horizontal"
                    ? "pr-6 after:absolute after:right-0 after:top-1/2 after:h-px after:w-6 after:-translate-y-1/2 after:bg-border"
                    : "pb-6 pl-3.5 after:absolute after:bottom-0 after:left-3.5 after:top-8 after:w-px after:bg-border"),
              )}
            >
              {clickable ? (
                <button
                  type="button"
                  data-slot="stepper-button"
                  aria-label={stepLabel?.(index, state)}
                  className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => goTo(index)}
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
})
