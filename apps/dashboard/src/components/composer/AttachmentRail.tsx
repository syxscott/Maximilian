// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * AttachmentRail — the staged-attachment strip above the composer input
 * (chat-demo chatInput/DraftAttachments borrowing). Renders one FileCard
 * per staged file, plus an honest notice listing any dropped/pasted
 * directories (folders are not supported — there is no upload channel for
 * them and a directory drop yields an empty-seeming File).
 */
import { useLocale, t } from "@max/i18n"
import type { StagedAttachment } from "./attachments"
import { FileCard } from "./FileCard"

export function AttachmentRail({
  attachments,
  directories,
  onRemove,
}: {
  attachments: readonly StagedAttachment[]
  /** Directory members of the most recent drop/paste, for the notice. */
  directories: readonly string[]
  onRemove: (id: string) => void
}) {
  useLocale()
  if (attachments.length === 0 && directories.length === 0) return null
  return (
    <div className="mb-2 flex flex-col gap-1" data-testid="attachment-rail">
      <div role="list" aria-label={t("composer.attach.railAria")} className="flex flex-wrap gap-2">
        {attachments.map((attachment) => (
          <FileCard key={attachment.id} attachment={attachment} onRemove={onRemove} />
        ))}
      </div>
      {directories.length > 0 && (
        <p
          className="text-[11px] text-amber-600 dark:text-amber-400"
          data-testid="attachment-directories-notice"
        >
          {t("composer.drop.directories", { names: directories.join(", ") })}
        </p>
      )}
    </div>
  )
}
