/**
 * Dashboard API client — fetches from the Maximilian backend.
 * All calls go through Vite's dev proxy (/api → localhost:3001).
 * Responses are validated at runtime with Zod schemas.
 */

import { z } from "zod"

export const BASE = "/api"

// Auth token — read from localStorage if set via the UI, otherwise empty.
// In dev (no ADMIN_TOKEN on the backend) this is ignored.
export function authHeaders(): Record<string, string> {
  const token =
    typeof localStorage !== "undefined" ? localStorage.getItem("maximilian-admin-token") : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Fetch once, validate response body against a Zod schema. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    const detail = body ? `: ${body.slice(0, 200)}` : ""
    throw new Error(`${res.status} ${res.statusText}${detail}`)
  }
  const data = await res.json()
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    console.error("[api] schema validation failed:", parsed.error.issues)
    throw new Error(`invalid response shape: ${parsed.error.issues[0]?.message ?? "unknown"}`)
  }
  return parsed.data
}

// Re-export zod so feature modules can share the runtime schema.
export { z }

// ── Schemas ────────────────────────────────────────────────────────────────

const TeamGraphNodeSchema = z.object({
  id: z.string(),
  role: z.string(),
  displayName: z.string(),
  dependsOn: z.array(z.string()),
})

export const ExecutionTraceSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  taskId: z.string(),
  userPrompt: z.string(),
  assignedTeamGraph: z.object({
    id: z.string(),
    nodes: z.array(TeamGraphNodeSchema),
    capabilities: z.array(z.string()),
  }),
  steps: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
      agentRole: z.string(),
      taskId: z.string(),
      timestamp: z.string(),
    }),
  ),
  status: z.enum(["running", "completed", "failed"]),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
})
export type ExecutionTrace = z.infer<typeof ExecutionTraceSchema>

export const EvolutionTraceSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  proposalType: z.string(),
  subject: z.string(),
  simulatedScores: z.object({
    costDelta: z.number(),
    latencyDeltaMs: z.number(),
    qualityDelta: z.number(),
    riskDelta: z.number(),
    utility: z.number(),
  }),
  governanceVerdict: z.object({ allowed: z.boolean(), reason: z.string() }),
  rolloutStatus: z.string(),
  approved: z.boolean(),
  recordedAt: z.string(),
})
export type EvolutionTrace = z.infer<typeof EvolutionTraceSchema>

export const UIGraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      label: z.string(),
      model: z.string().optional(),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      type: z.string(),
    }),
  ),
})
export type UIGraph = z.infer<typeof UIGraphSchema>

/**
 * Flat timeline entry — the backend returns a flat list of evolution
 * events. The `EvolutionTree` component groups by `subject` (agent role)
 * to render a parent → children tree (e.g. birth → promote → retire).
 */
export const TimelineEntrySchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  proposalType: z.string().optional(),
  action: z.string(),
  subject: z.string(),
  approved: z.boolean(),
  utility: z.number().optional().default(0),
  recordedAt: z.string(),
  rolloutStatus: z.string(),
  /** Optional parent event id (when the backend can link it). */
  parentId: z.string().optional(),
})
export interface TimelineEntry {
  id: string
  proposalId: string
  proposalType?: string
  action: string
  subject: string
  approved: boolean
  /** Defaults to 0 when missing — see `TimelineEntrySchema`. */
  utility?: number
  recordedAt: string
  rolloutStatus: string
  parentId?: string
  /** Attached by `buildTimelineTree()`. Backend never returns this field. */
  children?: TimelineEntry[]
}

/**
 * Build a parent-children tree from a flat list of timeline entries.
 * Strategy: if entries have a `parentId` we honor that; otherwise we
 * group by `subject` and order chronologically so each event becomes a
 * child of the previous event on the same subject.
 */
