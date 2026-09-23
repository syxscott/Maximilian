// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * QuickPick — generic fast-selection dialog (ZCode quickpick borrowing):
 * a query box with fuzzy filtering, sectioned results, full keyboard
 * control (↑/↓ to move, Enter to select, Esc to close) and explicit
 * empty/loading-free semantics — items arrive as props, so the only
 * states are results and the empty state.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { flattenSections, groupBySection, rankQuickPick, type QuickPickItem } from "./model"

export interface QuickPickProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: QuickPickItem[]
  /** Fires on Enter or click; disabled items never fire it. */
  onSelect?: (item: QuickPickItem) => void
  /** Overrides the i18n default placeholder. */
  placeholder?: string
  /** Overrides the i18n default empty message. */
  emptyMessage?: string
  className?: string
}

export function QuickPick({
  open,
  onOpenChange,
  items,
  onSelect,
  placeholder,
  emptyMessage,
  className,
}: QuickPickProps) {
  useLocale()
  const [query, setQuery] = useState("")
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const ranked = useMemo(() => rankQuickPick(items, query), [items, query])
  const sections = useMemo(() => groupBySection(ranked), [ranked])
  const flat = useMemo(() => flattenSections(sections), [sections])

  // Fresh open: clear the query, put the cursor in the box.
  useEffect(() => {
    if (open) {
      setQuery("")
      setHighlighted(0)
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [open])

  // Clamp the highlight when the filtered list shrinks.
  useEffect(() => {
    setHighlighted((h) => Math.min(h, Math.max(flat.length - 1, 0)))
  }, [flat.length])

  // Keep the highlighted row visible.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-quickpick-index="${highlighted}"]`,
    )
    if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" })
  }, [highlighted])

  if (!open) return null

  const selectHighlighted = () => {
    const entry = flat[highlighted]
    if (!entry || entry.item.disabled) return
    onSelect?.(entry.item)
    onOpenChange(false)
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (flat.length > 0) setHighlighted((h) => (h + 1) % flat.length)
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      if (flat.length > 0) setHighlighted((h) => (h - 1 + flat.length) % flat.length)
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      selectHighlighted()
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      onOpenChange(false)
    }
  }

  let flatIndex = -1

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={placeholder ?? t("quickpick.placeholder")}
      className={cn(
        "bg-popover text-popover-foreground rounded-md border shadow-md",
        "w-[420px] max-w-full p-2",
        className,
      )}
      data-testid="quickpick"
    >
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={flat.length > 0}
        aria-controls="quickpick-listbox"
        aria-activedescendant={flat[highlighted] ? `quickpick-item-${highlighted}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setHighlighted(0)
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? t("quickpick.placeholder")}
        className="border-input placeholder:text-muted-foreground mb-2 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        data-testid="quickpick-input"
      />
      {flat.length === 0 ? (
        <p className="text-muted-foreground px-3 py-6 text-center text-sm" role="status">
          {emptyMessage ?? t("quickpick.empty")}
        </p>
      ) : (
        <div
          ref={listRef}
          id="quickpick-listbox"
          role="listbox"
          className="max-h-72 overflow-y-auto"
        >
          {sections.map((group) => (
            <div
              key={group.section ?? "__ungrouped"}
              role="group"
              aria-label={group.section ?? undefined}
            >
              {group.section !== null && (
                <div className="text-muted-foreground bg-muted/50 rounded px-2 py-1 text-[11px] font-medium uppercase tracking-wide">
                  {group.section}
                </div>
              )}
              {group.items.map((entry) => {
                flatIndex += 1
                const idx = flatIndex
                const active = idx === highlighted
                return (
                  <button
                    key={entry.item.id}
                    type="button"
                    role="option"
                    id={`quickpick-item-${idx}`}
                    aria-selected={active}
                    aria-disabled={entry.item.disabled || undefined}
                    data-quickpick-index={idx}
                    data-testid="quickpick-item"
                    onClick={() => {
                      setHighlighted(idx)
                      if (!entry.item.disabled) {
                        onSelect?.(entry.item)
                        onOpenChange(false)
                      }
                    }}
                    onMouseEnter={() => setHighlighted(idx)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm",
                      active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                      entry.item.disabled && "text-muted-foreground opacity-50",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{entry.item.label}</span>
                      {entry.item.description && (
                        <span className="text-muted-foreground block truncate text-xs">
                          {entry.item.description}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
      <p className="text-muted-foreground mt-2 border-t pt-1.5 text-center text-[10px]">
        {t("quickpick.hint")}
      </p>
    </div>
  )
}
