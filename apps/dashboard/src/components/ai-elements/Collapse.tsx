// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Collapse — generic disclosure container (ZCode collapsible borrowing):
 * works controlled (`open` + `onOpenChange`) or uncontrolled
 * (`defaultOpen`), with an accessible summary row toggle.
 */
import { useState } from "react"
import { ChevronDown } from "lucide-react"
import type { ReactNode } from "react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { collapseModel } from "./model"

export interface CollapseProps {
  /** Row content (title area) — always visible, click toggles. */
  summary: ReactNode
  /** Hidden body shown while open. */
  children: ReactNode
  /** Controlled open state. */
  open?: boolean
  /** Initial state for the uncontrolled variant. */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

export function Collapse({
  summary,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
}: CollapseProps) {
  useLocale()
  const { isControlled, initialOpen } = collapseModel(open, defaultOpen)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(initialOpen)
  const isOpen = isControlled && open !== undefined ? open : uncontrolledOpen

  const toggle = () => {
    const next = !isOpen
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div className={cn("rounded-md border border-border bg-muted/20 text-xs", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted-foreground hover:text-foreground"
      >
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-180")}
        />
      </button>
      {isOpen && <div className="border-t border-border/60 px-3 py-2">{children}</div>}
      {!isOpen && <span className="sr-only">{t("aiElements.collapse.collapsed")}</span>}
    </div>
  )
}
