import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "../lib/utils.js"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    data-component="slider"
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    {(props.value ?? props.defaultValue ?? [0]).map((_, i) => (
      <SliderPrimitive.Thumb
        key={i}
        className="block h-4 w-4 rounded-full border-2 border-primary bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
      />
    ))}
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export interface RangeSliderProps
  extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  label?: React.ReactNode
  /** Show the current value(s) on the right. */
  showValue?: boolean
  /** Format the displayed value. */
  formatValue?: (n: number) => string
}

export const RangeSlider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, RangeSliderProps>(
  function RangeSlider({ label, showValue, formatValue, className, value, defaultValue, ...props }, ref) {
    const [internal, setInternal] = React.useState<number[]>(defaultValue ?? [0])
    const current = value ?? internal

    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {(label || showValue) && (
          <div className="flex items-center justify-between text-sm">
            {label ? <span className="font-medium text-foreground">{label}</span> : <span />}
            {showValue ? (
              <span className="font-mono text-xs text-muted-foreground">
                {current.map((n) => formatValue ? formatValue(n) : n).join(" – ")}
              </span>
            ) : null}
          </div>
        )}
        <Slider
          ref={ref}
          value={value}
          defaultValue={defaultValue}
          onValueChange={(v) => {
            if (value === undefined) setInternal(v)
            props.onValueChange?.(v)
          }}
          {...props}
        />
      </div>
    )
  },
)

export { Slider }
