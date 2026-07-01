/**
 * TanStack React Query hooks — single API client source of truth.
 * All fetches go through `../../api` (Zod-validated responses).
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { chatApi, metaApi, obsApi, govApi, usageApi } from "../../api";
import type {
  Health,
  ExecutionTrace,
  TimelineEntry,
  PendingProposal,
  ProviderListResponse,
  UsageSummary,
  UsageDailyResponse,
  UsageRange,
} from "../../api";

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
};

// ── Health ───────────────────────────────────────────────────────────────

export function useHealth(options?: Partial<UseQueryOptions<Health>>) {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => metaApi.health(signal),
    staleTime: 30_000,
    retry: 2,
    ...options,
  });
}

// ── Providers ────────────────────────────────────────────────────────────

export function useProviders(options?: Partial<UseQueryOptions<ProviderListResponse>>) {
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: ({ signal }) => chatApi.listProviders(signal),
    staleTime: 10_000,
    ...options,
  });
}

export function useSetDefaultProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, signal }: { providerId: string; signal?: AbortSignal }) =>
      chatApi.setDefaultProvider(providerId, signal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providers });
    },
  });
}

export function useSetProviderModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, model, signal }: { providerId: string; model: string; signal?: AbortSignal }) =>
      chatApi.setProviderModel(providerId, model, signal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providers });
    },
  });
}

// ── Executions (polling) ─────────────────────────────────────────────────

export function useExecutions(pollInterval = 5000) {
  return useQuery({
    queryKey: queryKeys.executions,
    queryFn: ({ signal }) => obsApi.listExecutions(signal),
    refetchInterval: pollInterval,
  });
}

export function useExecutionGraph(executionId: string | null) {
  return useQuery({
    queryKey: ["execution-graph", executionId],
    queryFn: ({ signal }) => obsApi.getGraph(executionId!, signal),
    enabled: !!executionId,
  });
}

// ── Evolution (polling) ──────────────────────────────────────────────────

export function useTimeline(pollInterval = 5000) {
  return useQuery({
    queryKey: queryKeys.timeline,
    queryFn: ({ signal }) => obsApi.getTimeline(signal),
    refetchInterval: pollInterval,
  });
}

// ── Governance (polling) ─────────────────────────────────────────────────

export function usePendingProposals(pollInterval = 5000) {
  return useQuery({
    queryKey: queryKeys.pendingProposals,
    queryFn: ({ signal }) => govApi.listPending(signal),
    refetchInterval: pollInterval,
  });
}

export function useResolveProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      reason,
      user,
    }: {
      id: string;
      action: "approve" | "reject";
      reason: string;
      user: string;
    }) => govApi.resolveProposal(id, action, reason, user),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.pendingProposals });
    },
  });
}

// ── Usage ─────────────────────────────────────────────────────────────────

export function useUsageSummary(range: UsageRange) {
  return useQuery({
    queryKey: queryKeys.usageSummary(range),
    queryFn: ({ signal }) => usageApi.summary(range, signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useUsageDaily(range: UsageRange) {
  return useQuery({
    queryKey: queryKeys.usageDaily(range),
    queryFn: ({ signal }) => usageApi.daily(range, signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}