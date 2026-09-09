import { forwardRef, type HTMLAttributes, type CSSProperties } from "react"
import { Icon, type IconProps } from "./icon.js"

type Variant = "normal" | "error" | "warning" | "success" | "info"

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant
}

export interface CardTitleProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant
  /**
   * Optional title icon.
   *
   * - `undefined`: picks a default icon based on `variant` (error/warning/success/info)
   * - `false`/`null`: disables the icon
   * - `Icon` name: forces a specific icon
   */
  icon?: IconProps["name"] | false | null
}

function pick(variant: Variant) {
  if (variant === "error") return "circle-ban-sign" as const
  if (variant === "warning") return "warning" as const
  if (variant === "success") return "circle-check" as const
  if (variant === "info") return "help" as const
  return
}

function mix(
  style: CSSProperties | string | undefined,
  value?: string
): CSSProperties | undefined {
  if (!value) {
    return typeof style === "string" ? undefined : style
  }
  const base: CSSProperties =
    typeof style === "string" ? {} : { ...(style ?? {}) }
  ;(base as Record<string, string | number>)["--card-accent"] = value
  return base
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = "normal", style, className, children, ...rest }, ref) => {
    let accent: string | undefined
    if (variant === "error") accent = "var(--icon-critical-base)"
    else if (variant === "warning") accent = "var(--icon-warning-active)"
    else if (variant === "success") accent = "var(--icon-success-active)"
    else if (variant === "info") accent = "var(--icon-info-active)"

    return (
      <div
        ref={ref}
        data-component="card"
        data-variant={variant}
        style={mix(style, accent)}
        className={className}
        {...rest}
      >
        {children}
      </div>
    )
  }
)
Card.displayName = "Card"

export const CardTitle = forwardRef<HTMLDivElement, CardTitleProps>(
  ({ variant = "normal", icon, className, children, ...rest }, ref) => {
    const show = icon !== false && icon !== null
    let name: IconProps["name"] | undefined
    if (icon !== false && icon !== null) {
      if (typeof icon === "string") name = icon
      else name = pick(variant)
    }
    const placeholder = !name

    return (
      <div
        ref={ref}
        data-slot="card-title"
        className={className}
        {...rest}
      >
        {show ? (
          <span
            data-slot="card-title-icon"
            data-placeholder={placeholder || undefined}
          >
            <Icon name={name ?? "dash"} size="small" />
          </span>
        ) : null}
        {children}
      </div>
    )
  }
)
CardTitle.displayName = "CardTitle"

export const CardDescription = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="card-description"
        className={className}
        {...rest}
      >
        {children}
      </div>
    )
  }
)
CardDescription.displayName = "CardDescription"

export const CardActions = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="card-actions"
        className={className}
        {...rest}
      >
        {children}
      </div>
    )
  }
)
CardActions.displayName = "CardActions"
