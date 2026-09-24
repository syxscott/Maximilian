// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * search renderer — web search. Body shows the query, the scoped
 * allow/deny domain lists and the hit count as rows, with the first
 * results rendered as a citation-style list of ai-elements CitationBlock
 * ordinals (web.model.ts extractSearch); JSON fallback when the payload
 * is opaque.
 */

import { useLocale, t } from "@max/i18n"
import { CitationBlock } from "@/components/ai-elements"
import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractSearch } from "./web.model"

export const SEARCH_GLYPH = "⌕"

export function SearchBody(props: ToolCallProps) {
  const vm = extractSearch(props.input)
  return (
    <BodyShell
      titleKey="toolRenderers.search.title"
      vm={vm.isEmpty ? vm : { ...vm, code: undefined }}
      input={props.input}
      extra={
        vm.isEmpty || vm.topResults.length === 0 ? undefined : (
          <SearchCitations titles={vm.topResults.map((r) => r.title)} />
        )
      }
    />
  )
}

/** Numbered citation chips for the first hits, in result order. */
function SearchCitations({ titles }: { titles: string[] }) {
  useLocale()
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1" data-testid="search-citations">
      <span className="text-[10px] uppercase text-muted-foreground">
        {t("toolRenderers.search.topResults")}
      </span>
      {titles.map((title, i) => (
        <CitationBlock key={i} citation={{ index: i + 1, title }} />
      ))}
    </div>
  )
}
