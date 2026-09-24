// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ToolResultBlock — tool execution result card (ZCode tool-result
 * borrowing): tool name, status pill, duration and a collapsible output
 * body that auto-collapses past a bounded line count.
 */
import { useState } from "react"
import { Wrench } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { LatencyMeter } from "./LatencyMeter"
import { StatusPill } from "./StatusPill"
import { codeShouldCollapse, toolResultModel, visibleCodeLines } from "./model"

export interface ToolResultBlockProps {
  /** Raw tool result, or a passthrough { tool, ok, durationMs, content }. */
  result: unknown
  /** Body starts expanded; long bodies still collapse past 12 lines. */
  defaultOpen?: boolean
  className?: string
}

const RESULT_COLLAPSE_LINES = 12

export function ToolResultBlock({ result, defaultOpen = false, className }: ToolResultBlockProps) {
  useLocale()
  const { tool, status, durationMs, content } = toolResultModel(result)
  const [open, setOpen] = useState(defaultOpen)
  const collapsible = codeShouldCollapse(content, RESULT_COLLAPSE_LINES)
  const shown =
    collapsible && !open
      ? visibleCodeLines(content, RESULT_COLLAPSE_LINES)
      : { text: content, hiddenCount: 0 }

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-muted/20 text-xs overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 bg-muted/40">
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium truncate" title={tool}>
          {tool !== "" ? tool : t("aiElements.tool.untitled")}
        </span>
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {durationMs !== undefined && <LatencyMeter ms={durationMs} compact />}
          <StatusPill status={status} />
        </span>
      </div>
      {content !== "" && (
        <div className="px-3 py-2">
          <pre className="overflow-x-auto font-mono leading-5 whitespace-pre-wrap break-words m-0">
            {shown.text}
          </pre>
          {collapsible && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="mt-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {open
                ? t("aiElements.tool.collapse")
                : t("aiElements.tool.moreLines", { count: shown.hiddenCount })}
            </button>
          )}
        </div>
      )}
      {content === "" && open && (
        <div className="px-3 py-2 text-muted-foreground italic">{t("aiElements.tool.empty")}</div>
      )}
      {content === "" && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full px-3 py-1.5 text-left text-muted-foreground hover:text-foreground"
        >
          {t("aiElements.tool.empty")}
        </button>
      )}
    </div>
  )
}
