// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * CitationBlock — numbered source reference (ZCode citation borrowing):
 * ordinal badge + source title, hyperlinked when a safe http(s) URL is
 * present (target=_blank + rel="noopener noreferrer").
 *
 * Hover preview variant: citations WITH a URL get a 300ms-hover portal
 * card (site mark / site name / date / title / snippet — chat-demo
 * CitationLink + SourceCard borrowing); the click still opens the source
 * in a new tab. Citations without a URL keep the static chip — no hover
 * affordance is offered for something that cannot be opened.
 */
import { ExternalLink } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { citationModel } from "./model"
import { HoverCard, type HoverCardTrigger } from "./HoverCard"
import { CitationPreviewCard } from "./CitationPreviewCard"

export interface CitationBlockProps {
  /** Passthrough citation payload ({ index, title, url, …preview fields }). */
  citation: unknown
  className?: string
  /**
   * Disable the hover preview (e.g. dense inline contexts that render the
   * plain ordinal). Default: hover is enabled whenever a URL exists.
   */
  disableHover?: boolean
}

export function CitationBlock({ citation, className, disableHover = false }: CitationBlockProps) {
  useLocale()
  const { index, title, url } = citationModel(citation)
  const ordinal = t("aiElements.citation.ordinal", { n: index })
  const label = title || t("aiElements.citation.untitled")

  // Hover-capable variant: the whole chip is the trigger; the anchor keeps
  // its native new-tab semantics under the hover card.
  if (url !== undefined && !disableHover) {
    const renderTrigger: HoverCardTrigger = ({ domRef, domProps }) => (
      <span
        ref={domRef}
        {...domProps}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-xs",
          className,
        )}
        data-testid="citation-block"
        data-hover-preview="true"
      >
        <span
          className="shrink-0 rounded-sm bg-primary/10 px-1 font-mono text-[10px] text-primary tabular-nums"
          aria-label={t("aiElements.citation.ariaSource")}
        >
          {ordinal}
        </span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 truncate text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
          title={title || url}
        >
          {label}
        </a>
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      </span>
    )
    return (
      <HoverCard renderTrigger={renderTrigger}>
        <CitationPreviewCard citation={citation} />
      </HoverCard>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-xs",
        className,
      )}
      data-testid="citation-block"
      data-hover-preview="false"
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
          {label}
        </a>
      ) : (
        <span className="min-w-0 truncate text-muted-foreground" title={title}>
          {label}
        </span>
      )}
      {url && (
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </span>
  )
}
