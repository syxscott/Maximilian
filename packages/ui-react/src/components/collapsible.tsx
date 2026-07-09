import { forwardRef, type HTMLAttributes } from "react"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import { Icon } from "./icon.js"

export interface CollapsibleProps
  extends React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Root> {
  className?: string
  variant?: "normal" | "ghost"
}

const CollapsibleRoot = forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Root>,
  CollapsibleProps
>(({ className, variant = "normal", children, ...rest }, ref) => {
  return (
    <CollapsiblePrimitive.Root
      ref={ref}
      data-component="collapsible"
      data-variant={variant}
      className={className}
      {...rest}
    >
      {children}
    </CollapsiblePrimitive.Root>
  )
})
CollapsibleRoot.displayName = "CollapsibleRoot"

const CollapsibleTrigger = forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Trigger>
>((props, ref) => (
  <CollapsiblePrimitive.Trigger
    ref={ref}
    data-slot="collapsible-trigger"
    {...props}
  />
))
CollapsibleTrigger.displayName = "CollapsibleTrigger"

const CollapsibleContent = forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>
>((props, ref) => (
  <CollapsiblePrimitive.Content
    ref={ref}
    data-slot="collapsible-content"
    {...props}
  />
))
CollapsibleContent.displayName = "CollapsibleContent"

function CollapsibleArrow(props?: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="collapsible-arrow" {...(props || {})}>
      <span data-slot="collapsible-arrow-icon">
        <Icon name="chevron-down" size="small" />
      </span>
    </div>
  )
}

export const Collapsible = Object.assign(CollapsibleRoot, {
  Arrow: CollapsibleArrow,
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
})
