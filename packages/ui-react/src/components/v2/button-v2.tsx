import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "../../lib/utils.js"

export interface ButtonV2Props
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  size?: "small" | "normal" | "large"
  variant?: "neutral" | "contrast" | "ghost" | "ghost-muted"
  icon?: React.ReactNode
  asChild?: boolean
  children?: React.ReactNode
}

export const ButtonV2 = React.forwardRef<HTMLButtonElement, ButtonV2Props>(
  (
    { className, size = "normal", variant = "neutral", icon, asChild, children, type, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        ref={ref as React.Ref<HTMLButtonElement>}
        type={asChild ? undefined : type ?? "button"}
        data-component="button-v2"
        data-size={size}
        data-variant={variant}
        data-icon={icon ? "" : undefined}
        className={cn(className)}
        {...props}
      >
        {icon ? <span data-slot="icon-svg">{icon}</span> : null}
        {children}
      </Comp>
    )
  },
)
ButtonV2.displayName = "ButtonV2"
