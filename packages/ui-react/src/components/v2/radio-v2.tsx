import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cn } from "../../lib/utils"

export interface RadioGroupV2Props
  extends React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root> {
  label?: React.ReactNode
  description?: React.ReactNode
  hideLabel?: boolean
}

export const RadioGroupV2 = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  RadioGroupV2Props
>(({ className, children, label, description, hideLabel, ...props }, ref) => (
  <RadioGroupPrimitive.Root
    ref={ref}
    data-component="radio-v2"
    className={cn(className)}
    {...props}
  >
    {label ? (
      <LabelPrimitive.Root
        data-slot="radio-v2-label"
        className={cn(hideLabel && "sr-only")}
      >
        {label}
      </LabelPrimitive.Root>
    ) : null}
    {description ? (
      <div data-slot="radio-v2-description">{description}</div>
    ) : null}
    <div data-slot="radio-v2-items">{children}</div>
  </RadioGroupPrimitive.Root>
))
RadioGroupV2.displayName = "RadioGroupV2"

export interface RadioItemV2Props
  extends React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> {
  label: React.ReactNode
  description?: React.ReactNode
  hideLabel?: boolean
}

export const RadioItemV2 = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  RadioItemV2Props
>(({ className, label, description, hideLabel, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    data-slot="radio-v2-item"
    className={cn(className)}
    {...props}
  >
    <div data-slot="radio-v2-item-control-stack">
      <RadioGroupPrimitive.Indicator data-slot="radio-v2-item-indicator" />
    </div>
    <LabelPrimitive.Root
      data-slot="radio-v2-item-label"
      className={cn(hideLabel && "sr-only")}
    >
      <div data-slot="radio-v2-item-text">
        <span data-slot="radio-v2-item-label-text">{label}</span>
        {description ? (
          <span data-slot="radio-v2-item-description">{description}</span>
        ) : null}
      </div>
    </LabelPrimitive.Root>
  </RadioGroupPrimitive.Item>
))
RadioItemV2.displayName = "RadioItemV2"
