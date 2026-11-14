// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Local attachment staging state (deepseek ui-attachment composer-state
 * borrowing, scoped to the honest dashboard boundary): files dropped or
 * pasted become `StagedAttachment` entries with object-URL previews for
 * images; removal and unmount revoke every URL. No upload, no persistence
 * — blobs never leave the page lifetime.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { mimeToVariant } from "@/components/ai-elements/model"
import { endAppFileDrag, type StagedAttachment } from "./attachments"

export interface AttachmentStaging {
  attachments: StagedAttachment[]
  /** Directory members of the most recent intake (names for the notice). */
  directoryNames: string[]
  addFiles: (files: File[], directories: ReadonlySet<File>) => void
  remove: (id: string) => void
  clear: () => void
}

export function useAttachmentStaging(): AttachmentStaging {
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [directoryNames, setDirectoryNames] = useState<string[]>([])
  const idRef = useRef(0)
  // Mirror for the unmount cleanup (revoke every live object URL).
  const liveRef = useRef<StagedAttachment[]>([])
  liveRef.current = attachments

  const addFiles = useCallback((files: File[], directories: ReadonlySet<File>) => {
    setDirectoryNames([...directories].map((d) => d.name))
    setAttachments((prev) => {
      const next = [...prev]
      for (const file of files) {
        // An in-app re-drop resolves the SAME File object — skip instead of
        // duplicating the card (token drag round trip must be idempotent).
        if (prev.some((existing) => existing.file === file)) continue
        const isImage = file.type.startsWith("image/")
        idRef.current += 1
        next.push({
          id: `att-${idRef.current}`,
          file,
          name: file.name,
          sizeBytes: file.size,
          mime: file.type,
          variant: mimeToVariant(file.type, file.name),
          previewUrl: isImage ? URL.createObjectURL(file) : undefined,
        })
      }
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      // A removed card can no longer serve an in-flight drag of its bytes.
      endAppFileDrag(id)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  const clear = useCallback(() => {
    setAttachments((prev) => {
      for (const a of prev) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
      return []
    })
  }, [])

  useEffect(
    () => () => {
      for (const a of liveRef.current) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
    },
    [],
  )

  return { attachments, directoryNames, addFiles, remove, clear }
}
