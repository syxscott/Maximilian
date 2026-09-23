// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * AttachmentCard — file attachment chip for message parts (ZCode
 * attachment borrowing): name, human size, mime-derived type icon and an
 * optional remove action (only rendered when the caller passes onRemove).
 */
import {
  Archive,
  Braces,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  Film,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useLocale, t, formatBytes } from "@max/i18n"
import { cn } from "@/lib/utils"
import { attachmentModel } from "./model"
import type { AttachmentVariant } from "./model"

export interface AttachmentCardProps {
  /** Passthrough attachment payload ({ name, size, mime, … }). */
  attachment: unknown
  /** When provided, renders a remove button wired to this callback. */
  onRemove?: () => void
  className?: string
}

const VARIANT_ICONS: Record<AttachmentVariant, LucideIcon> = {
  image: FileImage,
  audio: FileMusic,
  video: Film,
  pdf: FileText,
  code: FileCode,
  archive: FileArchive,
  spreadsheet: FileSpreadsheet,
  json: Braces,
  text: FileText,
  file: File,
}

export function AttachmentCard({ attachment, onRemove, className }: AttachmentCardProps) {
  useLocale()
  const { name, sizeBytes, variant } = attachmentModel(attachment)
  const Icon = VARIANT_ICONS[variant]

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs max-w-xs",
        className,
      )}
    >
      <Icon
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-label={t("aiElements.attachment.type", {
          type: t(`aiElements.attachment.variant.${variant}`),
        })}
      />
      <span className="min-w-0 flex flex-col leading-tight">
        <span className="truncate font-medium" title={name}>
          {name}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {sizeBytes !== undefined
            ? formatBytes(sizeBytes)
            : t("aiElements.attachment.sizeUnknown")}
        </span>
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          aria-label={t("aiElements.attachment.remove")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
