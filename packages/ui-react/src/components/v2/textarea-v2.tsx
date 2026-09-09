import * as React from "react"
import { cn } from "../../lib/utils.js"

export interface TextareaV2Props
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const TextareaV2 = React.forwardRef<HTMLTextAreaElement, TextareaV2Props>(
  ({ className, invalid, disabled, rows = 3, ...textareaProps }, ref) => {
    return (
      <div
        data-component="textarea-v2"
        data-disabled={disabled ? "" : undefined}
        data-invalid={invalid ? "" : undefined}
        className={cn(className)}
      >
        <textarea
          ref={ref}
          rows={rows}
          disabled={disabled}
          aria-invalid={invalid ? true : undefined}
          data-slot="textarea-v2-textarea"
          {...textareaProps}
        />
      </div>
    )
  },
)
TextareaV2.displayName = "TextareaV2"
