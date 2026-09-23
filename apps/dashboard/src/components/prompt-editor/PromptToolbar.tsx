// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * PromptToolbar — the strip above the prompt input (ZCode
 * chat-input-toolbar borrowing): attachments (local-only staging with an
 * honest "upload API not wired" hint), the slash-command launcher and the
 * @mention launcher. Pure presentation + a hidden file input; all state
 * changes flow up through callbacks.
 */

import { useRef } from "react"
import { useLocale, t } from "@max/i18n"
import { AtSign, Paperclip, Slash, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatBytes, MAX_ATTACHMENTS, type Attachment } from "./model"

export interface PromptToolbarProps {
  attachments: Attachment[]
  /** Raw FileList/array from the hidden input — normalized upstream. */
  onAttachFiles: (files: unknown) => void
  onRemoveAttachment: (id: string) => void
  /** Slash launcher — the host opens the command quickpick. */
  onOpenSlash: () => void
  /** Mention launcher — the host focuses the textarea and inserts "@". */
  onInsertMention: () => void
  /** Count of files dropped by the last attach (over the cap) — renders
   *  the honest limit notice while > 0. */
  rejectedCount?: number
  disabled?: boolean
  className?: string
}

export function PromptToolbar({
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  onOpenSlash,
  onInsertMention,
  rejectedCount = 0,
  disabled,
  className,
}: PromptToolbarProps) {
  useLocale()
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-testid="prompt-toolbar">
      <div className="flex items-center gap-1">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          data-testid="prompt-toolbar-file-input"
          onChange={(e) => {
            onAttachFiles(e.target.files)
            // Allow re-selecting the same file.
            e.target.value = ""
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={t("promptEditor.attach.add")}
          title={t("promptEditor.attach.add")}
          data-testid="prompt-toolbar-attach"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={t("promptEditor.slash.open")}
          title={t("promptEditor.slash.open")}
          data-testid="prompt-toolbar-slash"
          onClick={onOpenSlash}
        >
          <Slash className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={t("promptEditor.mention.insert")}
          title={t("promptEditor.mention.insert")}
          data-testid="prompt-toolbar-mention"
          onClick={onInsertMention}
        >
          <AtSign className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="text-muted-foreground ml-auto text-[11px]">
          {attachments.length}/{MAX_ATTACHMENTS}
        </span>
      </div>

      {attachments.length > 0 && (
        <>
          <ul className="flex flex-wrap gap-1.5" data-testid="prompt-toolbar-attachments">
            {attachments.map((att) => (
              <li key={att.id}>
                <span
                  className="border-input bg-muted/40 inline-flex max-w-[220px] items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                  data-testid="attachment-chip"
                >
                  <span className="truncate" title={att.name}>
                    {att.name}
                  </span>
                  <span className="text-muted-foreground shrink-0">{formatBytes(att.size)}</span>
                  <button
                    type="button"
                    className="hover:text-foreground text-muted-foreground shrink-0"
                    aria-label={t("promptEditor.attach.remove", { name: att.name })}
                    data-testid="attachment-chip-remove"
                    disabled={disabled}
                    onClick={() => onRemoveAttachment(att.id)}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p
            className="text-muted-foreground text-[11px]"
            role="note"
            data-testid="attachment-hint"
          >
            {t("promptEditor.attach.hint")}
          </p>
        </>
      )}
      {rejectedCount > 0 && (
        <p className="text-amber-600 text-[11px]" role="alert" data-testid="attachment-limit">
          {t("promptEditor.attach.limit", { max: MAX_ATTACHMENTS, rejected: rejectedCount })}
        </p>
      )}
    </div>
  )
}
