// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DocumentPreviewBlock — plain-text document preview (ZCode document
 * borrowing): shows the first N lines with an expander for the rest.
 * Model does the truncation math; the component only toggles.
 */
import { useState } from "react"
import { ChevronDown, ChevronUp, FileText } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { documentPreviewModel } from "./model"

export interface DocumentPreviewBlockProps {
  /** Raw document text. */
  text: unknown
  /** Lines shown before the expander kicks in. */
  visibleLines?: number
  className?: string
}

export function DocumentPreviewBlock({
  text,
  visibleLines = 40,
  className,
}: DocumentPreviewBlockProps) {
  useLocale()
  const [open, setOpen] = useState(false)
  const model = documentPreviewModel(text, open ? Number.POSITIVE_INFINITY : visibleLines)

  if (model.text === "" && model.totalLines === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-xs text-muted-foreground italic",
          className,
        )}
      >
        {t("aiElements.document.empty")}
      </div>
    )
  }

  return (
    <figure
      className={cn(
        "rounded-md border border-border bg-muted/20 overflow-hidden text-xs",
        className,
      )}
    >
      <figcaption className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-muted/40 text-muted-foreground">
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        {t("aiElements.document.title", { lines: model.totalLines })}
      </figcaption>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 font-mono leading-5">
        {model.text}
      </pre>
      {model.truncated && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1 border-t border-border px-3 py-1.5 text-left text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          aria-expanded={open}
        >
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {open
            ? t("aiElements.document.collapse")
            : t("aiElements.document.hiddenLines", { count: model.hiddenLines })}
        </button>
      )}
    </figure>
  )
}
