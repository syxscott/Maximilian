// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * CitationBlock — numbered source reference (ZCode citation borrowing):
 * ordinal badge + source title, hyperlinked when a safe http(s) URL is
 * present (target=_blank + rel="noopener noreferrer").
 */
import { ExternalLink } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { citationModel } from "./model"

export interface CitationBlockProps {
  /** Passthrough citation payload ({ index, title, url }). */
  citation: unknown
  className?: string
}

export function CitationBlock({ citation, className }: CitationBlockProps) {
  useLocale()
  const { index, title, url } = citationModel(citation)
  const ordinal = t("aiElements.citation.ordinal", { n: index })

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-xs",
        className,
      )}
    >
      <span
        className="shrink-0 rounded-sm bg-primary/10 px-1 font-mono text-[10px] text-primary tabular-nums"
        aria-label={t("aiElements.citation.ariaSource")}
      >
        {ordinal}
      </span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 truncate text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
          title={title || url}
        >
          {title || t("aiElements.citation.untitled")}
        </a>
      ) : (
        <span className="min-w-0 truncate text-muted-foreground" title={title}>
          {title || t("aiElements.citation.untitled")}
        </span>
      )}
      {url && (
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </span>
  )
}
