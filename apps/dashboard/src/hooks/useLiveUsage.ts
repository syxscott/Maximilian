/**
 * Live usage polling — used by the top-right "live usage pill" so users
 * see today's token spend + cost without opening the Usage tab.
 *
 * Polls /api/obs/usage/summary?range=today every `pollIntervalMs`. The
 * server-side aggregation is cheap (one in-memory scan over MetricRecord)
 * so 30s is a fine cadence — fresher than manual navigation, lighter than
 * SSE for the dashboard's user base.
 *
 * Returns the trimmed-down shape the pill needs, plus an `isStale` flag
 * for the UI to render a "..." indicator when the last poll failed.
 */

import { useQuery } from "@tanstack/react-query"
import { usageApi } from "../api"

export interface LiveUsage {
  totalCostUsd: number
  /** False when any request in the window lacked pricing (total is partial). */
  totalCostUsdKnown?: boolean
  totalTokens: number
  cacheReadTokens: number
  cacheHitRate: number // 0..1
  totalRequests: number
}

const POLL_INTERVAL_MS = 30_000

// Distinct prefix from `queryKeys.usageSummary("today")` so the cached
// trimmed `LiveUsage` shape (this hook) never gets read back as the full
// `UsageSummary` (which has `latency.sampleCount`, etc). Mounting order
// was previously: LiveUsagePill ran first → cached the trimmed object →
// UsagePanel then selected "today" → TanStack handed it the trimmed
// shape and crashed on `s.latency.sampleCount`.
const LIVE_USAGE_KEY = ["live-usage", "today"] as const

export function useLiveUsage(enabled = true) {
  return useQuery<LiveUsage>({
    queryKey: LIVE_USAGE_KEY,
    queryFn: async ({ signal }) => {
      const s = await usageApi.summary("today", signal)
      return {
        totalCostUsd: s.totalCostUsd,
        totalCostUsdKnown: s.totalCostUsdKnown,
        totalTokens: s.realTotalTokens,
        cacheReadTokens: s.totalCacheReadTokens,
        cacheHitRate: s.cacheHitRate,
        totalRequests: s.totalRequests,
      }
    },
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: POLL_INTERVAL_MS / 2,
    retry: 2,
  })
}
