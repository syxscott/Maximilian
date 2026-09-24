// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DiffStat — one-line diff summary (git-style): +N / −N badges computed
 * from a unified diff text by the model, plus an optional file count.
 * A fully empty diff renders nothing.
 */
import { useLocale, t, formatNumber } from "@max/i18n"
import { cn } from "@/lib/utils"
import { diffStatFromUnified } from "./model"

export interface DiffStatProps {
  /** Unified diff text. */
  diff: unknown
  className?: string
}

export function DiffStat({ diff, className }: DiffStatProps) {
  useLocale()
  const { added, removed, files } = diffStatFromUnified(diff)
  if (added === 0 && removed === 0 && files === 0) return null

  return (
    <span
      aria-label={t("aiElements.diffStat.aria", {
        added: formatNumber(added),
        removed: formatNumber(removed),
      })}
      className={cn("inline-flex items-center gap-1.5 text-[10px] tabular-nums", className)}
    >
      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-700">
        +{formatNumber(added)}
      </span>
      <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-red-700">
        -{formatNumber(removed)}
      </span>
      {files > 0 && (
        <span className="text-muted-foreground">
          {t("aiElements.diffStat.files", { count: formatNumber(files) })}
        </span>
      )}
    </span>
  )
}
