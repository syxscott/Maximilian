import * as React from "react"
import { Copy } from "lucide-react"
import { cn } from "../../lib/utils.js"

export interface InlineInputV2Props
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "prefix"> {
  prefix: React.ReactNode
  labelWidth?: number | string
  showCopyButton?: boolean
  copyLabel?: string
  onCopyClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  numeric?: boolean
  invalid?: boolean
  appearance?: "base" | "large"
  type?: React.InputHTMLAttributes<HTMLInputElement>["type"]
}

export const InlineInputV2 = React.forwardRef<HTMLInputElement, InlineInputV2Props>(
  (
    {
      className,
      style,
      prefix,
      labelWidth,
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
    const customStyle: React.CSSProperties = {
      ...(typeof style === "object" && style !== null ? style : {}),
      ...(labelWidth != null
        ? {
            ["--inline-input-v2-label-width" as any]:
              typeof labelWidth === "number" ? `${labelWidth}px` : labelWidth,
          }
        : {}),
    }

    return (
      <div
        data-component="inline-input-v2"
        data-disabled={disabled ? "" : undefined}
        data-invalid={invalid ? "" : undefined}
        data-numeric={numeric ? "" : undefined}
        data-appearance={appearance}
        data-label-width={labelWidth != null ? "" : undefined}
        className={cn(className)}
        style={customStyle}
      >
        <div data-slot="inline-input-v2-prefix">
          <span data-slot="inline-input-v2-prefix-text">{prefix}</span>
        </div>
        <div data-slot="inline-input-v2-divider" aria-hidden="true" />
        <div data-slot="inline-input-v2-field">
          <div data-slot="inline-input-v2-value">
            <input
              ref={ref}
              type={type}
              disabled={disabled}
              aria-invalid={invalid ? true : undefined}
              data-slot="inline-input-v2-input"
              {...inputProps}
            />
          </div>
          {showCopyButton ? (
            <button
              type="button"
              data-slot="inline-input-v2-icon-button"
              aria-label={copyLabel ?? "Copy"}
              disabled={disabled}
              onClick={onCopyClick}
            >
              <Copy size={16} />
            </button>
          ) : null}
        </div>
      </div>
    )
  },
)
InlineInputV2.displayName = "InlineInputV2"
