// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * FileChangeCard — file change summary (ZCode diffstat borrowing): path,
 * +/- line badges computed from the (old, new) pair, expandable into the
 * shared DiffPreview line-colored diff. Binary changes skip the preview.
 */
import { useState } from "react"
import { ChevronDown, ChevronUp, FileCode } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { DiffPreview } from "@/components/_helpers/DiffPreview"
import { fileChangeModel } from "./model"

export interface FileChangeCardProps {
  /** Passthrough { path, oldString, newString } / write payload. */
  change: unknown
  defaultOpen?: boolean
  className?: string
}

export function FileChangeCard({ change, defaultOpen = false, className }: FileChangeCardProps) {
  useLocale()
  const m = fileChangeModel(change)
  const [open, setOpen] = useState(defaultOpen)
  const expandable = !m.binary && (m.oldText !== "" || m.newText !== "")

  return (
    <div
      aria-label={t("aiElements.fileChange.aria")}
      className={cn(
        "rounded-md border border-border bg-muted/20 text-xs overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-mono truncate" title={m.path}>
          {m.path !== "" ? m.path : t("aiElements.fileChange.noPath")}
        </span>
        <span className="ml-auto flex items-center gap-2 shrink-0">
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700 tabular-nums">
            +{m.added}
          </span>
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] text-red-700 tabular-nums">
            -{m.removed}
          </span>
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t(`aiElements.fileChange.kind.${m.kind}`)}
          </span>
          {expandable && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={
                open ? t("aiElements.fileChange.collapse") : t("aiElements.fileChange.expand")
              }
              className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              {open ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </span>
      </div>
      {expandable && open && (
        <div className="px-3 pb-2">
          <DiffPreview
            tool={m.kind}
            input={{ oldString: m.oldText, newString: m.newText }}
            maxLines={16}
          />
        </div>
      )}
      {m.binary && (
        <div className="px-3 pb-2 text-muted-foreground italic">
          {t("aiElements.fileChange.binary")}
        </div>
      )}
    </div>
  )
}
