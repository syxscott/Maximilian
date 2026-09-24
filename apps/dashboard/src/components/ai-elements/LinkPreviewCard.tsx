// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * LinkPreviewCard — rich link preview (ZCode link borrowing): favicon
 * placeholder (domain letter), title, description and bare URL. Only
 * http(s) targets become anchors; junk renders as an inert card.
 */
import { Globe } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import { linkPreviewModel } from "./model"

export interface LinkPreviewCardProps {
  /** Passthrough { url, title, description } or a bare URL string. */
  link: unknown
  className?: string
}

export function LinkPreviewCard({ link, className }: LinkPreviewCardProps) {
  useLocale()
  const { url, title, description, domain } = linkPreviewModel(link)

  const body = (
    <>
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        {domain !== "" ? (
          <span className="font-mono text-xs uppercase">{domain.slice(0, 1)}</span>
        ) : (
          <Globe className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0 flex flex-col gap-0.5">
        <span className="truncate font-medium" title={title}>
          {title !== "" ? title : (url ?? t("aiElements.link.untitled"))}
        </span>
        {description !== undefined && (
          <span className="text-muted-foreground line-clamp-2">{description}</span>
        )}
        <span className="truncate font-mono text-[10px] text-muted-foreground/70">
          {url ?? domain}
        </span>
      </span>
    </>
  )

  return url !== undefined ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("aiElements.link.aria")}
      className={cn(
        "flex items-start gap-2.5 rounded-md border border-border bg-muted/20 p-2.5 text-xs hover:bg-muted/40 transition-colors",
        className,
      )}
    >
      {body}
    </a>
  ) : (
    <div
      aria-label={t("aiElements.link.aria")}
      className={cn(
        "flex items-start gap-2.5 rounded-md border border-border bg-muted/20 p-2.5 text-xs opacity-80",
        className,
      )}
    >
      {body}
    </div>
  )
}
