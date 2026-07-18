/**
 * TanStack React Query hooks — single API client source of truth.
 * All fetches go through `../../api` (Zod-validated responses).
 */

import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from "@tanstack/react-query"
import { chatApi, metaApi, obsApi, govApi, usageApi } from "../../api"
import type {
  Health,
  ExecutionTrace,
  TimelineEntry,
  PendingProposal,
  ProviderListResponse,
  UsageSummary,
  UsageDailyResponse,
  UsageRange,
} from "../../api"

// ── Query keys ───────────────────────────────────────────────────────────

export const queryKeys = {
  health: ["health"] as const,
  providers: ["providers"] as const,
  executions: ["executions"] as const,
  evolutions: ["evolutions"] as const,
  timeline: ["timeline"] as const,
  pendingProposals: ["pending-proposals"] as const,
  usageSummary: (range: UsageRange) => ["usage-summary", range] as const,
  usageDaily: (range: UsageRange) => ["usage-daily", range] as const,
}

// ── Health ───────────────────────────────────────────────────────────────

export function useHealth(options?: Partial<UseQueryOptions<Health>>) {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => metaApi.health(signal),
    staleTime: 30_000,
    retry: 2,
    ...options,
  })
}

// ── Providers ────────────────────────────────────────────────────────────

export function useProviders(options?: Partial<UseQueryOptions<ProviderListResponse>>) {
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: ({ signal }) => chatApi.listProviders(signal),
    staleTime: 10_000,
    ...options,
  })
}

export function useSetDefaultProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ providerId, signal }: { providerId: string; signal?: AbortSignal }) =>
      chatApi.setDefaultProvider(providerId, signal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providers })
    },
  })
}

export function useSetProviderModel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      providerId,
      model,
      signal,
    }: {
      providerId: string
      model: string
      signal?: AbortSignal
    }) => chatApi.setProviderModel(providerId, model, signal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providers })
    },
  })
}

// ── Failover & Health (borrowed from cc-switch) ─────────────────────────

export const failoverKeys = {
  queue: ["failover-queue"] as const,
  health: (providerId: string) => ["provider-health", providerId] as const,
  circuitBreakerStats: (providerId: string) => ["circuit-breaker-stats", providerId] as const,
  autoFailoverEnabled: ["auto-failover-enabled"] as const,
}

/** Get provider health status (polled every 5s by dashboard). */
export function useProviderHealth(providerId: string | null) {
  return useQuery({
    queryKey: failoverKeys.health(providerId ?? ""),
    queryFn: ({ signal }) => chatApi.getProviderHealth(providerId!, signal),
    enabled: !!providerId,
    refetchInterval: 5_000,
    retry: false,
  })
}

/** Get circuit breaker statistics for a provider. */
export function useCircuitBreakerStats(providerId: string | null) {
  return useQuery({
    queryKey: failoverKeys.circuitBreakerStats(providerId ?? ""),
    queryFn: ({ signal }) => chatApi.getCircuitBreakerStats(providerId!, signal),
    enabled: !!providerId,
    refetchInterval: 5_000,
  })
}

/** Reset circuit breaker for a provider. */
export function useResetCircuitBreaker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ providerId, signal }: { providerId: string; signal?: AbortSignal }) =>
      chatApi.resetCircuitBreaker(providerId, signal),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: failoverKeys.health(variables.providerId) })
      qc.invalidateQueries({ queryKey: queryKeys.providers })
    },
  })
}

/** Get the current failover queue. */
export function useFailoverQueue() {
  return useQuery({
    queryKey: failoverKeys.queue,
    queryFn: ({ signal }) => chatApi.getFailoverQueue(signal),
  })
}

/** Add a provider to the failover queue. */
export function useAddToFailoverQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      providerId,
      priority,
      signal,
    }: {
      providerId: string
      priority?: number
      signal?: AbortSignal
    }) => chatApi.addToFailoverQueue(providerId, priority, signal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: failoverKeys.queue })
      qc.invalidateQueries({ queryKey: queryKeys.providers })
    },
  })
}

/** Remove a provider from the failover queue. */
export function useRemoveFromFailoverQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ providerId, signal }: { providerId: string; signal?: AbortSignal }) =>
      chatApi.removeFromFailoverQueue(providerId, signal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: failoverKeys.queue })
      qc.invalidateQueries({ queryKey: queryKeys.providers })
    },
  })
}

/** Get auto-failover enabled state. */
export function useAutoFailoverEnabled() {
  return useQuery({
    queryKey: failoverKeys.autoFailoverEnabled,
    queryFn: ({ signal }) => chatApi.getAutoFailoverEnabled(signal),
    // Default to false while loading (matches backend default)
    placeholderData: { enabled: false },
  })
}

/** Set auto-failover enabled state. */
export function useSetAutoFailoverEnabled() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ enabled, signal }: { enabled: boolean; signal?: AbortSignal }) =>
      chatApi.setAutoFailoverEnabled(enabled, signal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: failoverKeys.autoFailoverEnabled })
      qc.invalidateQueries({ queryKey: queryKeys.providers })
    },
  })
}

// ── Executions (polling) ─────────────────────────────────────────────────

export function useExecutions(pollInterval = 5000) {
  return useQuery({
    queryKey: queryKeys.executions,
    queryFn: ({ signal }) => obsApi.listExecutions(signal),
    refetchInterval: pollInterval,
    // Don't burn battery when the tab is hidden — the user can't see
    // updates anyway, and the next focused poll covers any missed events.
    refetchIntervalInBackground: false,
  })
}

export function useExecutionGraph(executionId: string | null) {
  return useQuery({
    queryKey: ["execution-graph", executionId],
    queryFn: ({ signal }) => obsApi.getGraph(executionId!, signal),
    enabled: !!executionId,
  })
}

// ── Evolution (polling) ──────────────────────────────────────────────────

export function useTimeline(pollInterval = 5000) {
  return useQuery({
    queryKey: queryKeys.timeline,
    queryFn: ({ signal }) => obsApi.getTimeline(signal),
    refetchInterval: pollInterval,
    refetchIntervalInBackground: false,
  })
}

// ── Governance (polling) ─────────────────────────────────────────────────

export function usePendingProposals(pollInterval = 5000) {
  return useQuery({
    queryKey: queryKeys.pendingProposals,
    queryFn: ({ signal }) => govApi.listPending(signal),
    refetchInterval: pollInterval,
    refetchIntervalInBackground: false,
  })
}

export function useResolveProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      action,
      reason,
      user,
    }: {
      id: string
      action: "approve" | "reject"
      reason: string
      user: string
    }) => govApi.resolveProposal(id, action, reason, user),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.pendingProposals })
    },
  })
}

// ── Usage ─────────────────────────────────────────────────────────────────

export function useUsageSummary(range: UsageRange) {
  return useQuery({
    queryKey: queryKeys.usageSummary(range),
    queryFn: ({ signal }) => usageApi.summary(range, signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

export function useUsageDaily(range: UsageRange) {
  return useQuery({
    queryKey: queryKeys.usageDaily(range),
    queryFn: ({ signal }) => usageApi.daily(range, signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}
