// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Modal focus contract for custom (non-Radix) overlays.
 *
 * Radix dialogs already trap focus; this hook exists for hand-rolled
 * overlays (QuickPick, the workspace dock's add-panel menu) that have no
 * focus management of their own. It keeps a module-level stack of open
 * overlays so nested overlays behave like dialogs:
 * - only the topmost overlay owns focus;
 * - on mount, focus moves to the first tabbable control unless the content
 *   already focused something inside the overlay (autoFocus or its own
 *   mount effect);
 * - Tab / Shift+Tab wrap inside the overlay, and focus that lands outside
 *   it (programmatic focus, or a non-tabbable element taking focus) is
 *   pulled back in;
 * - on unmount, focus returns to the element that was focused when the
 *   overlay opened, or into the overlay below when that opener is gone.
 *
 * A named radio group counts as a single Tab stop (its checked radio, else
 * its first). Focus events that travelled through the overlay's React
 * `onFocus` are recorded in a WeakSet, so portaled popovers inside the
 * overlay (physically outside the root, but still in the React tree) do
 * not read as "focus escaped".
 *
 * Borrowing: OpenHands `src/components/shared/modals/use-modal-focus.ts`
 * (commit d6161fd3ba), trimmed to what Maximilian's overlays need.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"

const TABBABLE_CANDIDATES = [
  "a[href]",
  "area[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "iframe",
  "summary",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]",
].join(",")

interface OpenModal {
  root: HTMLElement
}

// Every mounted overlay, in mount order. Only the last one owns focus.
const openModals: OpenModal[] = []

function topmostModalRoot(): HTMLElement | null {
  return openModals.at(-1)?.root ?? null
}

function isVisible(element: HTMLElement): boolean {
  return typeof element.checkVisibility === "function"
    ? element.checkVisibility({ visibilityProperty: true })
    : true
}

function isRadioInput(element: Element): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.type === "radio"
}

/** Controls a user reaches with Tab inside `root`, in DOM order. */
function getTabbableElements(root: HTMLElement): HTMLElement[] {
  const tabbable = Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_CANDIDATES)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      !element.closest("[inert]") &&
      isVisible(element),
  )

  // A named radio group is a single Tab stop: its checked radio, else its first.
  return tabbable.filter((element) => {
    if (!isRadioInput(element) || !element.name) return true
    const group = tabbable.filter(
      (other) => isRadioInput(other) && other.name === element.name,
    ) as HTMLInputElement[]
    return element === (group.find((radio) => radio.checked) ?? group[0])
  })
}

function focusFirstTabbable(root: HTMLElement): void {
  ;(getTabbableElements(root)[0] ?? root).focus()
}

export function useModalFocus<T extends HTMLElement = HTMLDivElement>() {
  const rootRef = useRef<T>(null)
  // Read during the first render: children's autoFocus and mount effects run
  // before this component's effects and would already have moved focus.
  const [opener] = useState(() => (typeof document === "undefined" ? null : document.activeElement))
  // Focus events that went through the overlay's onFocus. A set, not just the
  // last one: a focusin can trigger a nested one (a combobox opening moves
  // virtual focus to its option), and marking that must not unmark the outer.
  const focusEventsFromDialogTree = useRef(new WeakSet<Event>())

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const modal: OpenModal = { root }
    openModals.push(modal)

    if (topmostModalRoot() === root && !root.contains(document.activeElement)) {
      focusFirstTabbable(root)
    }

    // Runs after React dispatched the same focusin through the overlay's
    // onFocus, so an unmarked event means focus landed outside the overlay.
    const handleFocusIn = (event: FocusEvent) => {
      // A closing overlay is already detached here; let the new focus stand.
      if (!root.isConnected || topmostModalRoot() !== root) return
      if (focusEventsFromDialogTree.current.has(event)) return
      focusFirstTabbable(root)
    }
    window.addEventListener("focusin", handleFocusIn)

    return () => {
      window.removeEventListener("focusin", handleFocusIn)
      openModals.splice(openModals.indexOf(modal), 1)

      // A real close detaches the overlay before this runs. StrictMode's
      // simulated unmount keeps it attached; restoring focus then would
      // override the content's own autoFocus when the effect re-runs.
      if (root.isConnected) return

      // Leave focus alone if something outside the overlay deliberately took it.
      const active = document.activeElement
      const focusWasInDialog = !active || active === document.body || root.contains(active)
      if (!focusWasInDialog) return
      if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
        opener.focus()
        return
      }
      const below = topmostModalRoot()
      if (below?.isConnected) focusFirstTabbable(below)
    }
  }, [opener])

  const onFocus = useCallback((event: ReactFocusEvent) => {
    focusEventsFromDialogTree.current.add(event.nativeEvent)
  }, [])

  const onKeyDown = useCallback((event: ReactKeyboardEvent) => {
    const root = rootRef.current
    if (
      event.key !== "Tab" ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !root ||
      topmostModalRoot() !== root ||
      !root.contains(event.target as Node)
    ) {
      return
    }
    const tabbable = getTabbableElements(root)
    const first = tabbable[0]
    const last = tabbable.at(-1)
    const active = document.activeElement
    const pullEscapedFocusBack = () => {
      window.setTimeout(() => {
        if (!root.isConnected || topmostModalRoot() !== root) return
        if (root.contains(document.activeElement)) return
        ;(event.shiftKey ? last : first)?.focus()
      }, 0)
    }

    if (!first || !last) {
      event.preventDefault()
      root.focus()
    } else if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || active === root)) {
      event.preventDefault()
      first.focus()
    } else {
      pullEscapedFocusBack()
    }
  }, [])

  return { rootRef, onFocus, onKeyDown }
}
