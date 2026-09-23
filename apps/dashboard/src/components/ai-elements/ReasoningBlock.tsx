// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ReasoningBlock — collapsible "thinking" section for assistant messages
 * (ZCode reasoning-part borrowing). Collapsed by default; the summary row
 * shows the thinking budget spent (duration) and volume (char count).
 */
import { useState } from "react"
import { Brain, ChevronDown, ChevronUp } from "lucide-react"
import { useLocale, t, formatDuration } from "@max/i18n"
import { cn } from "@/lib/utils"
import { reasoningModel } from "./model"

export interface ReasoningBlockProps {
  /** Raw reasoning string, or a passthrough { text, durationMs } part. */
  input: unknown
  defaultOpen?: boolean
  className?: string
}

export function ReasoningBlock({ input, defaultOpen = false, className }: ReasoningBlockProps) {
  useLocale()
  const [open, setOpen] = useState(defaultOpen)
  const { text, chars, durationMs } = reasoningModel(input)

  // Nothing to show at all — render nothing rather than an empty shell.
  if (text === "") return null

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className={cn("rounded-md border border-border bg-muted/20 text-xs", className)}
    >
      <summary className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none text-muted-foreground hover:text-foreground">
        <Brain className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{t("aiElements.reasoning.title")}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/80 tabular-nums">
          {durationMs !== undefined
            ? t("aiElements.reasoning.meta", { duration: formatDuration(durationMs), chars })
            : t("aiElements.reasoning.metaChars", { chars })}
        </span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </summary>
      <div className="px-3 pb-2 pt-1 border-t border-border/60 whitespace-pre-wrap break-words text-muted-foreground">
        {text}
      </div>
    </details>
  )
}
