import { useEffect } from "react"

export interface KeyboardShortcutOptions {
  key: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
  /** Prevent the browser's default action for this shortcut. */
  preventDefault?: boolean
  /** Stop the event from bubbling. */
  stopPropagation?: boolean
  /**
   * If `false`, the listener is attached but the handler won't run.
   * Useful for transiently disabling a shortcut.
   */
  enabled?: boolean
}

/**
 * Normalizes the comparison so that `" "` (space) and `Escape` work as expected.
 */
function matchesKey(event: KeyboardEvent, target: string): boolean {
  if (event.key === target) return true
  // Browser reports "Esc" on some older engines; normalize.
  if (target === "Escape" && (event.key === "Esc" || event.key === "escape")) return true
  if (target === " " && event.code === "Space") return true
  return false
}

/**
 * Attaches a global `keydown` listener that invokes `handler` when the
 * supplied key combo matches.
 */
export function useKeyboardShortcut(
  options: KeyboardShortcutOptions | KeyboardShortcutOptions[],
  handler: (event: KeyboardEvent) => void,
): void {
  const list = Array.isArray(options) ? options : [options]

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const opt of list) {
        if (opt.enabled === false) continue
        if (!matchesKey(event, opt.key)) continue
        if (Boolean(opt.ctrl) !== event.ctrlKey) continue
        if (Boolean(opt.meta) !== event.metaKey) continue
        if (Boolean(opt.shift) !== event.shiftKey) continue
        if (Boolean(opt.alt) !== event.altKey) continue

        if (opt.preventDefault) event.preventDefault()
        if (opt.stopPropagation) event.stopPropagation()
        handler(event)
        return
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [list, handler])
}