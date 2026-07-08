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
import type { UsageSummary } from "../api"

export interface LiveUsage {
  totalCostUsd: number
  totalTokens: number
  cacheReadTokens: number
  cacheHitRate: number
  totalRequests: number
}

export interface UseLiveUsageResult {
  data: LiveUsage | null
  isError: boolean
  isLoading: boolean
}

const POLL_INTERVAL_MS = 30_000

function trim(summary: UsageSummary): LiveUsage {
  return {
    totalCostUsd: summary.totalCostUsd,
    totalTokens: summary.realTotalTokens,
    cacheReadTokens: summary.totalCacheReadTokens,
    cacheHitRate: summary.cacheHitRate,
    totalRequests: summary.totalRequests,
  }
}

export function useLiveUsage(enabled = true): UseLiveUsageResult {
  const sdk = useSDK()
  const [data, setData] = useState<LiveUsage | null>(null)
  const [isError, setIsError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!enabled) return
    const ctrl = new AbortController()
    let cancelled = false

    async function poll() {
      try {
        const summary = await sdk.client.get<UsageSummary>(
          "/api/obs/usage/summary?range=today",
        )
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
