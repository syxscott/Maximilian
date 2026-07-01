import { useEffect, useState } from "react"

/**
 * Returns whether the supplied CSS media query currently matches.
 *
 * Defaults to `false` on the server. The first client render also uses
 * `false` if `window.matchMedia` is unavailable, then updates once the
 * listener attaches.
 */
export function useMediaQuery(query: string): boolean {
  const getMatch = (): boolean => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false
    }
    return window.matchMedia(query).matches
  }

  const [matches, setMatches] = useState<boolean>(getMatch)

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return
    }
    const mql = window.matchMedia(query)
    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches)
    }
    setMatches(mql.matches)

    // Modern browsers use addEventListener; older Safari uses addListener.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler)
      return () => mql.removeEventListener("change", handler)
    }
    mql.addListener(handler)
    return () => mql.removeListener(handler)
  }, [query])

  return matches
}