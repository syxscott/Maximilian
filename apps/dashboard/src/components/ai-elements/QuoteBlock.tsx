// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * QuoteBlock — attributed quotation (editorial borrowing): left-ruled
 * blockquote with the source attribution on the footer line.
 */
import { Quote } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { quoteModel } from "./model"

export interface QuoteBlockProps {
  /** Raw quote string, or passthrough { text, source }. */
  quote: unknown
  className?: string
}

export function QuoteBlock({ quote, className }: QuoteBlockProps) {
  useLocale()
  const { text, source } = quoteModel(quote)

  if (text === "") return null

  return (
    <figure
      aria-label={t("aiElements.quote.aria")}
      className={cn("border-l-2 border-border pl-3 text-xs", className)}
    >
      <Quote aria-hidden="true" className="mb-1 h-3 w-3 text-muted-foreground/50" />
      <blockquote className="whitespace-pre-wrap break-words text-foreground/90">{text}</blockquote>
      {source !== undefined && (
        <figcaption className="mt-1 text-[10px] text-muted-foreground">
          {t("aiElements.quote.source", { source })}
        </figcaption>
      )}
    </figure>
  )
}
