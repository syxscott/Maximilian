// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * useSlashCommands — "/"-prefix command completion for the prompt input
 * (ZCode chat-input borrowing). While the caret sits in the leading
 * slash token ("/nav"), the hook matches lib/commands COMMANDS
 * (navigate-type commands surface as executable navigation) and owns
 * keyboard navigation; selecting hands the raw CommandDef back to the
 * caller, which decides how to execute it.
 */

import { useMemo, useState } from "react"
import { useLocale, t } from "@max/i18n"
import type { CommandDef } from "@/lib/commands"
import { matchSlashCommands, parseSlashQuery, type SlashCommandView } from "./model"

export interface UseSlashCommandsOptions {
  /** Full input text. */
  text: string
  /** Current caret position in `text`. */
  caret: number
  /** Command picked (Enter/Tab/click on the highlighted row). */
  onSelect: (command: CommandDef) => void
}

export interface SlashCommandsState {
  /** True while the caret is inside the leading slash token. */
  open: boolean
  /** Query without the leading "/", or null when closed. */
  query: string | null
  items: SlashCommandView[]
  highlighted: number
  onKeyDown: (e: { key: string; preventDefault: () => void }) => boolean
  /** Execute the highlighted (or given) command. */
  select: (command?: CommandDef) => void
  /** Hidden message while the user dismissed the popup with Escape. */
  dismissed: boolean
}

export function useSlashCommands(options: UseSlashCommandsOptions): SlashCommandsState {
  useLocale() // re-render (and re-translate titles) when the locale flips
  const { text, caret, onSelect } = options
  const [highlighted, setHighlighted] = useState(0)
  /** The query the user dismissed with Escape; popup stays closed until
   *  the query changes. */
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null)

  const query = parseSlashQuery(text, caret)
  const items = useMemo(() => matchSlashCommands(query ?? "", t), [query])
  const open = query !== null && items.length > 0 && dismissedQuery !== query
  const safeHighlighted = open ? Math.min(highlighted, items.length - 1) : 0

  return {
    open,
    query,
    items,
    highlighted: safeHighlighted,
    dismissed: query !== null && dismissedQuery === query,
    onKeyDown: (e) => {
      if (!open) return false
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlighted((h) => (h + 1) % items.length)
        return true
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlighted((h) => (h - 1 + items.length) % items.length)
        return true
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        const picked = items[Math.min(highlighted, items.length - 1)]
        if (picked) {
          onSelect(picked.command)
          setDismissedQuery(query)
        }
        return true
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setDismissedQuery(query)
        return true
      }
      return false
    },
    select: (command) => {
      const picked = command ?? items[Math.min(highlighted, items.length - 1)]?.command
      if (!picked) return
      onSelect(picked)
      setDismissedQuery(query)
    },
  }
}

/** i18n badge label for a slash command's kind. */
export function slashKindLabel(kind: SlashCommandView["kind"]): string {
  return kind === "navigate"
    ? t("promptEditor.slash.badge.navigate")
    : t("promptEditor.slash.badge.action")
}
