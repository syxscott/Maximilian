// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ErrorBlock — failed-step display for assistant message parts: error
 * name + message, with the stack trace (when present) tucked into a
 * collapsed <details> so failures stay scannable.
 */
import { CircleAlert } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { errorModel } from "./model"

export interface ErrorBlockProps {
  /** Error instance, error-shaped object, or message string. */
  error: unknown
  className?: string
}

export function ErrorBlock({ error, className }: ErrorBlockProps) {
  useLocale()
  const { name, message, stack } = errorModel(error)

  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <span className="font-medium">{name ? `${name}: ` : ""}</span>
          <span className="break-words">{message || t("aiElements.error.unknown")}</span>
        </div>
      </div>
      {stack && (
        <details className="mt-1.5">
          <summary className="cursor-pointer select-none text-destructive/80 hover:text-destructive">
            {t("aiElements.error.showStack")}
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-destructive/80">
            {stack}
          </pre>
        </details>
      )}
    </div>
  )
}
