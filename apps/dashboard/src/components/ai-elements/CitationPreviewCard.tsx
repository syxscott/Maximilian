// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * CitationPreviewCard — the hover card content for a citation (chat-demo
 * search/SourceCard.tsx borrowing): site mark + site name, publish date,
 * title and snippet, the whole card opening the source in a new tab.
 * Data comes from the citation payload's optional passthrough fields;
 * missing metadata is omitted (site mark falls back to the domain
 * initial — no external favicon fetches are fabricated).
 */
import { useLocale, t, formatDate } from "@max/i18n"
import { citationModel, hostnameOfUrl } from "./model"

export function CitationPreviewCard({ citation }: { citation: unknown }) {
  useLocale()
  const { title, url, snippet, siteName, siteIcon, publishedAt } = citationModel(citation)
  const domain = url !== undefined ? hostnameOfUrl(url) : ""
  const site = siteName ?? domain
  const date = publishedAt !== undefined ? formatDate(publishedAt) : ""
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block min-w-0 p-2.5"
      data-testid="citation-preview-card"
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {siteIcon ? (
          <img src={siteIcon} alt="" className="h-4 w-4 rounded-sm" />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[9px] uppercase"
          >
            {site.slice(0, 1) || "?"}
          </span>
        )}
        {site !== "" && <span className="truncate">{site}</span>}
        {site !== "" && date !== "" && <span aria-hidden="true">·</span>}
        {date !== "" && <span className="shrink-0">{date}</span>}
      </div>
      <div className="mt-1 text-xs font-medium leading-snug">
        {title !== "" ? title : t("aiElements.citation.untitled")}
      </div>
      {snippet !== undefined && (
        <div className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
          {snippet}
        </div>
      )}
    </a>
  )
}
