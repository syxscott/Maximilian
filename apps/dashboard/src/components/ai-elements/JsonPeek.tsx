// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * JsonPeek — bounded JSON preview (ZCode json borrowing): pretty-printed
 * head of the document with an expander into the full <pre> payload;
 * strings that do not parse as JSON render raw with an "invalid" tag.
 */
import { useState } from "react"
import { Braces } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { jsonPeekModel } from "./model"

export interface JsonPeekProps {
  /** JSON object/array, or a JSON-encoded string. */
  json: unknown
  /** Preview bound in characters. */
  maxChars?: number
  defaultOpen?: boolean
  className?: string
}

export function JsonPeek({ json, maxChars = 400, defaultOpen = false, className }: JsonPeekProps) {
  useLocale()
  const { preview, full, truncated, isJson } = jsonPeekModel(json, maxChars)
  const [open, setOpen] = useState(defaultOpen)

  if (full === "") return null

  return (
    <div
      aria-label={t("aiElements.jsonPeek.aria")}
      className={cn(
        "rounded-md border border-border bg-muted/20 text-xs overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border/60 bg-muted/40 text-muted-foreground">
        <Braces className="h-3 w-3" aria-hidden="true" />
        <span className="text-[10px] uppercase tracking-wider">
          {isJson ? "JSON" : t("aiElements.jsonPeek.invalid")}
        </span>
      </div>
      <pre className="overflow-x-auto p-3 font-mono leading-5 whitespace-pre-wrap break-all m-0">
        {open ? full : preview}
        {truncated && !open && (
          <span className="text-muted-foreground">{t("aiElements.jsonPeek.cut")}</span>
        )}
      </pre>
      {truncated && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full border-t border-border/60 px-3 py-1 text-left text-muted-foreground hover:text-foreground hover:bg-muted/40"
        >
          {open
            ? t("aiElements.jsonPeek.collapse")
            : t("aiElements.jsonPeek.expand", { count: full.length - preview.length })}
        </button>
      )}
    </div>
  )
}
