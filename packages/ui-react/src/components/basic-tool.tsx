"use client"

import * as React from "react"
import * as Collapsible from "@radix-ui/react-collapsible"
import { cn } from "../lib/utils"

export type IconName =
  | "glasses"
  | "bullet-list"
  | "magnifying-glass-menu"
  | "window-cursor"
  | "task"
  | "console"
  | "code-lines"
  | "checklist"
  | "bubble-5"
  | "brain"
  | "mcp"
  | "reset"
  | "copy"
  | "check"
  | "dot-grid"
  | "enter"
  | "chevron-grabber-vertical"
  | "chevron-down"
  | "open-file"
  | "square-arrow-top-right"
  | "circle-ban-sign"

export type TriggerTitle = {
  title: string
  titleClass?: string
  subtitle?: string
  subtitleClass?: string
  args?: string[]
  argsClass?: string
  action?: React.ReactNode
}

export interface BasicToolProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "title"> {
  icon: IconName
  trigger: TriggerTitle | React.ReactNode
  children?: React.ReactNode
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  forceOpen?: boolean
  defer?: boolean
  locked?: boolean
  animated?: boolean
  onSubtitleClick?: () => void
  onTriggerClick?: React.MouseEventHandler<HTMLElement>
  triggerHref?: string
  clickable?: boolean
}

const isTriggerTitle = (val: unknown): val is TriggerTitle => {
  return (
    typeof val === "object" &&
    val !== null &&
    "title" in (val as Record<string, unknown>) &&
    typeof (val as Record<string, unknown>).title === "string"
  )
}

