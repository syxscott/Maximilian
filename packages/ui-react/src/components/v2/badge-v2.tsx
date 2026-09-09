import * as React from "react"
import { cn } from "../../lib/utils.js"

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {}

export const Tag = React.forwardRef<HTMLSpanElement, TagProps>(
  ({ className, children, ...rest }, ref) => (
    <span
      ref={ref}
      data-component="tag"
      className={cn(className)}
      {...rest}
    >
      {children}
    </span>
  ),
)
Tag.displayName = "Tag"

export interface BadgeV2Props extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "neutral" | "contrast" | "success" | "warning" | "error" | "info"
}

export const BadgeV2 = React.forwardRef<HTMLSpanElement, BadgeV2Props>(
  ({ className, variant = "neutral", children, ...rest }, ref) => (
    <span
      ref={ref}
      data-component="badge-v2"
      data-variant={variant}
      className={cn(className)}
      {...rest}
    >
      {children}
    </span>
  ),
)
BadgeV2.displayName = "BadgeV2"
