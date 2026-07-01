import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cn } from "../../lib/utils"

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  hideLabel?: boolean
}

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(({ className, children, hideLabel, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(className)}
    data-component="switch"
    {...props}
  >
    <input
      type="checkbox"
      data-slot="switch-input"
      checked={props.checked === true}
      defaultChecked={props.defaultChecked === true}
      onChange={() => undefined}
      aria-hidden
      tabIndex={-1}
      style={{ position: "absolute", pointerEvents: "none", opacity: 0, width: 0, height: 0 }}
    />
    {children ? (
      <LabelPrimitive.Root
        data-slot="switch-label"
        className={cn(hideLabel && "sr-only")}
      >
        {children}
      </LabelPrimitive.Root>
    ) : null}
    <SwitchPrimitive.Thumb data-slot="switch-thumb" />
  </SwitchPrimitive.Root>
))
Switch.displayName = "Switch"
