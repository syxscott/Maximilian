import {
  type ReactNode,
  type HTMLAttributes,
  useState,
  useCallback,
} from "react"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import { cn } from "../lib/utils"

function BanIcon() {
  return (
    <svg
      data-slot="tool-error-card-ban"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M3.44283 12.5575L12.5495 3.45081M14.4446 8.00011C14.4446 11.5593 11.5593 14.4446 8.00011 14.4446C4.44094 14.4446 1.55566 11.5593 1.55566 8.00011C1.55566 4.44094 4.44094 1.55566 8.00011 1.55566C11.5593 1.55566 14.4446 4.44094 14.4446 8.00011Z"
        stroke="currentColor"
      />
    </svg>
  )
}

function LoaderIcon() {
  const r = 5.9
  return (
    <svg
      data-slot="tool-error-card-loader"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="animate-spin"
    >
      <g transform="translate(8 8)">
        <circle
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeOpacity="0.3"
          transform="rotate(-90)"
        />
        <circle
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          pathLength={100}
          strokeDasharray="25 75"
          transform="rotate(-90)"
        />
      </g>
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg
      data-slot="tool-error-card-chevron"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="transition-transform data-[state=open]:rotate-90"
    >
      <path
        d="M5.90795 9.62425C5.61628 9.81865 5.25 9.57825 5.25 9.19235V4.80837C5.25 4.42247 5.61628 4.18204 5.90795 4.37648L9.1959 6.56846C9.48535 6.7614 9.48535 7.2393 9.1959 7.43224L5.90795 9.62425Z"
        fill="currentColor"
      />
    </svg>
  )
}

export interface ToolErrorCardV2Props
  extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "title"> {
  title: ReactNode | string
  subtitle: ReactNode | string
  suffix?: ReactNode | string
  loading?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  subtitleHref?: string
}

export function ToolErrorCardV2({
  title,
  subtitle,
  suffix,
  loading,
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  subtitleHref,
  className,
  ...rest
}: ToolErrorCardV2Props) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const hasSuffix = (() => {
    if (suffix == null) return false
    if (typeof suffix === "string") return suffix.length > 0
    return true
  })()

  const handleOpenChange = useCallback(
    (value: boolean) => {
      onOpenChange?.(value)
      if (!isControlled) setInternalOpen(value)
    },
    [onOpenChange, isControlled],
  )

  return (
    <CollapsiblePrimitive.Root
      data-component="tool-error-card"
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={handleOpenChange}
      disabled={!hasSuffix}
      aria-busy={loading ? true : undefined}
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive/5",
        className,
      )}
      {...(rest as Record<string, unknown>)}
    >
      <CollapsiblePrimitive.Trigger asChild disabled={!hasSuffix}>
        <div
          role="button"
          tabIndex={0}
          data-slot="tool-error-card-trigger"
          className="flex w-full items-center gap-2 px-3 py-2 text-left data-[disabled]:cursor-default"
        >
          <span data-slot="tool-error-card-icon-wrap" className="text-destructive">
            {loading ? <LoaderIcon /> : <BanIcon />}
          </span>
          <div data-slot="tool-error-card-main" className="flex-1">
            <div data-slot="tool-error-card-labels" className="flex flex-wrap items-center gap-1.5 text-sm">
              <span data-slot="tool-error-card-title" className="font-medium text-destructive">
                {title}
              </span>
              <span data-slot="tool-error-card-sep" aria-hidden="true" className="text-muted-foreground">
                ·
              </span>
              {subtitleHref ? (
                <a
                  data-slot="tool-error-card-subtitle"
                  href={subtitleHref}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="hover:underline"
                >
                  {subtitle}
                </a>
              ) : (
                <span data-slot="tool-error-card-subtitle" className="text-muted-foreground">
                  {subtitle}
                </span>
              )}
              {hasSuffix && (
                <span data-slot="tool-error-card-chevron-wrap" className="ml-auto">
                  <ChevronIcon />
                </span>
              )}
            </div>
          </div>
        </div>
      </CollapsiblePrimitive.Trigger>
      {hasSuffix && (
        <CollapsiblePrimitive.Content data-slot="tool-error-card-content">
          <div data-slot="tool-error-card-suffix" className="border-t border-destructive/20 px-3 py-2 text-sm">
            {suffix}
          </div>
        </CollapsiblePrimitive.Content>
      )}
    </CollapsiblePrimitive.Root>
  )
}