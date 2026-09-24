// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TerminalOutputBlock — ANSI-aware terminal output (ZCode shell borrowing):
 * monospace body, escape sequences stripped, lines tone-classified by the
 * model (green success / red error / amber warn) and row-capped.
 */
import { Terminal } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { terminalLinesModel } from "./model"
import type { TerminalTone } from "./model"

export interface TerminalOutputBlockProps {
  /** Raw output text, or a passthrough { output } part. */
  output: unknown
  className?: string
}

const TONE_CLASSES: Record<TerminalTone, string> = {
  plain: "text-foreground/80",
  success: "text-emerald-600",
  error: "text-red-600",
  warn: "text-amber-600",
}

export function TerminalOutputBlock({ output, className }: TerminalOutputBlockProps) {
  useLocale()
  const lines = terminalLinesModel(output)

  return (
    <figure
      aria-label={t("aiElements.terminal.aria")}
      className={cn(
        "rounded-md border border-border bg-[color:var(--mx-alpha-dark-2,#0d1117)] text-xs overflow-hidden",
        className,
      )}
    >
      <figcaption className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/40 text-muted-foreground">
        <Terminal className="h-3 w-3" aria-hidden="true" />
        <span className="font-mono uppercase tracking-wider text-[10px]">
          {t("aiElements.terminal.title")}
        </span>
      </figcaption>
      <div className="overflow-x-auto p-3">
        <pre className="font-mono leading-5 m-0 min-w-0">
          {lines.every((l) => l.text === "") ? (
            <span className="text-muted-foreground italic">{t("aiElements.terminal.empty")}</span>
          ) : (
            lines.map((line, i) => (
              <div key={i} className={TONE_CLASSES[line.tone]}>
                <code className="whitespace-pre">{line.text || " "}</code>
              </div>
            ))
          )}
        </pre>
      </div>
    </figure>
  )
}
