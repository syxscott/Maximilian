import * as React from "react"
import * as AccordionPrimitive from "@radix-ui/react-accordion"
import { cn } from "../../lib/utils.js"

const ChevronDown = () => (
  <svg
    data-slot="accordion-v2-chevron"
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path d="M4 5.5L7 8.5L10 5.5" stroke="currentColor" />
  </svg>
)

export const AccordionV2Root = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Root
    ref={ref}
    data-component="accordion-v2"
    className={cn(className)}
    {...props}
  />
))
AccordionV2Root.displayName = "AccordionV2Root"

export const AccordionV2Item = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    data-component="accordion-v2-item"
    className={cn(className)}
    {...props}
  />
))
AccordionV2Item.displayName = "AccordionV2Item"

export const AccordionV2Header = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Header>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Header>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header
    ref={ref}
    data-slot="accordion-v2-header"
    className={cn(className)}
    {...props}
  >
    {children}
  </AccordionPrimitive.Header>
))
AccordionV2Header.displayName = "AccordionV2Header"

export interface AccordionV2TriggerProps
  extends React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger> {
  hideChevron?: boolean
}

export const AccordionV2Trigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  AccordionV2TriggerProps
>(({ className, children, hideChevron, ...props }, ref) => (
  <AccordionPrimitive.Trigger
    ref={ref}
    data-component="accordion-v2-trigger"
    className={cn(className)}
    {...props}
  >
    <span data-slot="accordion-v2-trigger-content">{children}</span>
    {!hideChevron ? <ChevronDown /> : null}
  </AccordionPrimitive.Trigger>
))
AccordionV2Trigger.displayName = "AccordionV2Trigger"

export const AccordionV2Content = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    data-component="accordion-v2-content"
    className={cn(className)}
    {...props}
  >
    <div data-slot="accordion-v2-content-inner">{children}</div>
  </AccordionPrimitive.Content>
))
AccordionV2Content.displayName = "AccordionV2Content"

export const AccordionV2 = Object.assign(AccordionV2Root, {
  Item: AccordionV2Item,
  Header: AccordionV2Header,
  Trigger: AccordionV2Trigger,
  Content: AccordionV2Content,
})
