// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Data hooks for the settings center's deep management domains
 * (providers catalog / model tester / subagents / usage charts /
 * session-store status). This file lives under `src/hooks/` because the
 * arch-boundary test only lets `api.ts` and `hooks/` touch the network —
 * the settings domains themselves stay pure-render.
 *
 * Schemas here are deliberately loose (passthrough + primitive checks):
 * shaping and defensiveness belong to each domain's model layer, which is
 * what the unit tests exercise.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { BASE, authHeaders, fetchJson, usageApi } from "../api"

const SETTINGS_DEEP_PREFIX = "settings-deep" as const

/** Stable query keys, exported so domains can invalidate after mutations. */
export const SUBAGENTS_QUERY_KEY = [SETTINGS_DEEP_PREFIX, "subagents"] as const
export const MIGRATIONS_QUERY_KEY = [SETTINGS_DEEP_PREFIX, "migrations"] as const

// ── Provider presets catalog (GET /system/provider-presets) ────────────────

export const ProviderPresetSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
    apiFormat: z.string(),
    defaultModel: z.string(),
    baseUrl: z.string(),
    /** Env var NAME only — the key value itself never crosses the wire. */
    envKey: z.string(),
    envModel: z.string().nullable().optional(),
    configured: z.boolean(),
    isOfficial: z.boolean().optional(),
    isPartner: z.boolean().optional(),
  })
  .passthrough()

export type ProviderPresetSummary = z.infer<typeof ProviderPresetSummarySchema>

const ProviderPresetsResponseSchema = z
  .object({
    presets: z.array(ProviderPresetSummarySchema),
    total: z.number(),
  })
  .passthrough()

export type ProviderPresetsResponse = z.infer<typeof ProviderPresetsResponseSchema>

async function fetchSettingsDeepJson<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  // `fetchJson` from api.ts is the arch-mandated chokepoint (headers, base
  // URL, error shaping); hooks/ is an arch-allowed network zone.
  return fetchJson(`${BASE}${path}`, { headers: authHeaders(), signal }, schema)
}

export function useProviderPresets() {
  return useQuery<ProviderPresetsResponse>({
    queryKey: [SETTINGS_DEEP_PREFIX, "provider-presets"],
    queryFn: ({ signal }) =>
      fetchSettingsDeepJson("/system/provider-presets", ProviderPresetsResponseSchema, signal),
    staleTime: 60_000,
  })
}

// ── Model connectivity probe (POST /system/providers/{id}/test-chat) ───────

const TestChatResponseSchema = z
  .object({
    ok: z.literal(true),
    providerId: z.string(),
    model: z.string(),
    content: z.string(),
    durationMs: z.number(),
    usage: z
      .object({
        promptTokens: z.number(),
        completionTokens: z.number(),
        totalTokens: z.number(),
      })
      .optional(),
  })
  .passthrough()

export type TestChatResponse = z.infer<typeof TestChatResponseSchema>

export interface TestChatInput {
  providerId: string
  prompt: string
  model?: string
}

