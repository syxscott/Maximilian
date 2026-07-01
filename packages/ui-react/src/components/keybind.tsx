import { forwardRef, type HTMLAttributes } from "react"

export interface KeybindProps extends HTMLAttributes<HTMLSpanElement> {}

export const Keybind = forwardRef<HTMLSpanElement, KeybindProps>(
  ({ className, children, ...rest }, ref) => {
    return (
      <span
        ref={ref}
        data-component="keybind"
        className={className}
        {...rest}
      >
        {children}
      </span>
    )
  }
)
Keybind.displayName = "Keybind"
