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

import { useQuery } from "@tanstack/react-query";
import { usageApi } from "../api";
import { queryKeys } from "../lib/api/hooks.js";

export interface LiveUsage {
  totalCostUsd: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheHitRate: number; // 0..1
  totalRequests: number;
}

const POLL_INTERVAL_MS = 30_000;

export function useLiveUsage(enabled = true) {
  return useQuery<LiveUsage>({
    queryKey: [...queryKeys.usageSummary("today"), "live"],
    queryFn: async ({ signal }) => {
      const s = await usageApi.summary("today", signal);
      return {
        totalCostUsd: s.totalCostUsd,
        totalTokens: s.realTotalTokens,
        cacheReadTokens: s.totalCacheReadTokens,
        cacheHitRate: s.cacheHitRate,
        totalRequests: s.totalRequests,
      };
    },
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: POLL_INTERVAL_MS / 2,
    retry: 2,
  });
}