// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Escape priority for dialogs containing comboboxes / selects.
 *
 * An expanded combobox consumes the first Escape itself (Radix Select and
 * React Aria close their listbox and let the event keep propagating), which
 * would otherwise also close the dialog and discard unsaved input. The
 * dialog should ignore that first press and only close on the next one.
 *
 * Reading the expanded state needs the capture phase: React's discrete
 * keydown handlers collapse the popup during the bubble phase, so a bubble
 * listener would always observe the already-closed state. The returned
 * `consume` runs from the dialog's own `onEscapeKeyDown`; when it reports
 * that an expanded combobox claimed the press, the caller prevents the
 * default (Radix's dismissal) and resets for the next keypress.
 *
 * Borrowing: OpenHands `src/components/shared/modals/modal-backdrop.tsx`
 * lines 45-63 (commit 446c868b54).
 */
import { useCallback, useEffect, useRef } from "react"

export function useComboboxEscapeGuard() {
  const expandedAtKeypressRef = useRef(false)

  useEffect(() => {
    const recordComboboxState = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const target = event.target instanceof Element ? event.target : null
      expandedAtKeypressRef.current =
        target?.getAttribute("role") === "combobox" &&
        target.getAttribute("aria-expanded") === "true"
    }
    window.addEventListener("keydown", recordComboboxState, true)
    return () => window.removeEventListener("keydown", recordComboboxState, true)
  }, [])

  return useCallback(() => {
    if (!expandedAtKeypressRef.current) return false
    expandedAtKeypressRef.current = false
    return true
  }, [])
}
