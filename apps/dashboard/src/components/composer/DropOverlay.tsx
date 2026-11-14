// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DropOverlay — fullscreen attachment affordance while a native file drag
 * is over the page (chat-demo DragMask borrowing): portal to body, dashed
 * drop frame, honest "staged locally" hint. In-app token drags never
 * mount it (useDropIntake suppresses those).
 */
import { createPortal } from "react-dom"
import { FilePlus2 } from "lucide-react"
import { useLocale, t } from "@max/i18n"

export function DropOverlay({ open }: { open: boolean }) {
  useLocale()
  if (!open) return null
  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80"
      data-testid="drop-overlay"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-primary/60 bg-muted/60 px-10 py-8 text-center">
        <FilePlus2 className="h-8 w-8 text-primary" />
        <p className="text-sm font-medium">{t("composer.drop.title")}</p>
        <p className="max-w-xs text-xs text-muted-foreground">{t("composer.drop.hint")}</p>
      </div>
    </div>,
    document.body,
  )
}
