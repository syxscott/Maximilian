// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * MentionTextarea — controlled textarea with prefix-routed mention
 * completion. Composes the existing useMention hook: the active trigger
 * ("@" → roles/skills provider, "#" → workspaces provider) selects the
 * suggestion pool fed into the hook, which owns filtering, keyboard
 * highlighting and Escape dismissal; insertion goes through the
 * multi-trigger insertTriggerToken.
 */

import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react"
import { useLocale, t } from "@max/i18n"
import { useMention } from "@/hooks/useMention"
import { cn } from "@/lib/utils"
import {
  activeTrigger,
  insertTriggerToken,
  poolForTrigger,
  providersForTrigger,
  type MentionProvider,
} from "./model"

export interface MentionTextareaProps {
  value: string
  onChange: (value: string) => void
  providers: MentionProvider[]
  placeholder?: string
  rows?: number
  disabled?: boolean
  ariaLabel?: string
  className?: string
  /** Exposed so toolbars can focus/insert from outside. */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  /** Enter (popup closed, no Shift) — e.g. sending the message. */
  onSubmit?: () => void
}

/** rAF when available, else immediate (non-visual test environments). */
function scheduleCaret(fn: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn)
  else fn()
}

export function MentionTextarea({
  value,
  onChange,
  providers,
  placeholder,
  rows = 3,
  disabled,
  ariaLabel,
  className,
  textareaRef,
  onSubmit,
}: MentionTextareaProps) {
  useLocale()
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const ref = textareaRef ?? internalRef
  const [caret, setCaret] = useState(0)

  const triggers = useMemo(() => providers.flatMap((p) => p.triggers), [providers])

  // Prefix routing is derived from the authoritative value + caret.
  const match = activeTrigger(value, caret, triggers)
  const routed = match !== null ? providersForTrigger(providers, match.trigger) : []
  const provider = routed[0] ?? null
  const pool = useMemo(
    () => (match !== null ? poolForTrigger(providers, match.trigger, match.token) : []),
    [providers, match?.trigger, match?.token],
  )
  const mention = useMention(pool)

  /**
   * Feed the hook an @-normalized token ("#max" → "@max"): the hook's
   * completion machinery (startsWith filter, highlight cycling, Escape
   * dismissal) is trigger-agnostic in behavior but its token DETECTOR is
   * "@"-only, so the router hands it a shape it understands.
   */
  const feedHook = (text: string, caretPos: number) => {
    const m = activeTrigger(text, caretPos, triggers)
    if (m !== null) {
      const normalized = `@${m.token}`
      mention.onChange(normalized, normalized.length)
    } else {
      mention.onChange(text, caretPos)
    }
  }

  const trackCaret = (el: HTMLTextAreaElement) => {
    const next = el.selectionStart ?? el.value.length
    setCaret(next)
    feedHook(el.value, next)
  }

  const applyToken = (token?: string) => {
    const el = ref.current
    if (!el || !provider || mention.activeToken === null) return
    const chosen = token ?? mention.suggestions[mention.highlighted]?.token
    if (!chosen) return
    const result = insertTriggerToken(
      el.value,
      el.selectionStart ?? el.value.length,
      match?.trigger ?? "@",
      chosen,
    )
    // State updates land synchronously; only the DOM selection restore
    // waits for a frame.
    onChange(result.text)
    setCaret(result.caret)
    feedHook(result.text, result.caret)
    scheduleCaret(() => {
      el.selectionStart = el.selectionEnd = result.caret
    })
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.onKeyDown(e)) return
    if (
      (e.key === "Enter" || e.key === "Tab") &&
      match !== null &&
      mention.suggestions.length > 0
    ) {
      e.preventDefault()
      applyToken()
      return
    }
    if (e.key === "Enter" && !e.shiftKey && match === null) {
      onSubmit?.()
    }
  }

  const open = match !== null && mention.suggestions.length > 0
  const emptyButOpen = match !== null && !open && provider !== null
  // The "@" family pools roles + skills; prefer the skills explanation
  // when a skills provider is wired, else the first provider's key.
  const emptyKey =
    routed.some((p) => p.id === "skills") || provider === null
      ? "mentions.skills.empty"
      : `mentions.${provider.id}.empty`

  return (
    <div className={cn("relative", className)} data-testid="mention-textarea">
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={placeholder}
        data-testid="mention-input"
        className={cn(
          "border-input w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm",
          "placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        onChange={(e) => {
          onChange(e.target.value)
          trackCaret(e.target)
        }}
        onKeyUp={(e) => trackCaret(e.currentTarget)}
        onClick={(e) => trackCaret(e.currentTarget)}
        onKeyDown={handleKeyDown}
      />
      {open && provider && (
        <ul
          role="listbox"
          aria-label={t(`mentions.${provider.id}.title`)}
          className="bg-popover text-popover-foreground absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border shadow-md"
          data-testid="mention-popup"
        >
          {mention.suggestions.map((s, i) => (
            <li key={s.token}>
              <button
                type="button"
                role="option"
                aria-selected={i === mention.highlighted}
                data-testid="mention-option"
                onMouseDown={(e) => {
                  // Prevent the textarea blur from closing the popup
                  // before the selection lands.
                  e.preventDefault()
                  applyToken(s.token)
                }}
                className={cn(
                  "flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm",
                  i === mention.highlighted ? "bg-accent text-accent-foreground" : "",
                )}
              >
                <span className="font-medium">
                  {match?.trigger ?? "@"}
                  {s.token}
                </span>
                {s.description && (
                  <span className="text-muted-foreground truncate text-xs">{s.description}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {emptyButOpen && provider && (
        <p
          role="status"
          className="text-muted-foreground absolute z-50 mt-1 w-full rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
          data-testid="mention-empty"
        >
          {t(emptyKey)}
        </p>
      )}
    </div>
  )
}
