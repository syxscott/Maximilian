"use client"

import * as React from "react"
import * as Collapsible from "@radix-ui/react-collapsible"
import { cn } from "../lib/utils"

export interface ToolErrorCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  tool: string
  error: string
  title?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  subtitle?: string
  href?: string
}

const TOOL_NAME_MAP: Record<string, string> = {
  read: "Read",
  list: "List",
  glob: "Glob",
  grep: "Grep",
  task: "Task",
  webfetch: "Web Fetch",
  websearch: "Web Search",
  bash: "Shell",
  apply_patch: "Patch",
  question: "Questions",
}

export const ToolErrorCard: React.FC<ToolErrorCardProps> = ({
  tool,
  error,
  title,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  subtitle,
  href,
  className,
  ...rest
}) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const [copied, setCopied] = React.useState(false)
  const open = openProp ?? internalOpen

  const setOpen = (value: boolean) => {
    if (openProp === undefined) setInternalOpen(value)
    onOpenChange?.(value)
  }

  const name = title ?? TOOL_NAME_MAP[tool] ?? tool
  const cleaned = error.replace(/^Error:\s*/, "").trim()
  const tail = (() => {
    const prefix = `${tool} `
    if (cleaned.startsWith(prefix)) return cleaned.slice(prefix.length)
    return cleaned
  })()

  const computedSubtitle = subtitle ?? (() => {
    const parts = tail.split(": ")
    if (parts.length <= 1) return "Failed"
    const head = (parts[0] ?? "").trim()
    if (!head) return "Failed"
    return head[0] ? head[0].toUpperCase() + head.slice(1) : "Failed"
  })()

  const body = (() => {
    const parts = tail.split(": ")
    if (parts.length <= 1) return cleaned
    return parts.slice(1).join(": ").trim() || cleaned
  })()

  const copy = async () => {
    if (!cleaned) return
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(cleaned)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div
      {...rest}
      data-kind="tool-error-card"
      data-open={open ? "true" : "false"}
      className={cn(
        "rounded-lg border border-border-base bg-background-base p-4",
        "border-border-error-base/40",
        className,
      )}
    >
      <Collapsible.Root
        className="tool-collapsible"
        data-open={open ? "true" : "false"}
        open={open}
        onOpenChange={setOpen}
      >
        <Collapsible.Trigger asChild>
          <div data-component="tool-trigger">
            <div data-slot="basic-tool-tool-trigger-content">
              <span data-slot="basic-tool-tool-indicator" data-component="tool-error-card-icon">
                <ErrorIcon />
              </span>
              <div data-slot="basic-tool-tool-info">
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span data-slot="basic-tool-tool-title">{name}</span>
                    {href && subtitle ? (
                      <a
                        data-slot="basic-tool-tool-subtitle"
                        className="clickable subagent-link"
                        href={href}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {computedSubtitle}
                      </a>
                    ) : (
                      <span data-slot="basic-tool-tool-subtitle">{computedSubtitle}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <span className="ml-2 text-xs">▼</span>
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div data-slot="tool-error-card-content" className="mt-2 flex flex-col gap-2">
            {open && (
              <div data-slot="tool-error-card-copy" className="flex justify-end">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void copy()
                  }}
                  aria-label={copied ? "Copied" : "Copy error"}
                  className="rounded p-1 hover:bg-background-stronger"
                >
                  {copied ? "✓" : "Copy"}
                </button>
              </div>
            )}
            {body && (
              <div className="text-13-regular text-text-weak whitespace-pre-wrap">{body}</div>
            )}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  )
}

const ErrorIcon: React.FC = () => (
  <svg
    data-slot="icon"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <circle cx="8" cy="8" r="6" />
    <path d="M5 5l6 6M11 5l-6 6" />
  </svg>
)