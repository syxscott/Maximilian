// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TokenUsageBadge — compact input/output/cache token breakdown for a
 * message part (ZCode usage borrowing). Numbers go through @max/i18n's
 * locale-aware formatTokens (12340 → "12.3K").
 */
import { Coins } from "lucide-react"
import { useLocale, t, formatTokens } from "@max/i18n"
import { cn } from "@/lib/utils"
import { tokenUsageModel } from "./model"

export interface TokenUsageBadgeProps {
  /** Passthrough usage payload ({ input, output, cacheRead, total }). */
  usage: unknown
  className?: string
}

export function TokenUsageBadge({ usage, className }: TokenUsageBadgeProps) {
  useLocale()
  const { input, output, cacheRead, total, known } = tokenUsageModel(usage)

  if (!known) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground italic",
          className,
        )}
      >
        {t("aiElements.usage.unknown")}
      </span>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground",
        className,
      )}
      title={t("aiElements.usage.aria")}
    >
      <Coins className="h-3 w-3" aria-hidden="true" />
      <span className="font-mono tabular-nums text-foreground">{formatTokens(total)}</span>
      <span className="font-mono tabular-nums">
        {t("aiElements.usage.in")} {formatTokens(input)}
      </span>
      <span aria-hidden="true">·</span>
      <span className="font-mono tabular-nums">
        {t("aiElements.usage.out")} {formatTokens(output)}
      </span>
      {cacheRead > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            {t("aiElements.usage.cache")} {formatTokens(cacheRead)}
          </span>
        </>
      )}
    </span>
  )
}
