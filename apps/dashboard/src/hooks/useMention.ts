// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * useMention — "@mention" completion for the chat prompt (ZCode GUI
 * borrowing: the prompt-editor mention providers). Detects an open
 * `@token` at the caret, filters the suggestion list, and returns the
 * state + keyboard handlers + insertion callback. Client-side affordance
 * only: the inserted `@role` token travels in the message text, exactly
 * like the TUI's autocomplete.
 */

import { useMemo, useState } from "react"

export interface MentionSuggestion {
  /** Inserted token after `@`, e.g. "backend". */
  token: string
  /** One-line description shown in the popup. */
  description?: string
}

export interface MentionState {
  /** The active `@token` being completed (without the @), or null. */
  activeToken: string | null
  suggestions: MentionSuggestion[]
  /** Index of the highlighted suggestion. */
  highlighted: number
}

const MENTION_RE = /@([a-zA-Z0-9_-]*)$/

/** Find the @token ending exactly at `caret` (or null). */
export function activeMentionToken(text: string, caret: number): string | null {
  const before = text.slice(0, caret)
  const match = MENTION_RE.exec(before)
  return match ? (match[1] ?? null) : null
}

/** Insert (or replace) the completed mention at the token's start. */
export function insertMention(
  text: string,
  caret: number,
  token: string,
): { text: string; caret: number } {
  const before = text.slice(0, caret)
  const match = MENTION_RE.exec(before)
  if (!match) return { text, caret }
  const start = caret - match[0].length
  const inserted = `@${token} `
  return {
    text: `${text.slice(0, start)}${inserted}${text.slice(caret)}`,
    caret: start + inserted.length,
  }
}

export function useMention(suggestions: MentionSuggestion[]): MentionState & {
  /** Track caret/text changes from the textarea. */
  onChange: (text: string, caret: number) => void
  /** Returns true when the key was consumed (popup navigation). */
  onKeyDown: (e: { key: string; preventDefault: () => void }) => boolean
  /** Apply the highlighted (or given) suggestion — the textarea owns its state. */
  apply: (
    textarea: { value: string; selectionStart: number },
    token?: string,
  ) => { text: string; caret: number } | null
  reset: () => void
} {
  const [state, setState] = useState<{ text: string; caret: number }>({ text: "", caret: 0 })
  const [highlighted, setHighlighted] = useState(0)
  /** The token the user dismissed with Escape — popup stays closed until a
   *  DIFFERENT token is typed. */
  const [dismissed, setDismissed] = useState<string | null>(null)

  const activeToken = activeMentionToken(state.text, state.caret)
  const filtered = useMemo(() => {
    if (activeToken === null) return []
    const q = activeToken.toLowerCase()
    return suggestions.filter((s) => s.token.toLowerCase().startsWith(q)).slice(0, 8)
  }, [activeToken, suggestions])

  // Dismissal covers the WHOLE token family: Escape on "@rev" keeps the
  // popup closed while the user extends to "@review", and a genuinely new
  // token (no longer extending the dismissed one) reopens it.
  const dismissedFamily =
    dismissed !== null && activeToken !== null && activeToken.startsWith(dismissed)
  const open = activeToken !== null && filtered.length > 0 && !dismissedFamily

  return {
    activeToken: open ? activeToken : null,
    suggestions: open ? filtered : [],
    highlighted: open ? Math.min(highlighted, filtered.length - 1) : 0,
    onChange: (text, caret) => {
      setState({ text, caret })
      setHighlighted(0)
    },
    onKeyDown: (e) => {
      if (!open) return false
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlighted((h) => (h + 1) % filtered.length)
        return true
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlighted((h) => (h - 1 + filtered.length) % filtered.length)
        return true
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setDismissed(activeToken)
        return true
      }
      return false
    },
    apply: (textarea, token) => {
      if (!open && !token) return null
      const chosen = token ?? filtered[highlighted]?.token
      if (!chosen) return null
      return insertMention(textarea.value, textarea.selectionStart ?? textarea.value.length, chosen)
    },
    reset: () => {
      setState({ text: "", caret: 0 })
      setHighlighted(0)
      setDismissed(null)
    },
  }
}
