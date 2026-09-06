import { jsxs as _jsxs } from "react/jsx-runtime"
/**
 * Two-step destructive confirmation helper (borrowed from
 * sdeonvacation/opencode-x/cli/cmd/tui/component/dialog-session-list.tsx:172-182).
 *
 * Background: opencode-x's session-list dialog requires the user to press
 * the same key twice (within a 3-second window) before a destructive
 * action (e.g. delete) actually fires. The first press flips a flag and
 * shows "Press X again to confirm" in red; the second press within the
 * window commits the action. This is the standard "tap-to-confirm" pattern
 * from Gmail / GitHub.
 *
 * Maximilian's adaptation: a React hook + tiny visual component that:
 *   - tracks an "armed" state with a 3s timeout.
 *   - returns a `confirm(actionKey, fn)` wrapper that:
 *     - first call: arms and returns false (caller should re-render with
 *       a "Press again to confirm" prompt).
 *     - second call within window: runs `fn()` and returns true.
 *     - call after timeout: re-arms (treats it as a fresh attempt).
 *   - also exposes a `<ConfirmBadge>` JSX fragment for inline rendering.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Text } from "ink"
export const CONFIRM_WINDOW_MS = 3_000
export function useDestructiveConfirm(windowMs = CONFIRM_WINDOW_MS) {
  const [armed, setArmed] = useState(false)
  const timerRef = useRef(null)
  const armedKeyRef = useRef(null)
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])
  useEffect(() => () => clearTimer(), [clearTimer])
  const disarm = useCallback(() => {
    setArmed(false)
    armedKeyRef.current = null
    clearTimer()
  }, [clearTimer])
  const trigger = useCallback(
    (actionKey, fn) => {
      if (armed && armedKeyRef.current === actionKey) {
        // Second press within window — commit.
        clearTimer()
        setArmed(false)
        armedKeyRef.current = null
        void fn()
        return true
      }
      // First press — arm.
      armedKeyRef.current = actionKey
      setArmed(true)
      clearTimer()
      timerRef.current = setTimeout(() => {
        setArmed(false)
        armedKeyRef.current = null
        timerRef.current = null
      }, windowMs)
      return false
    },
    [armed, clearTimer, windowMs],
  )
  return { armed, trigger, disarm }
}
/**
 * Visual badge shown next to a destructive button when the user has
 * armed it. Inline use: `<ConfirmBadge armed action="delete" />`.
 */
export function ConfirmBadge({ armed, action = "delete" }) {
  if (!armed) return null
  return _jsxs(Text, {
    color: "red",
    bold: true,
    children: [" ", "\u26A0 Press ", action, " again to confirm"],
  })
}