export function useProviderTestChat() {
  return useMutation<TestChatResponse, Error, TestChatInput>({
    mutationFn: async (input) => {
      const res = await fetch(
        `${BASE}/system/providers/${encodeURIComponent(input.providerId)}/test-chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ prompt: input.prompt, model: input.model }),
        },
      )
      const body = (await res.json().catch(() => null)) as
        (Record<string, unknown> & { error?: string }) | null
      if (!res.ok) {
        throw new Error(body?.error ?? `test chat failed (${res.status} ${res.statusText})`)
      }
      return TestChatResponseSchema.parse(body)
    },
  })
}

// ── Subagent profiles (existing GET /evolution/agents) ─────────────────────

const AgentProfilesResponseSchema = z
  .object({
    profiles: z.array(z.unknown()),
    nextCursor: z.unknown().optional(),
    total: z.number().optional(),
  })
  .passthrough()

export type AgentProfilesResponse = z.infer<typeof AgentProfilesResponseSchema>

export function useSubagentProfiles() {
  return useQuery<AgentProfilesResponse>({
    queryKey: SUBAGENTS_QUERY_KEY,
    queryFn: ({ signal }) =>
      fetchSettingsDeepJson("/evolution/agents?limit=100", AgentProfilesResponseSchema, signal),
    staleTime: 30_000,
  })
}

// ── Role memory import (POST /evolution/agents/{role}/memory-import) ────────

/** One normalized memory entry as the import route accepts it. */
export interface MemoryImportEntry {
  content: string
  mime: string
  metadata?: Record<string, unknown>
}

export interface MemoryImportInput {
  role: string
  buckets: Record<string, MemoryImportEntry[]>
  efficacy?: unknown
  archived?: unknown
}

const MemoryImportResponseSchema = z
  .object({
    ok: z.literal(true),
    role: z.string(),
    imported: z.record(z.string(), z.number()),
    totalEntries: z.number(),
  })
  .passthrough()

export type MemoryImportResponse = z.infer<typeof MemoryImportResponseSchema>

export function useMemoryImport() {
  const queryClient = useQueryClient()
  return useMutation<MemoryImportResponse, Error, MemoryImportInput>({
    mutationFn: async (input) => {
      const res = await fetch(
        `${BASE}/evolution/agents/${encodeURIComponent(input.role)}/memory-import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            buckets: input.buckets,
            ...(input.efficacy !== undefined ? { efficacy: input.efficacy } : {}),
            ...(input.archived !== undefined ? { archived: input.archived } : {}),
          }),
        },
      )
      const body = (await res.json().catch(() => null)) as
        (Record<string, unknown> & { error?: string }) | null
      if (!res.ok) {
        throw new Error(body?.error ?? `memory import failed (${res.status} ${res.statusText})`)
      }
      return MemoryImportResponseSchema.parse(body)
    },
    onSuccess: () => {
      // The viewer reads GET /evolution/agents — refresh it after a write.
      void queryClient.invalidateQueries({ queryKey: SUBAGENTS_QUERY_KEY })
    },
  })
}

// ── Usage charts (existing GET /obs/usage/*) ───────────────────────────────

export type UsageRange = "7d" | "30d"

export function useUsageSummary(range: UsageRange) {
  return useQuery({
    queryKey: [SETTINGS_DEEP_PREFIX, "usage-summary", range],
    queryFn: ({ signal }) => usageApi.summary(range, signal),
    staleTime: 30_000,
  })
}

export function useUsageDaily(range: UsageRange) {
  return useQuery({
    queryKey: [SETTINGS_DEEP_PREFIX, "usage-daily", range],
    queryFn: ({ signal }) => usageApi.daily(range, signal),
    staleTime: 30_000,
  })
}

export function useUsageWindows() {
  return useQuery({
    queryKey: [SETTINGS_DEEP_PREFIX, "usage-windows"],
    queryFn: ({ signal }) => usageApi.windows(signal),
    staleTime: 30_000,
  })
}

// ── Session store status (GET /system/session-store) ───────────────────────

const SessionStoreStatusSchema = z
  .object({
    available: z.boolean(),
    schemaVersion: z.number().nullable(),
    path: z.string().nullable(),
    tables: z.record(z.string(), z.number().nullable()),
  })
  .passthrough()

export type SessionStoreStatus = z.infer<typeof SessionStoreStatusSchema>

export function useSessionStoreStatus() {
  return useQuery<SessionStoreStatus>({
    queryKey: [SETTINGS_DEEP_PREFIX, "session-store"],
    queryFn: ({ signal }) =>
      fetchSettingsDeepJson("/system/session-store", SessionStoreStatusSchema, signal),
    staleTime: 15_000,
  })
}

// ── Migration candidates (GET /system/migrations) ──────────────────────────

const MigrationsStatusSchema = z
  .object({
    api: z
      .object({
        openapiRoutes: z.number().nullable(),
      })
      .passthrough(),
    sessionStore: z
      .object({
        available: z.boolean(),
        schemaVersion: z.number().nullable(),
        tables: z.record(z.string(), z.number().nullable()),
      })
      .passthrough(),
    i18n: z
      .object({
        locales: z.number().nullable(),
        coreKeys: z.number().nullable(),
      })
      .passthrough(),
  })
  .passthrough()

export type MigrationsStatus = z.infer<typeof MigrationsStatusSchema>

export function useMigrationCandidates() {
  return useQuery<MigrationsStatus>({
    queryKey: MIGRATIONS_QUERY_KEY,
    queryFn: ({ signal }) =>
      fetchSettingsDeepJson("/system/migrations", MigrationsStatusSchema, signal),
    staleTime: 60_000,
  })
}