export function buildTimelineTree(entries: TimelineEntry[]): TimelineEntry[] {
  if (entries.length === 0) return []
  const byId = new Map<string, TimelineEntry & { children: TimelineEntry[] }>()
  for (const e of entries) byId.set(e.id, { ...e, children: [] })

  const roots: Array<TimelineEntry & { children: TimelineEntry[] }> = []
  // Sort by recordedAt so chronological parent→child links fall out naturally.
  const sorted = [...entries].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))

  // Walk in chronological order, maintaining a per-subject "last seen" pointer.
  // O(n) total instead of O(n^2) per reverse-scan.
  const lastBySubject = new Map<string, TimelineEntry & { children: TimelineEntry[] }>()

  for (const e of sorted) {
    const node = byId.get(e.id)!
    if (e.parentId && byId.has(e.parentId)) {
      byId.get(e.parentId)!.children.push(node)
    } else {
      // No explicit parent — attach to the previous event for the same subject
      // (or to the root if this is the first one).
      const prev = lastBySubject.get(e.subject)
      if (prev) prev.children.push(node)
      else roots.push(node)
    }
    lastBySubject.set(e.subject, node)
  }
  return roots
}

export const PendingProposalSchema = z.object({
  proposalId: z.string(),
  proposal: z.object({
    id: z.string(),
    action: z.string(),
    subject: z.string(),
    target: z.string().optional(),
    rationale: z.string(),
    payload: z.record(z.unknown()),
    status: z.string(),
    source: z.string(),
    createdAt: z.string(),
  }),
  simulation: z.object({
    costDelta: z.number(),
    latencyDeltaMs: z.number(),
    qualityDelta: z.number(),
    riskDelta: z.number(),
    simulatedAt: z.string(),
  }),
  score: z.object({
    proposalId: z.string(),
    qualityGain: z.number(),
    latencyPenalty: z.number(),
    costPenalty: z.number(),
    riskPenalty: z.number(),
    utility: z.number(),
    approved: z.boolean(),
    reason: z.string(),
  }),
  status: z.string(),
  requestedAt: z.string(),
})
export type PendingProposal = z.infer<typeof PendingProposalSchema>

export const GovernanceConfigSchema = z.object({
  maxAgents: z.number(),
  maxCapabilities: z.number(),
  maxDepth: z.number(),
  requireReviewForBirth: z.boolean(),
  minUsageForBirth: z.number(),
  hitlRiskThreshold: z.number(),
  hitlAlwaysForActions: z.array(z.string()),
})
export type GovernanceConfig = z.infer<typeof GovernanceConfigSchema>

export const CapabilityRecordSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  status: z.string(),
  usageCount: z.number(),
  totalExecutions: z.number(),
  avgScore: z.number(),
  avgDurationMs: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type CapabilityRecord = z.infer<typeof CapabilityRecordSchema>

const HealthSchema = z.object({
  status: z.string(),
  providers: z.array(z.object({ id: z.string(), name: z.string() })),
  defaultProvider: z.string(),
  evolution: z.string(),
  dagsMode: z.string(),
  metaAgent: z.string(),
  telemetry: z.string(),
})
export type Health = z.infer<typeof HealthSchema>

// ── Observability API ─────────────────────────────────────────────────────

export const obsApi = {
  listExecutions: (signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/obs/executions`,
      { signal },
      z.object({ count: z.number(), executions: z.array(ExecutionTraceSchema) }),
    ),

  listEvolutions: (signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/obs/evolutions`,
      { signal },
      z.object({ count: z.number(), evolutions: z.array(EvolutionTraceSchema) }),
    ),

  getGraph: (executionId: string, signal?: AbortSignal) =>
    fetchJson(`${BASE}/obs/graph/${executionId}`, { signal }, UIGraphSchema),

  getTimeline: (signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/obs/timeline`,
      { signal },
      z.object({ timeline: z.array(TimelineEntrySchema) }),
    ),

  lineageByRole: (role: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/obs/lineage/agent/${encodeURIComponent(role)}`,
      { signal },
      z.object({
        role: z.string(),
        count: z.number(),
        lineage: z.array(EvolutionTraceSchema),
      }),
    ),
}

// ── Governance API ────────────────────────────────────────────────────────

