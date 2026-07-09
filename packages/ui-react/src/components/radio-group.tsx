import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { cn } from "../lib/utils.js"

export interface RadioGroupProps<T> {
  options: T[]
  current?: T
  defaultValue?: T
  value?: (x: T) => string
  label?: (x: T) => React.ReactNode
  onSelect?: (value: T | undefined) => void
  className?: string
  size?: "small" | "medium"
  fill?: boolean
  pad?: "none" | "normal"
  disabled?: boolean
  name?: string
  orientation?: "horizontal" | "vertical"
}

export function RadioGroup<T>(props: RadioGroupProps<T>) {
  const {
    className,
    options,
    current,
    defaultValue,
    value,
    label,
    onSelect,
    size = "medium",
    fill,
    pad = "normal",
    disabled,
    name,
    orientation,
  } = props

  const getValue = React.useCallback(
    (item: T): string => {
      if (value) return value(item)
      return String(item)
    },
    [value],
  )

  const getLabel = React.useCallback(
    (item: T): React.ReactNode => {
      if (label) return label(item)
      return String(item)
    },
    [label],
  )

  const findOption = React.useCallback(
    (v: string): T | undefined => {
      return options.find((opt) => getValue(opt) === v)
    },
    [options, getValue],
  )

  return (
    <RadioGroupPrimitive.Root
      data-component="radio-group"
      data-size={size}
      data-fill={fill ? "" : undefined}
      data-pad={pad}
      className={cn(className)}
      value={current ? getValue(current) : undefined}
      defaultValue={defaultValue ? getValue(defaultValue) : undefined}
      onValueChange={(v) => onSelect?.(findOption(v))}
      disabled={disabled}
      name={name}
      orientation={orientation}
    >
      <div role="presentation" data-slot="radio-group-wrapper">
        <RadioGroupPrimitive.Indicator data-slot="radio-group-indicator" />
        <div role="presentation" data-slot="radio-group-items">
          {options.map((option) => {
            const v = getValue(option)
            return (
              <RadioGroupPrimitive.Item
                key={v}
                value={v}
                data-slot="radio-group-item"
                data-value={v}
                className={cn(
                  "group relative flex cursor-pointer items-center justify-center rounded-md transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
                )}
              >
                <span data-slot="radio-group-item-control">{getLabel(option)}</span>
              </RadioGroupPrimitive.Item>
            )
          })}
        </div>
      </div>
    </RadioGroupPrimitive.Root>
  )
}