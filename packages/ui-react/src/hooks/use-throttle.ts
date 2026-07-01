import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Returns a throttled value that updates at most once every `interval` ms.
 */
export function useThrottle<T>(value: T, interval: number = 300): T {
  const [throttled, setThrottled] = useState<T>(value)
  const lastUpdatedRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latestValueRef = useRef<T>(value)

  latestValueRef.current = value

  useEffect(() => {
    const now = Date.now()
    const elapsed = now - lastUpdatedRef.current

    if (elapsed >= interval) {
      lastUpdatedRef.current = now
      setThrottled(value)
    } else {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        lastUpdatedRef.current = Date.now()
        setThrottled(latestValueRef.current)
      }, interval - elapsed)
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, interval])

  return throttled
}

/**
 * Returns a throttled version of the supplied callback that fires at most once
 * every `interval` ms. The most recent arguments are always used.
 */
export function useThrottledCallback<T extends (...args: any[]) => void>(
  fn: T,
  interval: number = 300,
): (...args: Parameters<T>) => void {
  const lastCalledRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const argsRef = useRef<Parameters<T> | undefined>(undefined)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  useEffect(() => cancel, [cancel])

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now()
      const elapsed = now - lastCalledRef.current
      argsRef.current = args

      if (elapsed >= interval) {
        lastCalledRef.current = now
        fnRef.current(...args)
      } else {
        cancel()
        timerRef.current = setTimeout(() => {
          lastCalledRef.current = Date.now()
          if (argsRef.current) fnRef.current(...argsRef.current)
        }, interval - elapsed)
      }
    },
    [interval, cancel],
  )
}