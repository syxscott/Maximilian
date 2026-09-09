import { forwardRef, type ButtonHTMLAttributes } from "react"
import { Icon, type IconProps } from "./icon.js"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "small" | "normal" | "large"
  variant?: "primary" | "secondary" | "ghost"
  icon?: IconProps["name"]
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ size = "normal", variant = "secondary", icon, className, children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        data-component="button"
        data-size={size}
        data-variant={variant}
        data-icon={icon}
        className={className}
        {...rest}
      >
        {icon ? <Icon name={icon} size="small" /> : null}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"
