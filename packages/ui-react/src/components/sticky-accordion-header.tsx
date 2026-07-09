import * as React from "react"
import * as AccordionPrimitive from "@radix-ui/react-accordion"
import { cn } from "../lib/utils.js"

export interface StickyAccordionHeaderProps extends React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Header> {
  className?: string
}

export const StickyAccordionHeader = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Header>,
  StickyAccordionHeaderProps
>(function StickyAccordionHeader({ className, children, ...rest }, ref) {
  return (
    <AccordionPrimitive.Header
      ref={ref}
      data-component="sticky-accordion-header"
      className={cn("sticky top-0 z-10 bg-background", className)}
      {...rest}
    >
      {children}
    </AccordionPrimitive.Header>
  )
})