export const govApi = {
  listPending: (signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/gov/pending`,
      { headers: authHeaders(), signal },
      z.object({ count: z.number(), proposals: z.array(PendingProposalSchema) }),
    ),

  resolveProposal: (
    id: string,
    action: "approve" | "reject",
    reason: string,
    user: string,
    signal?: AbortSignal,
  ) =>
    fetchJson(
      `${BASE}/gov/proposals/${encodeURIComponent(id)}/action`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ action, reason, user }),
        signal,
      },
      z.object({
        proposalId: z.string(),
        status: z.string(),
        resolvedBy: z.string(),
      }),
    ),
}

// ── Meta API ──────────────────────────────────────────────────────────────

export const metaApi = {
  listCapabilities: (signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/meta/capabilities`,
      { signal },
      z.object({ count: z.number(), capabilities: z.array(CapabilityRecordSchema) }),
    ),

  getGovernanceConfig: (signal?: AbortSignal) =>
    fetchJson(`${BASE}/meta/governance/config`, { signal }, GovernanceConfigSchema),

  updateGovernanceConfig: (config: Partial<GovernanceConfig>, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/meta/governance/config`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(config),
        signal,
      },
      z.object({ ok: z.boolean(), config: GovernanceConfigSchema }),
    ),

  health: (signal?: AbortSignal) => fetchJson(`${BASE}/health`, { signal }, HealthSchema),
}

// ── Workspace / Chat Schemas ─────────────────────────────────────────────

// Provider info — duplicated here so the lib/api hooks can re-use the
// Zod-validated chatApi.listProviders without depending on the legacy
// `lib/api/providers.ts` module.

// ── Provider Category & Model Variants (borrowed from cc-switch) ──────────

/** Provider category — mirrors cc-switch's ProviderCategory type. */
export const ProviderCategorySchema = z.enum([
  "official",      // First-party LLM vendor (Anthropic, OpenAI, Google)
  "china",         // Chinese 1P vendor (DeepSeek, Zhipu, Kimi, ...)
  "international", // Non-Chinese 1P vendor (Mistral, Cohere, Groq, ...)
  "aggregator",    // Routing / aggregation service (OpenRouter, PackyCode, ...)
  "cloud",         // Cloud-hosted proxy (AWS Bedrock, Azure OpenAI)
  "custom",        // User-defined custom endpoint / local inference
])
export type ProviderCategory = z.infer<typeof ProviderCategorySchema>

/** Model variant metadata — mirrors cc-switch's PresetModelVariant. */
export const ModelVariantSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  contextLimit: z.number().int().positive().optional(),  // max context tokens
  outputLimit: z.number().int().positive().optional(),   // max output tokens
  modalities: z.object({
    input: z.array(z.string()),
    output: z.array(z.string()),
  }).optional(),
  options: z.record(z.unknown()).optional(),
})
export type ModelVariant = z.infer<typeof ModelVariantSchema>

/** Provider metadata (not written to live config, only in ~/.cc-switch style config). */
export const ProviderMetaSchema = z.object({
  websiteUrl: z.string().optional(),
  apiKeyUrl: z.string().optional(),
  isPartner: z.boolean().optional(),
  primePartner: z.boolean().optional(),
})
export type ProviderMeta = z.infer<typeof ProviderMetaSchema>

/** Health status of a provider. */
export const ProviderHealthSchema = z.object({
  status: z.enum(["healthy", "degraded", "down", "unknown"]),
  latencyMs: z.number().nonnegative().optional(),
  errorMessage: z.string().optional(),
  lastCheckedAt: z.number().int().positive().optional(), // Unix ms
})
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>

/** Provider info — enhanced with cc-switch features. */
export const ProviderInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  defaultModel: z.string(),
  configured: z.boolean(),
  /** Provider category for UI differentiation and capability gating. */
  category: ProviderCategorySchema.optional(),
  /** Sort index for drag-to-reorder (higher = lower position). */
  sortIndex: z.number().int().optional(),
  /** Provider metadata (homepage, partner info). */
  meta: ProviderMetaSchema.optional(),
  /** Model variants with metadata (context limit, output limit, modalities). */
  modelVariants: z.array(ModelVariantSchema).optional(),
  /** Current health status (polled every 5s by the dashboard). */
  health: ProviderHealthSchema.optional(),
  /** Whether this provider is in the failover queue. */
  inFailoverQueue: z.boolean().optional(),
  /** Failover priority (1 = P1, 2 = P2, ...). Lower number = higher priority. */
  failoverPriority: z.number().int().positive().optional(),
  /** Whether auto-failover is enabled for this app. */
  autoFailoverEnabled: z.boolean().optional(),
  /** Icon name (e.g. "openai", "anthropic"). */
  icon: z.string().optional(),
  /** Icon color in hex format (e.g. "#00A67E"). */
  iconColor: z.string().optional(),
  /** Notes set by the user. */
  notes: z.string().optional(),
})
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>

export const ProviderListResponseSchema = z.object({
  providers: z.array(ProviderInfoSchema),
  default: z.string().optional(),
})
export type ProviderListResponse = z.infer<typeof ProviderListResponseSchema>

// ── Usage Aggregation Schemas ─────────────────────────────────────────────

export const UsageRangeSchema = z.enum(["today", "1d", "7d", "14d", "30d", "all"])
export type UsageRange = z.infer<typeof UsageRangeSchema>

export const LatencyStatsSchema = z.object({
  p50Ms: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  p99Ms: z.number().nonnegative(),
  avgMs: z.number().nonnegative(),
  sampleCount: z.number().int().nonnegative(),
})
export type LatencyStats = z.infer<typeof LatencyStatsSchema>

/** Per-provider usage breakdown (mirrors token-monitor's per-provider aggregation). */
export const ProviderBreakdownSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  totalRequests: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCacheReadTokens: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  successRate: z.number().min(0).max(1),
  cacheHitRate: z.number().min(0).max(1),
})
export type ProviderBreakdown = z.infer<typeof ProviderBreakdownSchema>

export const UsageSummarySchema = z.object({
  range: UsageRangeSchema,
  totalRequests: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCacheReadTokens: z.number().int().nonnegative(),
  totalCacheCreationTokens: z.number().int().nonnegative(),
  realTotalTokens: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  successRate: z.number().min(0).max(1),
  cacheHitRate: z.number().min(0).max(1),
  unpricedRequestCount: z.number().int().nonnegative(),
  latency: LatencyStatsSchema,
  /** Per-provider breakdown (mirrors token-monitor's provider aggregation). */
  byProvider: z.array(ProviderBreakdownSchema).optional(),
})
export type UsageSummary = z.infer<typeof UsageSummarySchema>

export const DailyUsageEntrySchema = z.object({
  date: z.string(),
  requestCount: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCacheReadTokens: z.number().int().nonnegative(),
  totalCacheCreationTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
})
export type DailyUsageEntry = z.infer<typeof DailyUsageEntrySchema>

export const UsageDailyResponseSchema = z.object({
  range: UsageRangeSchema,
  daily: z.array(DailyUsageEntrySchema),
})
export type UsageDailyResponse = z.infer<typeof UsageDailyResponseSchema>

const PlanTaskSchema = z.object({
  id: z.string(),
  agentRole: z.string(),
  description: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  dependsOn: z.array(z.string()),
  resultId: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
})

const PlanSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  userRequest: z.string(),
  rationale: z.string(),
  tasks: z.array(PlanTaskSchema),
  createdAt: z.string(),
})

const ResultSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agentRole: z.string(),
  agentId: z.string(),
  output: z.string(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
})

const ReviewResultSchema = z.object({
  id: z.string(),
  score: z.number(),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
  summary: z.string(),
  reviewedAt: z.string(),
})

export const WorkspaceSchema = z.object({
  id: z.string(),
  userRequest: z.string(),
  // Must match backend apps/api/src/schemas.ts: "pending" (just-created),
  // "planning" (runtime building the plan), "running" (executing),
  // "completed", "failed".
  status: z.enum(["pending", "planning", "running", "completed", "failed"]),
  plan: PlanSchema.optional(),
  results: z.array(ResultSchema),
  review: ReviewResultSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().optional(),
})
export type Workspace = z.infer<typeof WorkspaceSchema>

export const RuntimeEventSchema = z
  .object({
    type: z.string(),
    workspaceId: z.string(),
  })
  .passthrough()
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>

// ── Chat / Workspace API ─────────────────────────────────────────────────

export const chatApi = {
  chat: (message: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ message }),
        signal,
      },
      z.object({ workspaceId: z.string(), planId: z.string(), status: z.string() }),
    ),

  getWorkspace: (id: string, signal?: AbortSignal) =>
    fetchJson(`${BASE}/workspaces/${encodeURIComponent(id)}`, { signal }, WorkspaceSchema),

  listArtifacts: (id: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/workspaces/${encodeURIComponent(id)}/artifacts`,
      { signal },
      z.object({
        workspaceId: z.string(),
        artifacts: z.array(z.string()),
      }),
    ),

  readArtifact: async (workspaceId: string, name: string): Promise<string> => {
    const res = await fetch(
      `${BASE}/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(name)}`,
    )
    if (!res.ok) throw new Error(`Artifact not found: ${name}`)
    return res.text()
  },

  getEvents: (id: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/workspaces/${encodeURIComponent(id)}/events`,
      { signal },
      z.object({
        workspaceId: z.string(),
        events: z.array(RuntimeEventSchema),
      }),
    ),

  listProviders: (signal?: AbortSignal) =>
    fetchJson(`${BASE}/providers`, { signal }, ProviderListResponseSchema),

  setDefaultProvider: (providerId: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/system/providers/default`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ providerId }),
        signal,
      },
      z.object({ ok: z.boolean(), providerId: z.string() }),
    ),

  setProviderModel: (providerId: string, model: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/system/providers/${encodeURIComponent(providerId)}/model`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ model }),
        signal,
      },
      z.object({ ok: z.boolean(), providerId: z.string(), model: z.string() }),
    ),

  // ── Failover & Health (borrowed from cc-switch) ──────────────────────────

  /** Get health status for a provider. */
  getProviderHealth: (providerId: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/system/providers/${encodeURIComponent(providerId)}/health`,
      { signal },
      ProviderHealthSchema,
    ),

  /** Get the current failover queue for an app. */
  getFailoverQueue: (signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/system/failover/queue`,
      { signal },
      z.object({
        queue: z.array(z.object({
          providerId: z.string(),
          priority: z.number().int().positive(),
          addedAt: z.number().int().positive(),
        })),
      }),
    ),

  /** Add a provider to the failover queue. */
  addToFailoverQueue: (providerId: string, priority?: number, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/system/failover/queue/add`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ providerId, priority }),
        signal,
      },
      z.object({ ok: z.boolean(), providerId: z.string() }),
    ),

  /** Remove a provider from the failover queue. */
  removeFromFailoverQueue: (providerId: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/system/failover/queue/remove`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ providerId }),
        signal,
      },
      z.object({ ok: z.boolean(), providerId: z.string() }),
    ),

  /** Get auto-failover enabled state. */
  getAutoFailoverEnabled: (signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/system/failover/auto`,
      { signal },
      z.object({ enabled: z.boolean() }),
    ),

  /** Set auto-failover enabled state. */
  setAutoFailoverEnabled: (enabled: boolean, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/system/failover/auto`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ enabled }),
        signal,
      },
      z.object({ ok: z.boolean(), enabled: z.boolean() }),
    ),

  /** Reset circuit breaker for a provider (triggers health check + possible auto-recovery). */
  resetCircuitBreaker: (providerId: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/system/providers/${encodeURIComponent(providerId)}/circuit-breaker/reset`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        signal,
      },
      z.object({ ok: z.boolean(), providerId: z.string() }),
    ),

  /** Get circuit breaker stats for a provider. */
  getCircuitBreakerStats: (providerId: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/system/providers/${encodeURIComponent(providerId)}/circuit-breaker/stats`,
      { signal },
      z.object({
        state: z.enum(["closed", "open", "half-open"]),
        failures: z.number().int().nonnegative(),
        lastFailureAt: z.number().int().positive().optional(),
        probeInFlight: z.boolean().optional(),
      }),
    ),

  // ── Usage Query ──────────────────────────────────────────────────────────

  /** Query usage for the current tenant (or all if admin). */
  queryUsage: (range: UsageRange, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/usage?range=${range}`,
      { signal },
      UsageSummarySchema,
    ),
}

// ── Usage API ──────────────────────────────────────────────────────────────

export const usageApi = {
  summary: (range: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/obs/usage/summary?range=${encodeURIComponent(range)}`,
      { signal },
      UsageSummarySchema,
    ),

  daily: (range: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/obs/usage/daily?range=${encodeURIComponent(range)}`,
      { signal },
      UsageDailyResponseSchema,
    ),
}
