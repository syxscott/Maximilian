import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { X } from "lucide-react"
import { cn } from "../lib/utils.js"

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

export interface PopoverContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>, "title"> {
  title?: React.ReactNode
  description?: React.ReactNode
}

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(({ className, align = "center", sideOffset = 4, title, description, children, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      data-component="popover-content"
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    >
      {title && (
        <div data-slot="popover-header" className="flex items-start justify-between">
          <div data-slot="popover-title" className="font-semibold">
            {title}
          </div>
          <PopoverPrimitive.Close
            data-slot="popover-close-button"
            aria-label="Close"
            className="inline-flex items-center justify-center rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
          >
            <X className="h-4 w-4" />
          </PopoverPrimitive.Close>
        </div>
      )}
      {description && (
        <div data-slot="popover-description" className="text-sm text-muted-foreground">
          {description}
        </div>
      )}
      <div data-slot="popover-body">{children}</div>
    </PopoverPrimitive.Content>
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
