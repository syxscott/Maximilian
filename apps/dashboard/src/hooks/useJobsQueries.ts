// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Data hooks for the jobs domain (JobsPanel + AutomationsDomain share
 * them). Lives under `src/hooks/` because the arch-boundary test only
 * lets `api.ts` and `hooks/` touch the network — both settings domains
 * stay pure-render.
 *
 * Schemas are deliberately loose (passthrough + primitive checks):
 * shaping and defensiveness belong to each domain's model layer.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { BASE, authHeaders, fetchJson } from "../api"

const JOBS_PREFIX = "jobs" as const

// ── Shared fetch/mutation helpers ───────────────────────────────────────────

async function fetchJobsJson<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal) {
  return fetchJson(`${BASE}${path}`, { headers: authHeaders(), signal }, schema)
}

async function sendJobsJson<T>(
  path: string,
  method: "POST" | "DELETE",
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const parsed = (await res.json().catch(() => null)) as
    (Record<string, unknown> & { error?: string }) | null
  if (!res.ok) {
    throw new Error(
      typeof parsed?.error === "string"
        ? parsed.error
        : `request failed (${res.status} ${res.statusText})`,
    )
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`invalid response shape: ${result.error.issues[0]?.message ?? "unknown"}`)
  }
  return result.data
}

// ── List jobs (GET /jobs) ────────────────────────────────────────────────────

const JobRecordSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    schedule: z.string(),
    scheduleKind: z.string(),
    intervalMs: z.number().nullable().optional(),
    description: z.string().nullable().optional(),
    payload: z.unknown().optional(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
    lastTriggeredAt: z.string().nullable().optional(),
    nextRunAt: z.string().nullable().optional(),
    triggerCount: z.number().optional(),
    events: z.array(z.unknown()).optional(),
  })
  .passthrough()

export type JobRecord = z.infer<typeof JobRecordSchema>

const JobsListResponseSchema = z
  .object({ jobs: z.array(JobRecordSchema), total: z.number().optional() })
  .passthrough()

export type JobsListResponse = z.infer<typeof JobsListResponseSchema>

export function useJobs() {
  return useQuery<JobsListResponse>({
    queryKey: [JOBS_PREFIX, "list"],
    queryFn: ({ signal }) => fetchJobsJson("/jobs", JobsListResponseSchema, signal),
    staleTime: 5_000,
  })
}

// ── Create / delete / trigger mutations ─────────────────────────────────────

const CreatedJobResponseSchema = JobRecordSchema

export interface CreateJobInput {
  name: string
  schedule: string
  description?: string
  payload?: unknown
}

export function useCreateJob() {
  const qc = useQueryClient()
  return useMutation<JobRecord, Error, CreateJobInput>({
    mutationFn: (input) =>
      sendJobsJson("/jobs", "POST", CreatedJobResponseSchema, {
        name: input.name,
        schedule: input.schedule,
        ...(input.description ? { description: input.description } : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [JOBS_PREFIX, "list"] }),
  })
}

export function useDeleteJob() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      sendJobsJson(`/jobs/${encodeURIComponent(id)}`, "DELETE", z.unknown() as z.ZodType<void>),
    onSuccess: () => qc.invalidateQueries({ queryKey: [JOBS_PREFIX, "list"] }),
  })
}

const TriggerResponseSchema = z.object({ ok: z.boolean(), job: JobRecordSchema }).passthrough()

export type TriggerResponse = z.infer<typeof TriggerResponseSchema>

export function useTriggerJob() {
  const qc = useQueryClient()
  return useMutation<TriggerResponse, Error, string>({
    mutationFn: (id) =>
      sendJobsJson(`/jobs/${encodeURIComponent(id)}/trigger`, "POST", TriggerResponseSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: [JOBS_PREFIX, "list"] }),
  })
}

// ── Slot state (GET /jobs/{id}/slots) ───────────────────────────────────────

const JobSlotsResponseSchema = z
  .object({
    jobId: z.string(),
    hasPendingSlot: z.boolean(),
    slot: z
      .object({ scheduledAt: z.string(), at: z.string(), by: z.string() })
      .partial()
      .optional(),
  })
  .passthrough()

export type JobSlotsResponse = z.infer<typeof JobSlotsResponseSchema>

export function useJobSlots(jobId: string | null) {
  return useQuery<JobSlotsResponse>({
    queryKey: [JOBS_PREFIX, "slots", jobId],
    queryFn: ({ signal }) =>
      fetchJobsJson(
        `/jobs/${encodeURIComponent(String(jobId))}/slots`,
        JobSlotsResponseSchema,
        signal,
      ),
    enabled: Boolean(jobId),
    staleTime: 2_000,
  })
}
