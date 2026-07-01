import * as React from "react"
import { Copy } from "lucide-react"
import { cn } from "../../lib/utils"

export interface TextInputV2Props
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  showCopyButton?: boolean
  copyLabel?: string
  onCopyClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  numeric?: boolean
  invalid?: boolean
  appearance?: "base" | "large"
  type?: React.InputHTMLAttributes<HTMLInputElement>["type"]
}

export const TextInputV2 = React.forwardRef<HTMLInputElement, TextInputV2Props>(
  (
    {
      className,
      showCopyButton,
      copyLabel,
      onCopyClick,
      numeric,
      invalid,
      appearance = "base",
      disabled,
      type = "text",
      ...inputProps
    },
    ref,
  ) => {
    return (
      <div
        data-component="text-input-v2"
        data-disabled={disabled ? "" : undefined}
        data-invalid={invalid ? "" : undefined}
        data-numeric={numeric ? "" : undefined}
        data-appearance={appearance}
        className={cn(className)}
      >
        <div data-slot="text-input-v2-value">
          <input
            ref={ref}
            type={type}
            disabled={disabled}
            aria-invalid={invalid ? true : undefined}
            data-slot="text-input-v2-input"
            {...inputProps}
          />
        </div>
        {showCopyButton ? (
          <button
            type="button"
            data-slot="text-input-v2-icon-button"
            aria-label={copyLabel ?? "Copy"}
            disabled={disabled}
            onClick={onCopyClick}
          >
            <Copy size={16} />
          </button>
        ) : null}
      </div>
    )
  },
)
TextInputV2.displayName = "TextInputV2"
