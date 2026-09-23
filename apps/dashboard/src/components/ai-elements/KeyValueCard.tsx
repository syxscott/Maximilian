// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * KeyValueCard — generic metadata display (ZCode properties-card
 * borrowing): flattens a passthrough object into key/value rows. Empty
 * input renders the localized empty state, never a bare card.
 */
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { keyValueEntries } from "./model"

export interface KeyValueCardProps {
  /** Passthrough metadata object (or array of { key, value }). */
  data: unknown
  title?: string
  className?: string
}

export function KeyValueCard({ data, title, className }: KeyValueCardProps) {
  useLocale()
  const entries = keyValueEntries(data)

  return (
    <div className={cn("rounded-md border border-border overflow-hidden text-xs", className)}>
      {title && (
        <div className="px-3 py-1.5 border-b border-border bg-muted/40 font-medium text-muted-foreground">
          {title}
        </div>
      )}
      {entries.length === 0 ? (
        <div className="px-3 py-2 text-muted-foreground italic">
          {t("aiElements.keyValue.empty")}
        </div>
      ) : (
        <dl className="divide-y divide-border/60">
          {entries.map((entry) => (
            <div key={entry.key} className="flex gap-3 px-3 py-1.5">
              <dt className="w-1/3 shrink-0 truncate text-muted-foreground" title={entry.key}>
                {entry.key}
              </dt>
              <dd className="min-w-0 flex-1 break-all font-mono">{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
