import { useEffect, useRef, useState } from "react"

/**
 * A debounced signal (React 19 + ink port of the original SolidJS
 * `createDebouncedSignal`).
 *
 * Returns a tuple:
 *   - `value`     : the latest debounced value (read-only state)
 *   - `setValue`  : schedules the value to be applied after `ms` ms
 *
 * Cleanup is handled by a React effect that clears any pending timer when the
 * component unmounts.
 */
export function useDebouncedSignal<T>(value: T, ms: number): [T, (value: T) => void] {
  const [state, setState] = useState<T>(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const setRef = useRef<(next: T) => void>(() => {})

  useEffect(() => {
    setRef.current = (next: T) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined
        setState(() => next)
      }, ms)
    }
  }, [ms])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return [state, setRef.current]
}

/**
 * Returns an alpha value (0-1) that animates from 0 to 1 with a smoothstep
 * easing when `show` becomes true and `enabled` is true.
 *
 * Mirrors the original SolidJS `createFadeIn` helper but uses React hooks.
 */
export function useFadeIn(show: boolean, enabled: boolean): number {
  const [alpha, setAlpha] = useState<number>(show ? 1 : 0)
  const revealedRef = useRef<boolean>(show)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => {
    if (!show) {
      setAlpha(0)
      return
    }

    if (!enabled || revealedRef.current) {
      revealedRef.current = true
      setAlpha(1)
      return
    }

    const start = performance.now()
    revealedRef.current = true
    setAlpha(0)

    timerRef.current = setInterval(() => {
      const progress = Math.min((performance.now() - start) / 160, 1)
      setAlpha(progress * progress * (3 - 2 * progress))
      if (progress >= 1 && timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = undefined
      }
    }, 16)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = undefined
      }
    }
  }, [show, enabled])

  return alpha
}
