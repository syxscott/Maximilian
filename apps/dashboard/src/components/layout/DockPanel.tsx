// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DockPanel — the single-panel shell: header (translated title, active
 * highlight, maximize toggle, close) over a plain children slot. Purely
 * presentational — the dock layout store decides what stays open; the
 * consumer supplies content through DockContainer's renderPanel.
 */
import type { ReactNode } from "react"
import { Maximize2, Minimize2, X } from "lucide-react"
import { t, useLocale } from "@max/i18n"
import { cn } from "@/lib/utils"

export interface DockPanelProps {
  /** Panel id — also the testid anchor (dock-panel-<id>). */
  id: string
  /** i18n key for the header title; falls back to the raw id. */
  titleKey: string
  /** Focused panel gets the highlighted header. */
  active?: boolean
  /** Maximized panels show the restore affordance. */
  maximized?: boolean
  onClose?: (id: string) => void
  onToggleMaximize?: (id: string) => void
  onFocus?: (id: string) => void
  children?: ReactNode
}

export function DockPanel({
  id,
  titleKey,
  active = false,
  maximized = false,
  onClose,
  onToggleMaximize,
  onFocus,
  children,
}: DockPanelProps) {
  useLocale() // re-render on locale switches
  const title = t(titleKey, id)
  return (
    <section
      data-testid={`dock-panel-${id}`}
      aria-label={title}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-card",
        active ? "border-primary/60" : "border-border",
      )}
      onPointerDown={() => onFocus?.(id)}
    >
      <header
        data-testid={`dock-header-${id}`}
        className={cn(
          "flex shrink-0 items-center gap-1 border-b px-2 py-1 text-xs font-medium select-none",
          active ? "bg-accent text-accent-foreground" : "bg-muted/50 text-muted-foreground",
        )}
      >
        <span className="truncate" aria-current={active ? "true" : undefined}>
          {title}
        </span>
        <span className="flex-1" />
        {onToggleMaximize && (
          <button
            type="button"
            data-testid={`dock-maximize-${id}`}
            aria-label={t(maximized ? "layout.panel.restore" : "layout.panel.maximize")}
            className="rounded p-0.5 hover:bg-accent hover:text-accent-foreground"
            onClick={() => onToggleMaximize(id)}
          >
            {maximized ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        {onClose && (
          <button
            type="button"
            data-testid={`dock-close-${id}`}
            aria-label={t("layout.panel.close")}
            className="rounded p-0.5 hover:bg-accent hover:text-accent-foreground"
            onClick={() => onClose(id)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  )
}
