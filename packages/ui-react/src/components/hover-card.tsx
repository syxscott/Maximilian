import * as React from "react"
import * as HoverCardPrimitive from "@radix-ui/react-hover-card"
import { cn } from "../lib/utils"

export interface HoverCardProps {
  trigger: React.ReactNode
  mount?: HTMLElement
  className?: string
  children?: React.ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  openDelay?: number
  closeDelay?: number
}

export function HoverCard(props: HoverCardProps) {
  const { trigger, mount, className, children, open, defaultOpen, onOpenChange, openDelay, closeDelay } = props

  return (
    <HoverCardPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      openDelay={openDelay}
      closeDelay={closeDelay}
    >
      <HoverCardPrimitive.Trigger asChild>
        <div data-slot="hover-card-trigger" tabIndex={-1} className="inline-block">
          {trigger}
        </div>
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal container={mount}>
        <HoverCardPrimitive.Content
          sideOffset={4}
          data-component="hover-card-content"
          className={cn(
            "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
            "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            className,
          )}
        >
          <div data-slot="hover-card-body">{children}</div>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  )
}