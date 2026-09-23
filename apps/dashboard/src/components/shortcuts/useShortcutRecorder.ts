// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * useShortcutRecorder — "press the next combo" capture (ZCode
 * useShortcutRecording borrowing). While armed, the next qualifying
 * keydown resolves to a Keybind; Esc cancels; bare modifiers and
 * unmodified printable keys keep the recorder waiting. The listener is
 * window-level in the CAPTURE phase so it wins over app shortcuts.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { Keybind } from "@/lib/commands"
import { recorderOutcome } from "@/lib/keybinds"

export interface UseShortcutRecorderOptions {
  onCapture?: (keybind: Keybind) => void
  onCancel?: () => void
}

export interface ShortcutRecorder {
  /** True while the recorder is armed. */
  recording: boolean
  /** Arm the recorder (idempotent). */
  start: () => void
  /** Disarm without emitting (Esc path). */
  cancel: () => void
}

export function useShortcutRecorder(options: UseShortcutRecorderOptions = {}): ShortcutRecorder {
  const [recording, setRecording] = useState(false)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const stop = useCallback(() => setRecording(false), [])

  const start = useCallback(() => setRecording(true), [])
  const cancel = useCallback(() => {
    setRecording(false)
    optionsRef.current.onCancel?.()
  }, [])

  useEffect(() => {
    if (!recording) return undefined
    const onKeyDown = (e: KeyboardEvent) => {
      const outcome = recorderOutcome(e)
      e.preventDefault()
      if (outcome.kind === "cancel") {
        stop()
        optionsRef.current.onCancel?.()
        return
      }
      if (outcome.kind === "capture") {
        stop()
        optionsRef.current.onCapture?.(outcome.keybind)
      }
      // "ignore": keep waiting for a qualifying combo.
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [recording, stop])

  return { recording, start, cancel }
}
