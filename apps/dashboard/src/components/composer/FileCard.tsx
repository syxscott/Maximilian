// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * FileCard — one staged attachment card (chat-demo files/FileCard.tsx
 * borrowing): icon or image thumbnail, file name, "variant · size" caption
 * and a remove button. Staging is local-only, so there is no upload state
 * here — the card either exists or is removed. Image thumbnails are drag
 * sources: they carry the in-app token (COMPOSER_DRAG_TOKEN) plus the
 * retained File in the intake registry, so a re-drag can only land back on
 * a composer card (misroute-proof), never trigger the fullscreen overlay.
 */
import { FileWarning, X } from "lucide-react"
import { useLocale, t, formatBytes } from "@max/i18n"
import { cn } from "@/lib/utils"
import {
  COMPOSER_DRAG_TOKEN,
  beginAppFileDrag,
  endAppFileDrag,
  type StagedAttachment,
} from "./attachments"

export function FileCard({
  attachment,
  onRemove,
  className,
}: {
  attachment: StagedAttachment
  onRemove: (id: string) => void
  className?: string
}) {
  useLocale()
  const caption = [attachment.variant, formatBytes(attachment.sizeBytes)]
    .filter((part) => part !== "" && part !== "—")
    .join(" · ")
  return (
    <div
      className={cn(
        "flex max-w-[220px] items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5",
        className,
      )}
      data-testid="attachment-card"
      data-attachment-id={attachment.id}
      title={attachment.name}
    >
      {attachment.previewUrl ? (
        <img
          src={attachment.previewUrl}
          alt={attachment.name}
          className="h-9 w-9 shrink-0 rounded-sm border border-border object-cover"
          draggable
          onDragStart={(e) => {
            // In-app re-drag of a staged preview: token payload + retained
            // File in the module registry — never the bytes themselves.
            e.dataTransfer.setData(COMPOSER_DRAG_TOKEN, attachment.id)
            beginAppFileDrag(attachment.file, attachment.id)
          }}
          onDragEnd={() => endAppFileDrag(attachment.id)}
        />
      ) : (
        <FileWarning className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <div className="truncate text-xs font-medium">{attachment.name}</div>
        <div className="text-[10px] text-muted-foreground">{caption}</div>
      </div>
      <button
        type="button"
        className="ml-auto flex shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={t("composer.attach.remove")}
        title={t("composer.attach.remove")}
        data-testid="attachment-remove"
        onClick={() => onRemove(attachment.id)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
