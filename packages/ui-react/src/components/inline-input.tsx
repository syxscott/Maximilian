import { forwardRef, type InputHTMLAttributes, type CSSProperties } from "react"
import { cn } from "../lib/utils.js"

export interface InlineInputProps extends InputHTMLAttributes<HTMLInputElement> {
  width?: string
}

export const InlineInput = forwardRef<HTMLInputElement, InlineInputProps>(
  ({ className, width, style, ...rest }, ref) => {
    const mergedStyle: CSSProperties | undefined = (() => {
      if (!width) return style as CSSProperties | undefined
      if (!style) return { width }
      if (typeof style === "string") return undefined // CSSProperties can't merge with string
      return { ...style, width }
    })()

    return (
      <input
        ref={ref}
        data-component="inline-input"
        className={cn(className)}
        style={mergedStyle}
        {...rest}
      />
    )
  },
)
InlineInput.displayName = "InlineInput"
