import { useCallback, useEffect, useState } from "react"

type Setter<T> = (value: T | ((prev: T) => T)) => void

/**
 * Persists state in `window.localStorage` under the given key.
 *
 * Falls back to the initial value (or defaultValue) when storage is unavailable
 * or the stored value fails to deserialize.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, Setter<T>] {
  const read = useCallback((): T => {
    if (typeof window === "undefined") return initialValue
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return initialValue
      return JSON.parse(raw) as T
    } catch {
      return initialValue
    }
  }, [key, initialValue])

  const [value, setValue] = useState<T>(read)

  const set = useCallback<Setter<T>>(
    (next) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next
        try {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(key, JSON.stringify(resolved))
          }
        } catch {
          // ignore quota / serialization errors
        }
        return resolved
      })
    },
    [key],
  )

  // Keep multiple tabs/windows in sync via the native `storage` event.
  useEffect(() => {
    if (typeof window === "undefined") return
    const handler = (e: StorageEvent) => {
      if (e.key !== key) return
      if (e.newValue === null) {
        setValue(initialValue)
        return
      }
      try {
        setValue(JSON.parse(e.newValue) as T)
      } catch {
        setValue(initialValue)
      }
    }
    window.addEventListener("storage", handler)
    return () => window.removeEventListener("storage", handler)
  }, [key, initialValue])

  return [value, set]
}