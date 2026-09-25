/**
 * Maximilian API client for the TUI.
 *
 * Mirrors the dashboard's `apps/dashboard/src/api.ts` contract but uses plain
 * TS types (the API server already validates with Zod; the TUI doesn't need a
 * second runtime check). Covers the endpoints the Home route needs:
 *   GET  /api/health
 *   GET  /api/obs/executions
 *   GET  /api/gov/pending
 *   GET  /api/obs/usage/summary?range=...
 *   POST /api/chat
 * plus the jobs / workspaces endpoints the Jobs / Goals / Usage panels need:
 *   GET    /api/jobs
 *   DELETE /api/jobs/{id}
 *   POST   /api/jobs/{id}/trigger
 *   GET    /api/workspaces
 *   GET    /api/workspaces/{id}
 *
 * Auth: optional bearer token (ADMIN_TOKEN / JWT) injected into every request.
 */

export interface Health {
  status: string
  providers: Array<{ id: string; name: string }>
  defaultProvider: string
  evolution: string
  dagsMode: string
  metaAgent: string
  telemetry: string
}

export interface ExecutionStep {
  role: string
  content: string
  agentRole: string
  taskId: string
  timestamp: string
}

export interface ExecutionTrace {
  id: string
  workspaceId: string
  taskId: string
  userPrompt: string
  steps: ExecutionStep[]
  status: "running" | "completed" | "failed"
  startedAt: string
  completedAt?: string
  error?: string
}

export interface PendingProposal {
  proposalId: string
  status: string
  requestedAt: string
  proposal: {
    id: string
    action: string
    subject: string
    rationale: string
    status: string
    source: string
    createdAt: string
  }
  simulation: {
    costDelta: number
    latencyDeltaMs: number
    qualityDelta: number
    riskDelta: number
  }
  score: {
    utility: number
    approved: boolean
    reason: string
  }
}

export type UsageRange = "today" | "1d" | "7d" | "14d" | "30d" | "all"

export interface LatencyStats {
  p50Ms: number
  p95Ms: number
  p99Ms: number
  avgMs: number
  sampleCount: number
}

export interface UsageSummary {
  range: UsageRange
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  realTotalTokens: number
  totalCostUsd: number
  /** False when any request in the window lacked pricing (total is partial). */
  totalCostUsdKnown?: boolean
  successRate: number
  cacheHitRate: number
  unpricedRequestCount: number
  latency: LatencyStats
}

export interface ChatResponse {
  workspaceId: string
  planId: string
  status: string
}

// ── Jobs (GET /api/jobs, DELETE /api/jobs/{id}, POST /api/jobs/{id}/trigger) ──

/** One append-only trigger/dispatch trail entry on a job. */
export interface JobEvent {
  at: string
  kind: string
  note?: string
  /** "dispatched" entries: the BullMQ job id when the enqueue succeeded. */
  workspaceJobId?: string | null
  /** "dispatched" entries: false when degraded (queue unavailable). */
  queued?: boolean
  /** "dispatch-failed" entries: the BullMQ add() error message. */
  error?: string
  /** "materialized" entries: the real workspace the worker ran. */
  workspaceId?: string
  /** "materialized" entries: workspace status at backfill time. */
  status?: string
}

/** Mirrors the API's JobSchema (apps/api/src/routes/jobs.ts). */
export interface Job {
  id: string
  name: string
  /** Raw schedule string as provided (cron expression or intervalMs digits). */
  schedule: string
  scheduleKind: "cron" | "interval"
  intervalMs: number | null
  description: string | null
  /** { kind: "workspace", message } | { kind: "none" } | legacy record-only. */
  payload?: unknown
  createdAt: string
  updatedAt: string
  lastTriggeredAt: string | null
  nextRunAt: string | null
  triggerCount: number
  events: JobEvent[]
}

export interface JobListResponse {
  jobs: Job[]
  total: number
}

export interface JobTriggerResponse {
  ok: boolean
  job: Job
}

// ── Workspaces (GET /api/workspaces, GET /api/workspaces/{id}) ──────────────

export interface WorkspaceListResponse {
  items: string[]
  nextCursor?: string
  total: number
}

/**
 * Passthrough workspace object — the Goals panel derives its tree from it
 * (same contract as the dashboard's features/goals model: userRequest,
 * status, plan.tasks, results, review.score). Kept `unknown` on purpose;
 * the model layer does the defensive reading.
 */
export type WorkspacePayload = unknown

export interface MaximilianClient {
  health(signal?: AbortSignal): Promise<Health>
  listExecutions(signal?: AbortSignal): Promise<{ count: number; executions: ExecutionTrace[] }>
  listPendingProposals(
    signal?: AbortSignal,
  ): Promise<{ count: number; proposals: PendingProposal[] }>
  getUsageSummary(range: UsageRange, signal?: AbortSignal): Promise<UsageSummary>
  chat(message: string, signal?: AbortSignal): Promise<ChatResponse>
  listJobs(signal?: AbortSignal): Promise<JobListResponse>
  deleteJob(id: string, signal?: AbortSignal): Promise<void>
  triggerJob(id: string, signal?: AbortSignal): Promise<JobTriggerResponse>
  listWorkspaces(signal?: AbortSignal): Promise<WorkspaceListResponse>
  getWorkspace(id: string, signal?: AbortSignal): Promise<WorkspacePayload>
}

export function createMaximilianClient(baseUrl: string, token?: string): MaximilianClient {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (token) headers["authorization"] = `Bearer ${token}`

  async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const url = new URL(path, baseUrl).toString()
    const res = await fetch(url, { method: "GET", headers, signal })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`)
    }
    return (await res.json()) as T
  }

  async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const url = new URL(path, baseUrl).toString()
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`)
    }
    return (await res.json()) as T
  }

  /** DELETE with no response body (204) — must not res.json() an empty stream. */
  async function deleteJson(path: string, signal?: AbortSignal): Promise<void> {
    const url = new URL(path, baseUrl).toString()
    const res = await fetch(url, { method: "DELETE", headers, signal })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`)
    }
  }

  return {
    health: (signal) => getJson<Health>("/api/health", signal),
    listExecutions: (signal) =>
      getJson<{ count: number; executions: ExecutionTrace[] }>("/api/obs/executions", signal),
    listPendingProposals: (signal) =>
      getJson<{ count: number; proposals: PendingProposal[] }>("/api/gov/pending", signal),
    getUsageSummary: (range, signal) =>
      getJson<UsageSummary>(`/api/obs/usage/summary?range=${encodeURIComponent(range)}`, signal),
    chat: (message, signal) => postJson<ChatResponse>("/api/chat", { message }, signal),
    listJobs: (signal) => getJson<JobListResponse>("/api/jobs", signal),
    deleteJob: (id, signal) => deleteJson(`/api/jobs/${encodeURIComponent(id)}`, signal),
    triggerJob: (id, signal) =>
      postJson<JobTriggerResponse>(
        `/api/jobs/${encodeURIComponent(id)}/trigger`,
        undefined,
        signal,
      ),
    listWorkspaces: (signal) => getJson<WorkspaceListResponse>("/api/workspaces?limit=20", signal),
    getWorkspace: (id, signal) =>
      getJson<WorkspacePayload>(`/api/workspaces/${encodeURIComponent(id)}`, signal),
  }
}
