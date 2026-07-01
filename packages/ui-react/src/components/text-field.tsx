import { forwardRef, useState, useCallback, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"
import { Tooltip, TooltipTrigger, TooltipContent } from "./tooltip"
import { cn } from "../lib/utils"

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hideLabel?: boolean
  description?: string
  error?: string
  variant?: "normal" | "ghost"
  copyable?: boolean
  copyKind?: "clipboard" | "link"
  multiline?: boolean
  validationState?: "valid" | "invalid"
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      name,
      defaultValue,
      value,
      onChange,
      onKeyDown,
      validationState,
      required,
      disabled,
      readOnly,
      className,
      label,
      hideLabel,
      description,
      error,
      variant = "normal",
      copyable,
      copyKind,
      multiline,
      onClick,
      ...rest
    },
    ref,
  ) => {
    const i18n = useI18n()
    const [copied, setCopied] = useState(false)

    const tooltipLabel = useCallback(() => {
      if (copied) return i18n.t("ui.textField.copied")
      if (copyKind === "link") return i18n.t("ui.textField.copyLink")
      return i18n.t("ui.textField.copyToClipboard")
    }, [copied, copyKind, i18n])

    const icon = useCallback(() => {
      if (copied) return "check" as const
      if (copyKind === "link") return "link" as const
      return "copy" as const
    }, [copied, copyKind])

    const handleCopy = useCallback(async () => {
      const val = (value as string) ?? (defaultValue as string) ?? ""
      await navigator.clipboard.writeText(val)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }, [value, defaultValue])

    const handleClick = useCallback(
      (e: React.MouseEvent<HTMLInputElement>) => {
        if (copyable) void handleCopy()
        onClick?.(e)
      },
      [copyable, handleCopy, onClick],
    )

    return (
      <div data-component="input" data-variant={variant}>
        {label && (
          <label data-slot="input-label" className={hideLabel ? "sr-only" : undefined}>
            {label}
          </label>
        )}
        <div data-slot="input-wrapper">
          {multiline ? (
            <textarea
              data-slot="input-input"
              name={name}
              defaultValue={defaultValue as string}
              value={value as string}
              onChange={onChange as unknown as TextareaHTMLAttributes<HTMLTextAreaElement>["onChange"]}
              onKeyDown={onKeyDown as unknown as TextareaHTMLAttributes<HTMLTextAreaElement>["onKeyDown"]}
              required={required}
              disabled={disabled}
              readOnly={readOnly}
              className={cn(className)}
              {...(rest as unknown as TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
          ) : (
            <input
              ref={ref}
              data-slot="input-input"
              name={name}
              defaultValue={defaultValue}
              value={value}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onClick={handleClick}
              required={required}
              disabled={disabled}
              readOnly={readOnly}
              className={cn(className)}
              {...rest}
            />
          )}
          {copyable && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  type="button"
                  icon={icon()}
                  variant="ghost"
                  onClick={handleCopy}
                  tabIndex={-1}
                  data-slot="input-copy-button"
                  aria-label={tooltipLabel()}
                />
              </TooltipTrigger>
              <TooltipContent>{tooltipLabel()}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {description && (
          <div data-slot="input-description">{description}</div>
        )}
        {error && (
          <div data-slot="input-error">{error}</div>
        )}
      </div>
    )
  },
)
TextField.displayName = "TextField"
