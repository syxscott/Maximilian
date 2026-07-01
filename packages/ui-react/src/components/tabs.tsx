import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "../lib/utils"

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> & {
    variant?: "normal" | "alt" | "pill" | "settings"
  }
>(({ className, variant = "normal", orientation = "horizontal", ...props }, ref) => (
  <TabsPrimitive.Root
    ref={ref}
    orientation={orientation}
    data-component="tabs"
    data-variant={variant}
    data-orientation={orientation}
    className={cn(className)}
    {...props}
  />
))
Tabs.displayName = TabsPrimitive.Root.displayName

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-slot="tabs-list"
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

export interface TabsTriggerProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  classes?: {
    button?: string
  }
  hideCloseButton?: boolean
  closeButton?: React.ReactNode
  onMiddleClick?: () => void
}

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(
  (
    { className, classes, children, closeButton, hideCloseButton, onMiddleClick, value, ...props },
    ref,
  ) => {
    return (
      <div
        data-slot="tabs-trigger-wrapper"
        data-value={value}
        className={cn(className)}
        onMouseDown={(e) => {
          if (e.button === 1 && onMiddleClick) {
            e.preventDefault()
          }
        }}
        onAuxClick={(e) => {
          if (e.button === 1 && onMiddleClick) {
            e.preventDefault()
            onMiddleClick()
          }
        }}
      >
        <TabsPrimitive.Trigger
          ref={ref}
          data-slot="tabs-trigger"
          data-value={value}
          className={cn(classes?.button, className)}
          value={value}
          {...props}
        >
          {children}
        </TabsPrimitive.Trigger>
        {closeButton && (
          <div data-slot="tabs-trigger-close-button" data-hidden={hideCloseButton}>
            {closeButton}
          </div>
        )}
      </div>
    )
  },
)
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    data-slot="tabs-content"
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

const TabsSectionTitle: React.FC<React.PropsWithChildren> = ({ children }) => {
  return <div data-slot="tabs-section-title">{children}</div>
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsSectionTitle }
