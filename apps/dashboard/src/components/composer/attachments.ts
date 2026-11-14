// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Composer attachment model layer (deepseek ui-attachment borrowing).
 * HONEST BOUNDARY: the dashboard has no file-upload channel today, so this
 * layer stages files locally only — object-URL previews plus file metadata.
 * The submit surface (`AttachmentSubmitPayload` /
 * `serializeAttachmentsForMessage`) pins the shape the future
 * "attachments ride the chat POST" channel will use; the actual
 * serialization into `api.chat` is deliberately NOT implemented (the
 * transport is another agent's App/api territory). Nothing here fakes an
 * upload.
 */

import { mimeToVariant, type AttachmentVariant } from "@/components/ai-elements/model"

/**
 * Custom DataTransfer type marking an application-internal file drag
 * (deepseek FILE_DRAG_TOKEN_TYPE borrowing). The payload is the staged
 * attachment id; the File bytes live in `useDropIntake`'s module registry —
 * DataTransfer can't carry live objects.
 */
export const COMPOSER_DRAG_TOKEN = "application/x-max-composer-drag"

/** Attribute a composer card root carries; token drags land only on it. */
export const COMPOSER_CARD_ATTRIBUTE = "data-composer-card"

/** The File retained by this application during one in-app drag. */
let appDragFile: { token: string; file: File } | undefined

/** Called by a drag source (staged image preview) when a drag starts. */
export function beginAppFileDrag(file: File, token: string): void {
  appDragFile = { token, file }
}

/** Called on dragend so a cancelled drag can't leak its retained bytes. */
export function endAppFileDrag(token: string): void {
  if (appDragFile?.token === token) appDragFile = undefined
}

/** Resolve an original file retained by this application during a drag. */
export function readAppFileDrag(transfer: DataTransfer): File | undefined {
  if (appDragFile === undefined) return undefined
  let token: string
  try {
    token = transfer.getData(COMPOSER_DRAG_TOKEN)
  } catch {
    return undefined
  }
  return appDragFile.token === token ? appDragFile.file : undefined
}

/** One locally-staged attachment (a File the user dropped or pasted). */
export interface StagedAttachment {
  /** Stable local id — also the in-app drag token payload. */
  id: string
  file: File
  name: string
  sizeBytes: number
  mime: string
  /** Display variant, shared with the message AttachmentCard styling. */
  variant: AttachmentVariant
  /** Object URL preview — images only; revoked when the staging drops it. */
  previewUrl?: string
}

/** Reduced attachment descriptor safe to persist / serialize. */
export interface AttachmentMetadata {
  name: string
  sizeBytes: number
  mime: string
  variant: AttachmentVariant
}

/**
 * Payload shape reserved for the future attachment upload channel: the
 * serialized metadata list will ride the chat message's `metadata` field.
 * Kept as a named type so the transport work is a drop-in, not a redesign.
 */
export interface AttachmentSubmitPayload {
  attachments: AttachmentMetadata[]
}

/** Reduce a staged attachment to serializable metadata. */
export function attachmentMetadata(attachment: StagedAttachment): AttachmentMetadata {
  return {
    name: attachment.name,
    sizeBytes: attachment.sizeBytes,
    mime: attachment.mime,
    variant: attachment.variant,
  }
}

/**
 * Serialize staged attachments into the payload the future api channel
 * consumes. TODAY this only feeds the `onSubmitWithAttachments` seam on
 * ChatPanel (App passes no such transport yet — the composer refuses a
 * file-laden send with an honest notice instead of silently dropping the
 * files or pretending an upload happened).
 */
export function serializeAttachmentsForMessage(
  attachments: readonly StagedAttachment[],
): AttachmentSubmitPayload {
  return { attachments: attachments.map(attachmentMetadata) }
}

/**
 * Clipboard files in clipboard order, with members the entry API reports
 * as directories (deepseek ui-conversation input/file-intake.ts borrowing).
 */
export function clipboardFiles(transfer: DataTransfer): {
  files: File[]
  directories: Set<File>
} {
  const files: File[] = []
  const directories = new Set<File>()
  for (const item of transfer.items) {
    if (item.kind !== "file") continue
    const file = item.getAsFile()
    if (file === null) continue
    files.push(file)
    if (
      typeof item.webkitGetAsEntry === "function" &&
      item.webkitGetAsEntry()?.isDirectory === true
    ) {
      directories.add(file)
    }
  }
  return { files, directories }
}

/**
 * Members of a drop that are directories (deepseek ui-attachment
 * drop-events.ts borrowing). The `File` a directory drop yields is
 * indistinguishable from an empty file, so the entry API is the only
 * source of that fact; browsers without it report no directories.
 */
export function droppedDirectories(
  dataTransfer: DataTransfer,
  files: readonly File[],
): ReadonlySet<File> {
  const directories = new Set<File>()
  let fileIndex = 0
  for (const item of dataTransfer.items) {
    if (item.kind !== "file") continue
    const file = files[fileIndex++]
    if (typeof item.webkitGetAsEntry !== "function") continue
    if (item.webkitGetAsEntry()?.isDirectory !== true) continue
    if (file !== undefined) directories.add(file)
  }
  return directories
}

/**
 * Controls that own their own paste; the document-level route never takes
 * a paste out from under them (deepseek file-intake borrowing).
 */
export const EDITABLE_PASTE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

/** Radix modal pattern: an open dialog occludes everything it does not contain. */
const OPEN_DIALOG_SELECTOR = '[role="dialog"][data-state="open"]'

/**
 * Whether one registered composer card may be addressed by the
 * document-level file-paste router: connected, not inside a hidden/inert
 * subtree, and not behind the foreground modal dialog (deepseek
 * addressable() borrowing — the dashboard's modal selector is Radix's
 * `[role="dialog"][data-state="open"]`).
 */
export function isAddressableComposerCard(card: Element, document: Document): boolean {
  if (!card.isConnected) return false
  if (card.closest("[inert], [hidden]") !== null) return false
  const foreground = [...document.querySelectorAll(OPEN_DIALOG_SELECTOR)].at(-1)
  if (foreground !== undefined && !foreground.contains(card)) return false
  return true
}