export const BasicTool: React.FC<BasicToolProps> = ({
  icon,
  trigger,
  children,
  status,
  hideDetails,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  forceOpen,
  defer,
  locked,
  animated,
  onSubtitleClick,
  onTriggerClick,
  triggerHref,
  clickable,
  className,
  ...rest
}) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const [ready, setReady] = React.useState(!defer && defaultOpen)
  const open = openProp ?? internalOpen
  const pending = status === "pending" || status === "running"
  const hasChildren = defer ? true : !!children

  const cancelReadyRef = React.useRef<(() => void) | undefined>(undefined)
  const cancelReady = () => {
    cancelReadyRef.current?.()
    cancelReadyRef.current = undefined
  }

  const scheduleReady = React.useCallback(
    (initial = false) => {
      cancelReady()
      const schedule = initial ? requestAnimationFrame : requestAnimationFrame
      const id = schedule(() => {
        cancelReadyRef.current = undefined
        if (!open) return
        setReady(true)
      })
      cancelReadyRef.current = () => cancelAnimationFrame(id)
    },
    [open],
  )

  React.useEffect(() => {
    if (defer && open) scheduleReady(true)
    return cancelReady
  }, [])

  React.useEffect(() => {
    if (forceOpen && !open) {
      if (openProp === undefined) setInternalOpen(true)
      onOpenChange?.(true)
    }
  }, [forceOpen])

  React.useEffect(() => {
    if (!defer) return
    if (!open) {
      cancelReady()
      setReady(false)
      return
    }
    scheduleReady()
    return cancelReady
  }, [open, defer, scheduleReady])

  const setOpen = (value: boolean) => {
    if (openProp === undefined) setInternalOpen(value)
    onOpenChange?.(value)
  }

  const handleOpenChange = (value: boolean) => {
    if (pending) return
    if (locked && !value) return
    setOpen(value)
  }

  const contentRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (!animated || !contentRef.current) return
    const el = contentRef.current
    if (open) {
      el.style.overflow = "hidden"
      el.style.height = `${el.scrollHeight}px`
      const handle = window.setTimeout(() => {
        el.style.overflow = "visible"
        el.style.height = "auto"
      }, 350)
      return () => window.clearTimeout(handle)
    } else {
      el.style.overflow = "hidden"
      el.style.height = "0px"
    }
  }, [open, animated])

  const triggerNode = (
    <div
      data-component="tool-trigger"
      data-clickable={clickable ? "true" : undefined}
      data-hide-details={hideDetails ? "true" : undefined}
    >
      <div data-slot="basic-tool-tool-trigger-content">
        <div data-slot="basic-tool-tool-info">
          {isTriggerTitle(trigger) ? (
            <div data-slot="basic-tool-tool-info-structured">
              <div data-slot="basic-tool-tool-info-main">
                <span
                  data-slot="basic-tool-tool-title"
                  className={cn(trigger.titleClass)}
                >
                  <span data-slot="text-shimmer-char">
                    <span data-slot="text-shimmer-char-base" aria-hidden="true">
                      {trigger.title}
                    </span>
                  </span>
                </span>
                {!pending && (
                  <>
                    {trigger.subtitle && (
                      <span
                        data-slot="basic-tool-tool-subtitle"
                        className={cn(trigger.subtitleClass, {
                          clickable: !!onSubtitleClick,
                        })}
                        onClick={(e) => {
                          if (onSubtitleClick) {
                            e.stopPropagation()
                            onSubtitleClick()
                          }
                        }}
                      >
                        {trigger.subtitle}
                      </span>
                    )}
                    {trigger.args?.length ? (
                      <>
                        {trigger.args.map((arg, i) => (
                          <span
                            key={i}
                            data-slot="basic-tool-tool-arg"
                            className={cn(trigger.argsClass)}
                          >
                            {arg}
                          </span>
                        ))}
                      </>
                    ) : null}
                  </>
                )}
              </div>
              {!pending && trigger.action && (
                <span data-slot="basic-tool-tool-action">{trigger.action}</span>
              )}
            </div>
          ) : (
            trigger
          )}
        </div>
      </div>
      {hasChildren && !hideDetails && !locked && !pending && (
        <Collapsible.Trigger asChild>
          <span data-slot="collapsible-arrow" className="ml-2">
            ▾
          </span>
        </Collapsible.Trigger>
      )}
    </div>
  )

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={handleOpenChange}
      className={cn("tool-collapsible", className)}
      data-hide-details={hideDetails ? "true" : undefined}
      {...rest}
    >
      {triggerHref ? (
        <Collapsible.Trigger asChild>
          <a
            href={triggerHref}
            data-hide-details={hideDetails ? "true" : undefined}
            onClick={onTriggerClick}
          >
            {triggerNode}
          </a>
        </Collapsible.Trigger>
      ) : (
        <Collapsible.Trigger
          asChild
          data-hide-details={hideDetails ? "true" : undefined}
          onClick={onTriggerClick}
        >
          <div>{triggerNode}</div>
        </Collapsible.Trigger>
      )}
      {animated && hasChildren && !hideDetails ? (
        <div
          ref={contentRef}
          data-slot="collapsible-content"
          data-animated
          style={{
            height: open ? "auto" : "0px",
            overflow: open ? "visible" : "hidden",
          }}
        >
          {(!defer || ready) && children}
        </div>
      ) : (
        !animated &&
        hasChildren &&
        !hideDetails && (
          <Collapsible.Content>
            {(!defer || ready) && children}
          </Collapsible.Content>
        )
      )}
    </Collapsible.Root>
  )
}

function label(input: Record<string, unknown> | undefined) {
  const keys = ["description", "query", "url", "filePath", "path", "pattern", "name"]
  for (const key of keys) {
    const value = input?.[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function args(input: Record<string, unknown> | undefined) {
  if (!input) return [] as string[]
  const skip = new Set(["description", "query", "url", "filePath", "path", "pattern", "name"])
  return Object.entries(input)
    .filter(([key]) => !skip.has(key))
    .flatMap(([key, value]) => {
      if (typeof value === "string") return [`${key}=${value}`]
      if (typeof value === "number") return [`${key}=${value}`]
      if (typeof value === "boolean") return [`${key}=${value}`]
      return []
    })
    .slice(0, 3)
}

export interface GenericToolProps {
  tool: string
  status?: string
  hideDetails?: boolean
  input?: Record<string, unknown>
}

export const GenericTool: React.FC<GenericToolProps> = ({ tool, status, hideDetails, input }) => {
  return (
    <BasicTool
      icon="mcp"
      status={status}
      trigger={{
        title: `Called ${tool}`,
        subtitle: label(input),
        args: args(input),
      }}
      hideDetails={hideDetails}
    />
  )
}