// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ShareView — read-only share preview over the structured section model
 * (shareSections): one section per turn with heading, stats and markdown
 * body, plus a copy-to-clipboard button. No inputs, no fetching — the
 * only interaction is the copy.
 */

import { useMemo, useState } from "react"
import { useLocale, t } from "@max/i18n"
import { Button } from "@/components/ui/button"
import type { ConversationUnit } from "./model"
import { shareSections, toShareMarkdown } from "./model"

export function ShareView({
  units,
  workspaceTitle = null,
}: {
  units: ConversationUnit[]
  /** Document title tail (workspace request head, or null). */
  workspaceTitle?: string | null
}) {
  useLocale()
  const [copied, setCopied] = useState(false)
  const doc = useMemo(() => shareSections(units, { workspaceTitle }), [units, workspaceTitle])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toShareMarkdown(doc))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  if (doc.sections.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground" data-testid="share-empty">
        {t("conversation.share.empty")}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-testid="share-view">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" data-testid="share-title">
            {doc.title || t("conversation.share.untitled")}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="share-stats">
            {t("conversation.share.stats", {
              turns: doc.stats.turns,
              units: doc.stats.units,
              tools: doc.stats.tools,
              retries: doc.stats.retries,
            })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={copy}
          data-testid="share-copy"
        >
          {copied ? `✓ ${t("conversation.share.copied")}` : t("conversation.share.copy")}
        </Button>
      </div>
      {doc.sections.map((section) => (
        <section
          key={section.turnId}
          className="rounded-lg border bg-card/60 p-3"
          data-testid="share-section"
          data-turn-id={section.turnId}
        >
          <header className="flex items-baseline gap-2">
            <h3 className="text-sm font-medium" data-testid="share-section-heading">
              {section.heading}
            </h3>
            <span
              className="ml-auto shrink-0 text-[10px] text-muted-foreground"
              data-testid="share-section-stats"
            >
              {t("conversation.share.sectionStats", {
                units: section.stats.units,
                tools: section.stats.tools,
              })}
            </span>
          </header>
          {section.excerpt !== "" && (
            <p className="mt-1 truncate text-xs text-muted-foreground" data-testid="share-excerpt">
              {section.excerpt}
            </p>
          )}
          {section.lines.length > 0 && (
            <pre
              className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground/90"
              data-testid="share-body"
            >
              {section.lines.join("\n")}
            </pre>
          )}
        </section>
      ))}
    </div>
  )
}
