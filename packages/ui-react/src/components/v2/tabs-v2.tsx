import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "../../lib/utils.js"

export interface TabsV2Props
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  variant?: "normal" | "pill" | "settings"
  orientation?: "horizontal" | "vertical"
}

export const TabsV2Root = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  TabsV2Props
>(({ className, variant = "normal", orientation = "horizontal", ...props }, ref) => (
  <TabsPrimitive.Root
    ref={ref}
    orientation={orientation}
    data-component="tabs-v2"
    data-variant={variant}
    data-orientation={orientation}
    className={cn(className)}
    {...props}
  />
))
TabsV2Root.displayName = "TabsV2Root"

export const TabsV2List = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-slot="tabs-v2-list"
    className={cn(className)}
    {...props}
  />
))
TabsV2List.displayName = "TabsV2List"

export interface TabsV2TriggerProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  onMiddleClick?: () => void
  subtext?: React.ReactNode
}

export const TabsV2Trigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsV2TriggerProps
>(({ className, children, onMiddleClick, subtext, value, ...props }, ref) => (
  <div
    data-slot="tabs-v2-trigger-wrapper"
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
      data-slot="tabs-v2-trigger"
      data-value={value}
      value={value}
      {...props}
    >
      <span className="inline-flex items-center gap-2" data-slot="tabs-v2-trigger-content">
        {children}
        {subtext ? (
          <span data-slot="tabs-v2-subtext" className="ml-2 text-xs text-text-weak">
            {subtext}
          </span>
        ) : null}
      </span>
    </TabsPrimitive.Trigger>
  </div>
))
TabsV2Trigger.displayName = "TabsV2Trigger"

export interface TabsV2CloseButtonProps
  extends React.HTMLAttributes<HTMLDivElement> {}

export const TabsV2CloseButton = React.forwardRef<HTMLDivElement, TabsV2CloseButtonProps>(
  ({ className, onClick, ...props }, ref) => (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label="Close tab"
      data-slot="tabs-v2-close-button"
      className={cn(className)}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick?.(e)
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      {...props}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.8889 3.11108L3.11108 10.8889" stroke="currentColor" strokeLinejoin="round" />
        <path d="M3.11108 3.11108L10.8889 10.8889" stroke="currentColor" strokeLinejoin="round" />
      </svg>
    </div>
  ),
)
TabsV2CloseButton.displayName = "TabsV2CloseButton"

export const TabsV2Content = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    data-slot="tabs-v2-content"
    className={cn(className)}
    {...props}
  >
    {children}
  </TabsPrimitive.Content>
))
TabsV2Content.displayName = "TabsV2Content"

export const TabsV2SectionTitle: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div data-slot="tabs-v2-section-title">{children}</div>
)
TabsV2SectionTitle.displayName = "TabsV2SectionTitle"

export const TabsV2 = Object.assign(TabsV2Root, {
  List: TabsV2List,
  Trigger: TabsV2Trigger,
  CloseButton: TabsV2CloseButton,
  Content: TabsV2Content,
  SectionTitle: TabsV2SectionTitle,
})
