import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"
import { cn } from "../lib/utils.js"

export interface CheckboxProps
  extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  hideLabel?: boolean
  description?: string
  icon?: React.ReactNode
}

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, children, hideLabel, description, icon, ...props }, ref) => {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      data-component="checkbox"
      className={cn(
        "peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-checkbox-indicator"
        className={cn("flex items-center justify-center text-current")}
      >
        {icon || <Check className="h-3 w-3" strokeWidth={1.5} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
})
Checkbox.displayName = CheckboxPrimitive.Root.displayName

const CheckboxWrapper = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, children, hideLabel, description, icon, ...props }, ref) => {
  return (
    <div data-component="checkbox" className={cn("flex items-start gap-2", className)}>
      <CheckboxPrimitive.Root
        ref={ref}
        className={cn(
          "peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator
          data-slot="checkbox-checkbox-indicator"
          className={cn("flex items-center justify-center text-current")}
        >
          {icon || <Check className="h-3 w-3" strokeWidth={1.5} />}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <div data-slot="checkbox-checkbox-content" className="flex flex-col gap-1">
        {children && (
          <label
            data-slot="checkbox-checkbox-label"
            className={cn(
              "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
              hideLabel && "sr-only",
            )}
          >
            {children}
          </label>
        )}
        {description && (
          <p data-slot="checkbox-checkbox-description" className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  )
})
CheckboxWrapper.displayName = "CheckboxWrapper"

export { Checkbox, CheckboxWrapper }
