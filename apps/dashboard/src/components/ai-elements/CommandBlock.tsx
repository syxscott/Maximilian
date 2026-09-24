// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * CommandBlock — shell command card (ZCode bash borrowing): `$` prompt,
 * monospace command and an exit-code badge (green 0 / red non-zero /
 * hidden while unknown).
 */
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { commandBlockModel } from "./model"

export interface CommandBlockProps {
  /** Raw command string, or a passthrough { command, exitCode } part. */
  command: unknown
  className?: string
}

export function CommandBlock({ command, className }: CommandBlockProps) {
  useLocale()
  const { command: line, exitCode, ok } = commandBlockModel(command)

  return (
    <div
      aria-label={t("aiElements.command.aria")}
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-1.5 text-xs font-mono overflow-hidden",
        className,
      )}
    >
      <span aria-hidden="true" className="shrink-0 text-emerald-600 select-none">
        $
      </span>
      <code className="min-w-0 flex-1 truncate whitespace-pre" title={line}>
        {line !== "" ? line : t("aiElements.command.empty")}
      </code>
      {ok !== undefined && (
        <span
          aria-label={t("aiElements.command.exit", { code: exitCode ?? 0 })}
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums",
            ok ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700",
          )}
        >
          {t("aiElements.command.exit", { code: exitCode ?? 0 })}
        </span>
      )}
    </div>
  )
}
