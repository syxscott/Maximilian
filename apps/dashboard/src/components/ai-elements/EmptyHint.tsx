// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * EmptyHint — empty-state placeholder (ZCode empty borrowing): icon,
 * title, optional hint line and an optional action button.
 */
import { Inbox } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { emptyHintModel } from "./model"

export interface EmptyHintProps {
  /** Passthrough { title, hint, action } or a bare title string. */
  hint: unknown
  onAction?: () => void
  className?: string
}

export function EmptyHint({ hint, onAction, className }: EmptyHintProps) {
  useLocale()
  const { title, hint: detail, actionLabel } = emptyHintModel(hint)
  const finalTitle = title !== "" ? title : t("aiElements.emptyHint.defaultTitle")

  return (
    <div
      role="status"
      className={cn("flex flex-col items-center gap-1 px-4 py-6 text-center text-xs", className)}
    >
      <Inbox aria-hidden="true" className="mb-1 h-6 w-6 text-muted-foreground/50" />
      <div className="font-medium text-foreground">{finalTitle}</div>
      {detail !== undefined && <div className="text-muted-foreground">{detail}</div>}
      {onAction && actionLabel !== undefined && (
        <button
          type="button"
          onClick={onAction}
          className="mt-2 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-foreground hover:bg-muted"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
