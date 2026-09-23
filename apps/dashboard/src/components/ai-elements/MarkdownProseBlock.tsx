// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * MarkdownProseBlock — dependency-free minimal markdown renderer for
 * assistant prose (headings, lists, bold, code spans). The model escapes
 * all input HTML BEFORE adding tags, so dangerouslySetInnerHTML stays
 * XSS-safe by construction; unknown / empty input renders the empty state.
 */
import { useMemo } from "react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { markdownToSafeHtml } from "./model"

export interface MarkdownProseBlockProps {
  /** Raw markdown string. */
  text: unknown
  className?: string
}

export function MarkdownProseBlock({ text, className }: MarkdownProseBlockProps) {
  useLocale()
  const html = useMemo(() => markdownToSafeHtml(text), [text])

  if (html === "") {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground italic",
          className,
        )}
      >
        {t("aiElements.markdown.empty")}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "space-y-1 text-sm leading-relaxed break-words [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_h3]:mt-2 [&_h3]:text-base [&_h3]:font-semibold [&_h4]:mt-1.5 [&_h4]:text-sm [&_h4]:font-semibold [&_h5]:mt-1 [&_h5]:text-sm [&_h5]:font-medium [&_h6]:mt-1 [&_h6]:text-xs [&_h6]:font-medium [&_li]:ml-4 [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_p]:m-0 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:space-y-0.5",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
