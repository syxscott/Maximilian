import { useEffect, useRef, useState } from "react"

export interface UseIntersectionOptions extends Omit<IntersectionObserverInit, "root"> {
  /** Whether the observer should currently be active. */
  enabled?: boolean
  /** A callback that runs once per intersection event. */
  onChange?: (entry: IntersectionObserverEntry) => void
  /** When true, disconnect after the first time the element enters the viewport. */
  once?: boolean
}

/**
 * Observes the referenced element with `IntersectionObserver` and returns
 * the latest entry plus a `ref` to attach to the target element.
 */
export function useIntersection<T extends Element = Element>(
  options: UseIntersectionOptions = {},
): {
  ref: (el: T | null) => void
  entry: IntersectionObserverEntry | undefined
  isIntersecting: boolean
} {
  const { enabled = true, onChange, once = false, threshold, rootMargin } = options

  const elementRef = useRef<T | null>(null)
  const [entry, setEntry] = useState<IntersectionObserverEntry | undefined>(undefined)
  const [isIntersecting, setIsIntersecting] = useState<boolean>(false)

  // We need to support a callback ref so the consumer can attach the ref to a node.
  const setRef = (el: T | null) => {
    elementRef.current = el
  }

  useEffect(() => {
    if (!enabled) return
    const el = elementRef.current
    if (!el) return
    if (typeof IntersectionObserver === "undefined") return

    const observer = new IntersectionObserver(
      (entries) => {
        const latest = entries[entries.length - 1]
        setEntry(latest)
        setIsIntersecting(latest.isIntersecting)
        onChange?.(latest)
        if (once && latest.isIntersecting) {
          observer.disconnect()
        }
      },
      {
        threshold,
        rootMargin,
      },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled, onChange, once, threshold, rootMargin])

  return { ref: setRef, entry, isIntersecting }
}