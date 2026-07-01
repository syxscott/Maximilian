import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "../../lib/utils"

export interface IconButtonV2Props
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  size?: "small" | "normal" | "large"
  variant?: "neutral" | "contrast" | "ghost" | "ghost-muted"
  state?: "rest" | "hover" | "pressed"
  asChild?: boolean
  icon?: React.ReactNode
}

export const IconButtonV2 = React.forwardRef<HTMLButtonElement, IconButtonV2Props>(
  (
    {
      className,
      size = "normal",
      variant = "neutral",
      state,
      asChild,
      icon,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        ref={ref as React.Ref<HTMLButtonElement>}
        type={asChild ? undefined : type}
        data-component="icon-button-v2"
        data-size={size}
        data-variant={variant}
        data-state={state}
        className={cn(className)}
        {...props}
      >
        {icon}
      </Comp>
    )
  },
)
IconButtonV2.displayName = "IconButtonV2"
