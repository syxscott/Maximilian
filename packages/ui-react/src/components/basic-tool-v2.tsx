import {
  type ReactNode,
  type HTMLAttributes,
  useState,
  useCallback,
} from "react"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import { cn } from "../lib/utils"
import { DiffChanges, type DiffChangesSingle } from "./diff-changes-v2"
import { TextShimmerV2 } from "./text-shimmer-v2"

function ChevronIcon() {
  return (
    <svg
      data-slot="basic-tool-v2-chevron"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="transition-transform data-[state=open]:rotate-90"
    >
      <path
        d="M6.75194 10.6243C6.41861 10.8187 6 10.5783 6 10.1924V5.80837C6 5.42247 6.41861 5.18204 6.75194 5.37648L10.5096 7.56846C10.8404 7.7614 10.8404 8.2393 10.5096 8.43224L6.75194 10.6243Z"
        fill="currentColor"
      />
    </svg>
  )
}

export interface BasicToolV2TriggerTitle {
  title: string
  subtitle?: string
  args?: string[]
  changes?: DiffChangesSingle | DiffChangesSingle[]
  action?: ReactNode
}

function isTriggerTitle(val: unknown): val is BasicToolV2TriggerTitle {
  return (
    typeof val === "object" &&
    val !== null &&
    "title" in val &&
    (typeof Node === "undefined" || !(val instanceof Node))
  )
}

export interface BasicToolV2Props
  extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "title"> {
  trigger: BasicToolV2TriggerTitle | ReactNode
  children?: ReactNode
  status?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  onSubtitleClick?: () => void
}

export function BasicToolV2({
  trigger,
  children,
  status,
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  onSubtitleClick,
  className,
  ...rest
}: BasicToolV2Props) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const pending = status === "pending" || status === "running"
  const hasChildren = children != null
  const canExpand = hasChildren && !pending

  const handleOpenChange = useCallback(
    (value: boolean) => {
      if (pending) return
      onOpenChange?.(value)
      if (!isControlled) setInternalOpen(value)
    },
    [pending, onOpenChange, isControlled],
  )

  return (
    <CollapsiblePrimitive.Root
      data-component="basic-tool-v2"
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={handleOpenChange}
      disabled={!canExpand}
      className={cn(className)}
      {...(rest as Record<string, unknown>)}
    >
      <CollapsiblePrimitive.Trigger
        asChild
        disabled={!canExpand}
      >
        <div
          role="button"
          tabIndex={0}
          data-slot="basic-tool-v2-trigger"
          className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/50 data-[disabled]:cursor-default data-[disabled]:hover:bg-transparent"
        >
          <div data-slot="basic-tool-v2-labels" className="flex flex-1 flex-wrap items-center gap-1.5 text-sm">
            {isTriggerTitle(trigger) ? (
              <>
                <span data-slot="basic-tool-v2-title" className="font-medium">
                  <TextShimmerV2 text={trigger.title} active={pending} />
                </span>
                {!pending && trigger.subtitle && (
                  <>
                    <span data-slot="basic-tool-v2-sep" aria-hidden="true" className="text-muted-foreground">
                      ·
                    </span>
                    <span
                      data-slot="basic-tool-v2-subtitle"
                      className={cn(onSubtitleClick && "cursor-pointer hover:underline")}
                      onClick={(e) => {
                        if (onSubtitleClick) {
                          e.stopPropagation()
                          onSubtitleClick()
                        }
                      }}
                    >
                      {trigger.subtitle}
                    </span>
                  </>
                )}
                {!pending && trigger.args && trigger.args.length > 0 && (
                  <>
                    {trigger.args.map((arg, i) => (
                      <span key={i} data-slot="basic-tool-v2-arg" className="text-muted-foreground">
                        {arg}
                      </span>
                    ))}
                  </>
                )}
                {!pending && trigger.changes && (
                  <span data-slot="basic-tool-v2-diff">
                    <DiffChanges changes={trigger.changes} />
                  </span>
                )}
                {!pending && trigger.action && <span data-slot="basic-tool-v2-action">{trigger.action}</span>}
              </>
            ) : (
              trigger
            )}
          </div>
          {canExpand && (
            <span data-slot="basic-tool-v2-chevron-wrap" className="ml-auto">
              <ChevronIcon />
            </span>
          )}
        </div>
      </CollapsiblePrimitive.Trigger>
      {canExpand && (
        <CollapsiblePrimitive.Content data-slot="basic-tool-v2-content">
          <div data-slot="basic-tool-v2-content-inner" className="px-2 pb-2 pt-1">
            {children}
          </div>
        </CollapsiblePrimitive.Content>
      )}
    </CollapsiblePrimitive.Root>
  )
}