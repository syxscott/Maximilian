import { forwardRef, type ButtonHTMLAttributes } from "react"
import { Icon, type IconProps } from "./icon.js"

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconProps["name"]
  size?: "small" | "normal" | "large"
  iconSize?: IconProps["size"]
  variant?: "primary" | "secondary" | "ghost"
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, size = "normal", iconSize, variant = "secondary", className, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        data-component="icon-button"
        data-icon={icon}
        data-size={size}
        data-variant={variant}
        className={className}
        {...rest}
      >
        <Icon
          name={icon}
          size={iconSize ?? (size === "large" ? "normal" : "small")}
        />
      </button>
    )
  }
)
IconButton.displayName = "IconButton"
