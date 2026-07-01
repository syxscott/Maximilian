import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import { cn } from "../lib/utils"

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {
  hideLabel?: boolean
  description?: string
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, children, hideLabel, description, ...props }, ref) => {
  return (
    <div data-component="switch" className={cn("flex items-start gap-2", className)}>
      <SwitchPrimitives.Root
        ref={ref}
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        )}
        {...props}
      >
        <SwitchPrimitives.Thumb
          data-slot="switch-thumb"
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
          )}
        />
      </SwitchPrimitives.Root>
      <div className="flex flex-col gap-1">
        {children && (
          <label
            data-slot="switch-label"
            className={cn(
              "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
              hideLabel && "sr-only",
            )}
          >
            {children}
          </label>
        )}
        {description && (
          <p data-slot="switch-description" className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  )
})
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
