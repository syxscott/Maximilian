/**
 * Live usage polling for the TUI home view — mirrors the dashboard's
 * `useLiveUsage` hook at apps/dashboard/src/hooks/useLiveUsage.ts: 30s
 * cadence, same `/api/obs/usage/summary?range=today` endpoint, same
 * trimmed-down return shape (cost, tokens, cache hit rate, request count).
 *
 * The TUI doesn't use React Query, so this is a plain useState + setInterval
 * implementation. We do AbortController plumbing so unmounting the home view
 * (e.g. navigating to a session) cancels any in-flight request — otherwise
 * React 19 + ink would warn about state updates on an unmounted component.
 */
import { useEffect, useState } from "react"
import { useSDK } from "../context/sdk"
const POLL_INTERVAL_MS = 30_000
function trim(summary) {
  return {
    totalCostUsd: summary.totalCostUsd,
    // False when any request in the window lacked pricing (total is partial).
    totalCostUsdKnown: summary.totalCostUsdKnown,
    totalTokens: summary.realTotalTokens,
    cacheReadTokens: summary.totalCacheReadTokens,
    cacheHitRate: summary.cacheHitRate,
    totalRequests: summary.totalRequests,
  }
}
export function useLiveUsage(enabled = true) {
  const sdk = useSDK()
  const [data, setData] = useState(null)
  const [isError, setIsError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    if (!enabled) return
    const ctrl = new AbortController()
    let cancelled = false
    async function poll() {
      try {
        const summary = await sdk.client.get("/api/obs/usage/summary?range=today")
        if (cancelled || ctrl.signal.aborted) return
        setData(trim(summary))
        setIsError(false)
      } catch (err) {
        if (cancelled || ctrl.signal.aborted) return
        // Surface as a soft error: keep showing the last known value, but
        // flip isError so the UI can render a stale indicator.
        if (err instanceof DOMException && err.name === "AbortError") return
        setIsError(true)
      } finally {
        if (!cancelled && !ctrl.signal.aborted) setIsLoading(false)
      }
    }
    void poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
      ctrl.abort()
    }
  }, [sdk.client, enabled])
  return { data, isError, isLoading }
}
