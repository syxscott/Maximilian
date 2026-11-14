// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Composer attachment intake (deepseek ui-attachment drop-events.ts +
 * ui-conversation input/file-intake.ts borrowing, adapted to a single-hook
 * API):
 *
 *   - Document-level dragenter/leave with a NESTED-DEPTH COUNTER —
 *     dragenter/dragleave fire on every child boundary, so only depth 0→1
 *     turns the overlay on and only back to 0 turns it off.
 *   - Directory drops are detected via `webkitGetAsEntry` and reported
 *     separately (the composer shows a "folders not supported" notice).
 *   - In-app image drags carry a custom DataTransfer token: a token drag
 *     is only intaken when dropped over a composer card
 *     (`[data-composer-card]`), and it never triggers the fullscreen
 *     overlay, so dragging a staged preview across other panels can't
 *     misroute.
 *   - Document-level paste routing: a FILE paste that does not land in an
 *     editable control addresses the most recently focused composer card
 *     that is still connected, not hidden/inert, and not occluded by an
 *     open modal dialog.
 */

import { useEffect, useRef, useState, type RefObject } from "react"
import {
  beginAppFileDrag,
  clipboardFiles,
  droppedDirectories,
  endAppFileDrag,
  isAddressableComposerCard,
  readAppFileDrag,
  COMPOSER_CARD_ATTRIBUTE,
  COMPOSER_DRAG_TOKEN,
  EDITABLE_PASTE_SELECTOR,
} from "./attachments"

// ── Document-level paste router (deepseek createComposerFileIntake) ────────

interface ComposerIntakeTarget {
  card: Element
  accepts: () => boolean
  add: (files: File[], directories: ReadonlySet<File>) => void
}

const intakeTargets = new Set<ComposerIntakeTarget>()
let focusedIntake: ComposerIntakeTarget | undefined
let uninstallIntake: (() => void) | undefined

function installIntakeListeners(document: Document): () => void {
  const focusin = (event: FocusEvent): void => {
    // Document focusin events always target a node of this document.
    const node = event.target as Node
    focusedIntake = [...intakeTargets].find((candidate) => candidate.card.contains(node))
  }
  const paste = (event: ClipboardEvent): void => {
    // A focused composer editor consumes its own paste before bubbling here.
    if (event.defaultPrevented || event.clipboardData === null) return
    // The first path element sees through shadow roots.
    const origin = event.composedPath().find((value) => value instanceof Element)
    if (origin instanceof Element && origin.closest(EDITABLE_PASTE_SELECTOR) !== null) return
    const { files, directories } = clipboardFiles(event.clipboardData)
    if (files.length === 0) return
    const addressable = [...intakeTargets].filter(
      (target) =>
        target.card.ownerDocument === document &&
        isAddressableComposerCard(target.card, document) &&
        target.accepts(),
    )
    const target =
      focusedIntake !== undefined && addressable.includes(focusedIntake)
        ? focusedIntake
        : addressable[0]
    if (target === undefined) return
    event.preventDefault()
    target.add(files, directories.size === 0 ? new Set<File>() : directories)
  }
  document.addEventListener("focusin", focusin, true)
  document.addEventListener("paste", paste)
  return () => {
    document.removeEventListener("focusin", focusin, true)
    document.removeEventListener("paste", paste)
  }
}

/**
 * Register one composer card with the document paste router. Listeners
 * exist only while at least one card is registered; unregistering the
 * last card tears them down (deepseek intake install/uninstall parity).
 */
export function registerComposerIntake(target: ComposerIntakeTarget): () => void {
  intakeTargets.add(target)
  if (target.card.contains(target.card.ownerDocument.activeElement)) focusedIntake = target
  uninstallIntake ??= installIntakeListeners(target.card.ownerDocument)
  return () => {
    intakeTargets.delete(target)
    if (focusedIntake === target) focusedIntake = undefined
    if (intakeTargets.size === 0) {
      uninstallIntake?.()
      uninstallIntake = undefined
    }
  }
}

