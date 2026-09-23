// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * CodeBlock — fenced code display for assistant message parts (ZCode
 * ai-elements CodeTool borrowing): language label, optional line numbers,
 * copy button (hidden when the clipboard API is unavailable or refuses)
 * and auto-collapse past `CODE_COLLAPSE_LINES` lines.
 */
import { useState } from "react"
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import {
  CODE_COLLAPSE_LINES,
  canUseClipboard,
  codeBlockModel,
  codeShouldCollapse,
  copyText,
  visibleCodeLines,
} from "./model"

export interface CodeBlockProps {
  /** Raw code string, or a passthrough { code, language } part. */
  code: unknown
  /** Overrides the language extracted from `code`. */
  language?: string
  showLineNumbers?: boolean
  /** Collapse threshold override; passes Infinity to disable collapsing. */
  collapseAfter?: number
  className?: string
}

type CopyState = "idle" | "copied" | "hidden"

export function CodeBlock({
  code: rawCode,
  language: rawLanguage,
  showLineNumbers = false,
  collapseAfter = CODE_COLLAPSE_LINES,
  className,
}: CodeBlockProps) {
  useLocale()
  const { code, language } = codeBlockModel(rawCode)
  const lang = rawLanguage ?? language
  const collapsible = collapseAfter !== Infinity && codeShouldCollapse(code, collapseAfter)
  const [open, setOpen] = useState(false)
  const [copyState, setCopyState] = useState<CopyState>("idle")

  const shown =
    collapsible && !open ? visibleCodeLines(code, collapseAfter) : { text: code, hiddenCount: 0 }
  const lines = shown.text.split("\n")

  const onCopy = () => {
    copyText(code).then(
      () => setCopyState("copied"),
      () => setCopyState("hidden"),
    )
  }

  return (
    <figure
      className={cn(
        "rounded-md border border-border bg-muted/30 overflow-hidden text-xs",
        className,
      )}
    >
      <figcaption className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/40">
        <span className="font-mono uppercase tracking-wider text-muted-foreground">
          {lang ?? t("aiElements.code.noLanguage")}
        </span>
        <span className="flex items-center gap-1">
          {collapsible && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-expanded={open}
            >
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {open ? t("aiElements.code.collapse") : t("aiElements.code.expand")}
            </button>
          )}
          {canUseClipboard() && copyState !== "hidden" && (
            <button
              type="button"
              onClick={onCopy}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label={t("aiElements.code.copy")}
            >
              {copyState === "copied" ? (
                <>
                  <Check className="h-3 w-3 text-emerald-500" />
                  <span className="text-emerald-600">{t("aiElements.code.copied")}</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>{t("aiElements.code.copy")}</span>
                </>
              )}
            </button>
          )}
        </span>
      </figcaption>
      <div className="overflow-x-auto">
        <pre className="p-3 font-mono leading-5 min-w-0">
          {code === "" ? (
            <span className="text-muted-foreground italic">{t("aiElements.code.empty")}</span>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="flex">
                {showLineNumbers && (
                  <span className="select-none pr-3 text-right text-muted-foreground/60 w-10 shrink-0 tabular-nums">
                    {i + 1}
                  </span>
                )}
                <code className="whitespace-pre">{line || " "}</code>
              </div>
            ))
          )}
        </pre>
      </div>
      {shown.hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full px-3 py-1.5 text-left text-muted-foreground hover:text-foreground hover:bg-muted/40 border-t border-border"
        >
          {t("aiElements.code.hiddenLines", { count: shown.hiddenCount })}
        </button>
      )}
    </figure>
  )
}
