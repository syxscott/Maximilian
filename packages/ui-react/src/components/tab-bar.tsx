import * as React from "react"
import { X } from "lucide-react"
import { cn } from "../lib/utils.js"

export interface TabBarItem<TValue extends string = string> {
  value: TValue
  label: React.ReactNode
  /** Optional icon (lucide or any node). */
  icon?: React.ReactNode
  /** Show a close (X) button on the tab. */
  closable?: boolean
  disabled?: boolean
}

export interface TabBarProps<TValue extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "onClose"> {
  items: TabBarItem<TValue>[]
  value?: TValue
  defaultValue?: TValue
  onChange?: (value: TValue) => void
  onClose?: (value: TValue) => void
  variant?: "underline" | "pill" | "boxed"
}

export function TabBar<TValue extends string = string>({
  items,
  value,
  defaultValue,
  onChange,
  onClose,
  variant = "underline",
  className,
  ...rest
}: TabBarProps<TValue>) {
  const isControlled = value !== undefined
  const [internal, setInternal] = React.useState<TValue | undefined>(defaultValue)
  const current = (isControlled ? value : internal) ?? items[0]?.value

  const handleSelect = React.useCallback(
    (next: TValue, disabled?: boolean) => {
      if (disabled) return
      if (!isControlled) setInternal(next)
      onChange?.(next)
    },
    [isControlled, onChange],
  )

  return (
    <div
      data-component="tab-bar"
      data-variant={variant}
      role="tablist"
      className={cn(
        "flex items-center gap-1 overflow-x-auto",
        variant === "underline" && "border-b border-border",
        variant === "boxed" && "rounded-md border border-border bg-muted/40 p-1",
        variant === "pill" && "rounded-full bg-muted/60 p-1",
        className,
      )}
      {...rest}
    >
      {items.map((item) => {
        const selected = item.value === current
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            data-state={selected ? "active" : "inactive"}
            data-slot="tab-bar-item"
            disabled={item.disabled}
            onClick={() => handleSelect(item.value, item.disabled)}
            className={cn(
              "group relative inline-flex h-8 items-center gap-1.5 whitespace-nowrap px-3 text-sm transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              variant === "underline" &&
                "border-b-2 border-transparent text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground",
              variant === "pill" &&
                "rounded-full text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
              variant === "boxed" &&
                "rounded text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
            )}
          >
            {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
            <span>{item.label}</span>
            {item.closable ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Close tab"
                className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 data-[state=active]:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose?.(item.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    e.stopPropagation()
                    onClose?.(item.value)
                  }
                }}
              >
                <X className="h-3 w-3" />
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
