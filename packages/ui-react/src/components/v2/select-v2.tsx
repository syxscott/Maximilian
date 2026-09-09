import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { cn } from "../../lib/utils.js"

const ChevronDown = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M11 9.5L8 6.5L5 9.5"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const CheckSmall = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M3.53564 8.17857L6.39279 11.75L12.4642 4.25"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

function groupOptions<T>(
  options: T[],
  groupBy?: (x: T) => string,
): { category: string; options: T[] }[] {
  if (!groupBy) {
    return [{ category: "", options }]
  }
  const map = new Map<string, T[]>()
  for (const opt of options) {
    const key = groupBy(opt)
    const arr = map.get(key)
    if (arr) arr.push(opt)
    else map.set(key, [opt])
  }
  return [...map.entries()].map(([category, opts]) => ({ category, options: opts }))
}

export interface SelectV2Option {
  value: string
  label: React.ReactNode
  disabled?: boolean
  category?: string
  [key: string]: unknown
}

export interface SelectV2Props<T extends SelectV2Option = SelectV2Option> {
  placeholder?: string
  options: T[]
  current?: T
  value?: (x: T) => string
  label?: (x: T) => string | React.ReactNode
  groupBy?: (x: T) => string
  onSelect?: (value: T | null) => void
  onHighlight?: (value: T | undefined) => void | (() => void)
  onOpenChange?: (open: boolean) => void
  appearance?: "base" | "large" | "inline"
  invalid?: boolean
  numeric?: boolean
  disabled?: boolean
  children?: (item: T) => React.ReactNode
  valueClass?: string
  className?: string
  defaultValue?: T
  name?: string
  dir?: "ltr" | "rtl"
}

export function SelectV2<T extends SelectV2Option = SelectV2Option>(props: SelectV2Props<T>) {
  const {
    className,
    placeholder,
    options,
    current,
    value,
    label,
    groupBy,
    onSelect,
    onHighlight,
    onOpenChange,
    children,
    appearance = "base",
    invalid,
    numeric,
    disabled,
    valueClass,
    defaultValue,
    name,
    dir,
  } = props

  const inline = appearance === "inline"
  const highlightRef = React.useRef<{ key?: string; cleanup?: void | (() => void) }>({})

  const stop = React.useCallback(() => {
    highlightRef.current.cleanup?.()
    highlightRef.current.cleanup = undefined
    highlightRef.current.key = undefined
  }, [])

  React.useEffect(() => () => stop(), [stop])

  const keyFor = React.useCallback(
    (item: T) => (value ? value(item) : item.value),
    [value],
  )

  const move = React.useCallback(
    (item: T | undefined) => {
      if (!onHighlight) return
      if (!item) {
        stop()
        return
      }
      const key = keyFor(item)
      if (highlightRef.current.key === key) return
      highlightRef.current.cleanup?.()
      highlightRef.current.cleanup = onHighlight(item)
      highlightRef.current.key = key
    },
    [onHighlight, stop, keyFor],
  )

  const grouped = React.useMemo(
    () => groupOptions(options, groupBy),
    [options, groupBy],
  )

  const getOptionValue = React.useCallback(
    (x: T) => (value ? value(x) : x.value),
    [value],
  )

  const getOptionText = React.useCallback(
    (x: T) => (label ? String(label(x) ?? "") : x.value),
    [label],
  )

  const getOptionCategory = React.useCallback(
    (x: T) => (x.category ?? ""),
    [],
  )

  const currentValue = current ? getOptionValue(current) : undefined
  const defaultValueStr = defaultValue ? getOptionValue(defaultValue) : undefined

  return (
    <SelectPrimitive.Root
      value={currentValue}
      defaultValue={defaultValueStr}
      onValueChange={(next) => {
        const found = options.find((o) => getOptionValue(o) === next) ?? null
        onSelect?.(found)
        stop()
      }}
      onOpenChange={(open) => {
        onOpenChange?.(open)
        if (!open) stop()
      }}
      disabled={disabled}
      name={name}
      dir={dir}
      data-component="select-v2-root"
    >
      <SelectPrimitive.Trigger
        data-component="select-v2"
        data-appearance={appearance}
        data-invalid={invalid ? "" : undefined}
        data-numeric={numeric ? "" : undefined}
        disabled={disabled}
        data-disabled={disabled ? "" : undefined}
        className={cn(className)}
      >
        <div data-slot="select-v2-value">
          <SelectPrimitive.Value
            data-slot="select-v2-value-text"
            className={valueClass}
            placeholder={placeholder}
          />
        </div>
        <span data-slot="select-v2-chevron" aria-hidden="true">
          <ChevronDown />
        </span>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          data-component="menu-v2-content"
          data-slot="select-v2-content"
          position={inline ? "item-aligned" : "popper"}
          align={inline ? "end" : "start"}
          sideOffset={4}
        >
          <SelectPrimitive.Viewport data-slot="select-v2-listbox">
            {grouped.map((group, gi) => (
              <React.Fragment key={group.category || `__group_${gi}`}>
                {group.category ? (
                  <div data-slot="menu-v2-group-label">{group.category}</div>
                ) : null}
                {group.options.map((item) => {
                  const v = getOptionValue(item)
                  return (
                    <SelectPrimitive.Item
                      key={v}
                      value={v}
                      disabled={item.disabled}
                      data-component="menu-v2-item"
                      onPointerEnter={() => move(item)}
                      onPointerMove={() => move(item)}
                      onFocus={() => move(item)}
                    >
                      <SelectPrimitive.ItemText data-slot="menu-v2-item-content" asChild>
                        <span>
                          {children
                            ? children(item)
                            : label
                              ? label(item)
                              : item.label ?? item.value}
                        </span>
                      </SelectPrimitive.ItemText>
                      <SelectPrimitive.ItemIndicator
                        data-slot="menu-v2-item-indicator"
                      >
                        <CheckSmall />
                      </SelectPrimitive.ItemIndicator>
                    </SelectPrimitive.Item>
                  )
                })}
              </React.Fragment>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
SelectV2.displayName = "SelectV2"
