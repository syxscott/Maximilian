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

export interface MaximilianClient {
  health(signal?: AbortSignal): Promise<Health>
  listExecutions(signal?: AbortSignal): Promise<{ count: number; executions: ExecutionTrace[] }>
  listPendingProposals(signal?: AbortSignal): Promise<{ count: number; proposals: PendingProposal[] }>
  getUsageSummary(range: UsageRange, signal?: AbortSignal): Promise<UsageSummary>
  chat(message: string, signal?: AbortSignal): Promise<ChatResponse>
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

  return {
    health: (signal) => getJson<Health>("/api/health", signal),
    listExecutions: (signal) => getJson<{ count: number; executions: ExecutionTrace[] }>("/api/obs/executions", signal),
    listPendingProposals: (signal) => getJson<{ count: number; proposals: PendingProposal[] }>("/api/gov/pending", signal),
    getUsageSummary: (range, signal) => getJson<UsageSummary>(`/api/obs/usage/summary?range=${encodeURIComponent(range)}`, signal),
    chat: (message, signal) => postJson<ChatResponse>("/api/chat", { message }, signal),
  }
}
