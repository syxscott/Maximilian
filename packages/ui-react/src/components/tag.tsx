import { forwardRef, type HTMLAttributes } from "react"

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  size?: "normal" | "large"
}

export const Tag = forwardRef<HTMLSpanElement, TagProps>(
  ({ size = "normal", className, children, ...rest }, ref) => {
    return (
      <span
        ref={ref}
        data-component="tag"
        data-size={size}
        className={className}
        {...rest}
      >
        {children}
      </span>
    )
  }
)
Tag.displayName = "Tag"
