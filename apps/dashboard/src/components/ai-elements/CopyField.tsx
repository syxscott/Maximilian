// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * CopyField — copyable value chip (ZCode copy borrowing): monospace
 * value, copy button with "copied" confirmation; the button degrades to
 * hidden when the clipboard API is unavailable or refuses.
 */
import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { canUseClipboard, copyFieldModel, copyText } from "./model"

export interface CopyFieldProps {
  /** Raw value string, or passthrough { value, label }. */
  field: unknown
  className?: string
}

type CopyState = "idle" | "copied" | "hidden"

export function CopyField({ field, className }: CopyFieldProps) {
  useLocale()
  const { value, label } = copyFieldModel(field)
  const [state, setState] = useState<CopyState>("idle")

  if (!canUseClipboard() || state === "hidden" || value === "") return null

  const onCopy = () => {
    copyText(value).then(
      () => setState("copied"),
      () => setState("hidden"),
    )
  }

  return (
    <span
      aria-label={t("aiElements.copyField.aria")}
      className={cn(
        "inline-flex max-w-xs items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs",
        className,
      )}
    >
      {label !== undefined && (
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      )}
      <code className="min-w-0 flex-1 truncate font-mono" title={value}>
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={t("aiElements.copyField.copy")}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        {state === "copied" ? (
          <Check
            className="h-3 w-3 text-emerald-500"
            aria-label={t("aiElements.copyField.copied")}
          />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
    </span>
  )
}
