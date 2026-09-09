import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "../../lib/utils.js"

export interface TooltipV2Props {
  value: React.ReactNode
  children: React.ReactElement
  className?: string
  contentClass?: string
  contentStyle?: React.CSSProperties
  inactive?: boolean
  forceOpen?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  delayDuration?: number
  placement?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  sideOffset?: number
  alignOffset?: number
  disableHoverableContent?: boolean
}

export const TooltipProvider: React.FC<React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>> = (
  props,
) => <TooltipPrimitive.Provider delayDuration={0} {...props} />

export const TooltipV2: React.FC<TooltipV2Props> = ({
  value,
  children,
  className,
  contentClass,
  contentStyle,
  inactive,
  forceOpen,
  defaultOpen,
  open,
  onOpenChange,
  delayDuration = 0,
  placement = "top",
  align = "center",
  sideOffset = 4,
  alignOffset = 0,
  disableHoverableContent,
}) => {
  const triggerRef = React.useRef<HTMLDivElement | null>(null)
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [block, setBlock] = React.useState(false)
  const [expand, setExpand] = React.useState(false)
  const justClickedTriggerRef = React.useRef(false)

  const isOpen = !!(forceOpen || open || internalOpen)

  const inside = () => {
    const active = typeof document !== "undefined" ? document.activeElement : null
    if (!triggerRef.current || !active) return false
    return triggerRef.current.contains(active)
  }

  const drop = (overrideExpand?: boolean) => {
    const useExpand = overrideExpand ?? expand
    if (useExpand) return
    if (triggerRef.current?.matches(":hover")) return
    if (inside()) return
    setBlock(false)
  }

  const sync = React.useCallback(() => {
    const e = !!triggerRef.current?.querySelector('[aria-expanded="true"], [data-expanded]')
    setExpand(e)
    if (e) {
      setBlock(true)
      setInternalOpen(false)
      return
    }
    drop(e)
  }, [expand])

  React.useEffect(() => {
    if (!triggerRef.current) return
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(triggerRef.current, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-expanded"],
    })
    return () => obs.disconnect()
  }, [sync])

  if (inactive) {
    return <>{children}</>
  }

  const handleOpenChange = (next: boolean) => {
    if (forceOpen) return
    if (block && next) return
    if (justClickedTriggerRef.current) {
      justClickedTriggerRef.current = false
      return
    }
    if (onOpenChange) {
      onOpenChange(next)
    } else {
      setInternalOpen(next)
    }
  }

  const arm = () => {
    setBlock(true)
    setInternalOpen(false)
  }

  const leave = () => {
    if (!inside()) setInternalOpen(false)
    drop()
  }

  return (
    <TooltipPrimitive.Root
      delayDuration={delayDuration}
      disableHoverableContent={disableHoverableContent}
      open={isOpen}
      onOpenChange={handleOpenChange}
      defaultOpen={defaultOpen}
    >
      <TooltipPrimitive.Trigger asChild>
        <div
          ref={triggerRef}
          data-component="tooltip-v2-trigger"
          className={cn(className)}
          onPointerDownCapture={arm}
          onKeyDownCapture={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return
            arm()
          }}
          onPointerLeave={leave}
          onFocus={() => undefined}
          onBlur={() => requestAnimationFrame(() => drop())}
        >
          {children}
        </div>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={placement}
          align={align}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          data-component="tooltip-v2"
          data-placement={placement}
          data-force-open={forceOpen ? "" : undefined}
          className={cn(contentClass)}
          style={contentStyle}
          onPointerDownOutside={(e) => {
            if (
              triggerRef.current === (e.target as Node) ||
              (e.target instanceof Node && triggerRef.current?.contains(e.target))
            ) {
              justClickedTriggerRef.current = true
            }
            e.preventDefault()
          }}
        >
          {value}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
TooltipV2.displayName = "TooltipV2"
