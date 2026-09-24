// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * RetryWaveGroup — one folded LLM retry wave (deepseek ui-conversation
 * borrowing). Collapsed: phase × attempts · total wait · last reason.
 * Expanded: the per-attempt trail the model kept while folding the
 * consecutive same-phase events.
 */

import { useState } from "react"
import { useLocale, t } from "@max/i18n"
import type { RetryUnit } from "./model"
import { formatDuration } from "./model"

export function RetryWaveGroup({ unit }: { unit: RetryUnit }) {
  useLocale()
  const [open, setOpen] = useState(false)
  const exhausted = unit.phase === "exhausted"

  return (
    <div
      className={`rounded-md border bg-amber-500/5 ${
        exhausted ? "border-destructive/50" : "border-amber-500/40"
      }`}
      data-testid="retry-wave"
      data-retry-phase={unit.phase}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="w-4 shrink-0 text-center text-amber-500">↻</span>
        <span className="shrink-0 font-medium" data-testid="retry-summary">
          {t("conversation.retry.summary", {
            phase: unit.phase,
            attempts: unit.attempts,
            delay: formatDuration(unit.totalDelayMs),
          })}
        </span>
        {unit.reason !== undefined && (
          <span
            className="min-w-0 flex-1 truncate text-muted-foreground"
            data-testid="retry-reason"
          >
            {unit.reason}
          </span>
        )}
        {unit.attempt !== undefined && unit.maxAttempts !== undefined && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {unit.attempt}/{unit.maxAttempts}
          </span>
        )}
      </button>
      {open && unit.entries.length > 0 && (
        <ul className="border-t border-amber-500/30 px-2 py-1.5" data-testid="retry-attempts">
          {unit.entries.map((entry, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">
                {t("conversation.retry.attempt", {
                  attempt: entry.attempt ?? i + 1,
                  delay: formatDuration(entry.delayMs ?? 0),
                })}
              </span>
              <span className="min-w-0 flex-1 truncate">{entry.reason ?? entry.phase}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
