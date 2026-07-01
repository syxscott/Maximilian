import { useEffect, useRef, useState } from "react"

export interface Size {
  width: number
  height: number
}

export interface UseResizeOptions {
  /** Whether the observer is active. */
  enabled?: boolean
  /** Override the default `content-box` box model used to compute size. */
  box?: "content-box" | "border-box"
  /** Round the reported size to this many decimal places. */
  round?: number
}

/**
 * Observes the referenced element with `ResizeObserver` and reports the
 * current width/height.
 */
export function useResize<T extends Element = Element>(
  options: UseResizeOptions = {},
): {
  ref: (el: T | null) => void
  size: Size | undefined
} {
  const { enabled = true, box = "content-box", round } = options

  const elementRef = useRef<T | null>(null)
  const [size, setSize] = useState<Size | undefined>(undefined)

  const setRef = (el: T | null) => {
    elementRef.current = el
  }

  useEffect(() => {
    if (!enabled) return
    const el = elementRef.current
    if (!el) return
    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver((entries) => {
      const latest = entries[entries.length - 1]
      if (!latest) return
      const target = latest.target as Element
      const rect = box === "border-box" ? target.getBoundingClientRect() : latest.contentRect
      const next: Size = {
        width: round !== undefined ? Math.round(rect.width * 10 ** round) / 10 ** round : rect.width,
        height: round !== undefined ? Math.round(rect.height * 10 ** round) / 10 ** round : rect.height,
      }
      setSize(next)
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled, box, round])

  return { ref: setRef, size }
}