// ── Drop intake hook ────────────────────────────────────────────────────────

export interface UseDropIntakeOptions {
  /** The composer card root — token drags land only over this element. */
  cardRef: RefObject<HTMLElement | null>
  /** File intake callback (drop or routed paste). */
  onAddFiles: (files: File[], directories: ReadonlySet<File>) => void
  /** False while the composer refuses files (dropEffect = "none"). */
  enabled?: boolean
}

/**
 * Install one composer's document drop listeners + paste registration.
 * Returns whether a native file drag is active (drives the fullscreen
 * overlay). In-app token drags never flip it — they show no overlay and
 * only land over a composer card.
 */
export function useDropIntake({ cardRef, onAddFiles, enabled = true }: UseDropIntakeOptions): {
  dragActive: boolean
} {
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  // Callback refs kept current without re-installing the listeners.
  const onAddFilesRef = useRef(onAddFiles)
  onAddFilesRef.current = onAddFiles
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(() => {
    const fileTransfer = (event: DragEvent): DataTransfer | null => {
      const dataTransfer = event.dataTransfer
      if (
        dataTransfer === null ||
        (!dataTransfer.types.includes("Files") && !dataTransfer.types.includes(COMPOSER_DRAG_TOKEN))
      ) {
        return null
      }
      if (
        dataTransfer.types.includes(COMPOSER_DRAG_TOKEN) &&
        (!(event.target instanceof Element) ||
          event.target.closest(`[${COMPOSER_CARD_ATTRIBUTE}]`) === null)
      ) {
        // An in-app drag released outside any composer — never route it.
        return null
      }
      return dataTransfer
    }
    const reset = (): void => {
      dragDepth.current = 0
      setDragActive(false)
    }
    const onDragEnter = (event: DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      dragDepth.current += 1
      // Native file drags show the fullscreen overlay; in-app token drags
      // don't (they only land over a composer card anyway).
      if (!dataTransfer.types.includes(COMPOSER_DRAG_TOKEN)) setDragActive(true)
    }
    const onDragOver = (event: DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      dataTransfer.dropEffect = enabledRef.current ? "copy" : "none"
    }
    const onDragLeave = (event: DragEvent): void => {
      if (fileTransfer(event) === null) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
      const leftViewport =
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      if (
        (event.target === document.documentElement || event.target === document.body) &&
        leftViewport
      ) {
        reset()
      }
    }
    const onDrop = (event: DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      reset()
      if (!enabledRef.current) return
      const inApp = dataTransfer.types.includes(COMPOSER_DRAG_TOKEN)
        ? readAppFileDrag(dataTransfer)
        : undefined
      const files = inApp === undefined ? [...dataTransfer.files] : [inApp]
      if (files.length > 0) {
        onAddFilesRef.current(files, droppedDirectories(dataTransfer, files))
      }
    }
    document.addEventListener("dragenter", onDragEnter)
    document.addEventListener("dragover", onDragOver)
    document.addEventListener("dragleave", onDragLeave)
    document.addEventListener("drop", onDrop)
    window.addEventListener("dragend", reset)
    return () => {
      document.removeEventListener("dragenter", onDragEnter)
      document.removeEventListener("dragover", onDragOver)
      document.removeEventListener("dragleave", onDragLeave)
      document.removeEventListener("drop", onDrop)
      window.removeEventListener("dragend", reset)
    }
  }, [])

  // Paste router registration lives for the card's lifetime. Ref callbacks
  // run before effects, so the card element is set by the time this runs.
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    return registerComposerIntake({
      card,
      accepts: () => enabledRef.current,
      add: (files, directories) => onAddFilesRef.current(files, directories),
    })
  }, [cardRef])

  // Unmount mid-drag: clear the depth counter and the overlay state.
  useEffect(
    () => () => {
      dragDepth.current = 0
      setDragActive(false)
    },
    [],
  )

  return { dragActive }
}

export { beginAppFileDrag, endAppFileDrag, COMPOSER_DRAG_TOKEN }
