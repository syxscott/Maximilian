// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * WebSearchBlock — search result card (ZCode web-search borrowing):
 * query header plus a bounded result list, each with a domain-avatar
 * placeholder favicon, title link and snippet. Non-http(s) URLs degrade
 * to plain text titles.
 */
import { Search } from "lucide-react"
import { useLocale, t, formatNumber } from "@max/i18n"
import { cn } from "@/lib/utils"
import { webSearchModel } from "./model"

export interface WebSearchBlockProps {
  /** Passthrough { query, results: [...] } part. */
  search: unknown
  className?: string
}

export function WebSearchBlock({ search, className }: WebSearchBlockProps) {
  useLocale()
  const { query, results, truncated } = webSearchModel(search)

  return (
    <section
      aria-label={t("aiElements.webSearch.aria")}
      className={cn(
        "rounded-md border border-border bg-muted/20 text-xs overflow-hidden",
        className,
      )}
    >
      <header className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 bg-muted/40">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium truncate" title={query}>
          {query !== "" ? query : t("aiElements.webSearch.noQuery")}
        </span>
        {results.length > 0 && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {t("aiElements.webSearch.count", { count: formatNumber(results.length) })}
          </span>
        )}
      </header>
      {results.length === 0 ? (
        <div className="px-3 py-2 text-muted-foreground italic">
          {t("aiElements.webSearch.empty")}
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {results.map((result, i) => (
            <li key={i} className="flex gap-2 px-3 py-2">
              <span
                aria-hidden="true"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] uppercase text-muted-foreground"
              >
                {result.domain.slice(0, 1) || "?"}
              </span>
              <span className="min-w-0 flex flex-col gap-0.5">
                {result.url !== undefined ? (
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-medium text-blue-700 hover:underline"
                    title={result.title}
                  >
                    {result.title !== "" ? result.title : result.url}
                  </a>
                ) : (
                  <span className="truncate font-medium" title={result.title}>
                    {result.title !== "" ? result.title : t("aiElements.webSearch.untitled")}
                  </span>
                )}
                {result.snippet !== undefined && (
                  <span className="text-muted-foreground line-clamp-2">{result.snippet}</span>
                )}
                {result.domain !== "" && (
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {result.domain}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {truncated && (
        <footer className="px-3 py-1 border-t border-border/60 text-[10px] text-muted-foreground">
          {t("aiElements.webSearch.truncated")}
        </footer>
      )}
    </section>
  )
}
