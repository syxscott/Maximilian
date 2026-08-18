// @ts-nocheck
/**
 * Maximilian API Server (Hono).
 *
 * Endpoints:
 *   POST  /api/chat              Submit a user request, start execution.
 *   GET   /api/workspaces        List workspace ids.
 *   GET   /api/workspaces/:id    Load a workspace (plan + results + review).
 *   GET   /api/workspaces/:id/artifacts   List generated artifact files.
 *   GET   /api/workspaces/:id/artifacts/:name  Read an artifact.
 *   GET   /api/providers         List configured providers.
 *   GET   /api/health            Health check.
 *   GET   /api/evolution/*       Agent Evolution Engine surfaces.
 *   GET   /api/learning/*        Phase 5 Learning Dashboard.
 *   GET   /api/executions/*      Phase 5 Execution History.
 *
 * DAGS_MODE=true routes /api/chat through the DAGS pipeline and
 * runs the Phase 5 closed loop (observe → plan → candidate → promote).
 *
 * META_AGENT_ENABLED=true boots the Phase 6 meta-system:
 *   capability discovery, agent birth/retirement, team optimization,
 *   organization memory, governance enforcement.
 *   See /api/meta/* endpoints.
 */

import { Hono, type Context } from "hono"
import { OpenAPIHono } from "@hono/zod-openapi"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { serve } from "@hono/node-server"
import { getConfig, createFeatureFlags } from "@max/config"
import {
  getLogger,
  initOtel,
  withSpan,
  collectMetrics,
  metricsContentType,
  httpRequestTotal,
  httpRequestDuration,
  taskDuration,
  taskTotal,
  activeTasks,
  llmTokensTotal,
} from "@max/telemetry"

const log = getLogger("api")

import { getRegistry, type Provider } from "@max/providers"
import { AgentRuntime, type RuntimeSink, type RuntimeEvent, type ModelRouter } from "@max/core"
import { Commander } from "@max/commander"
import { FileWorkspaceStore } from "@max/workspace"
import { defaultAgentFactory } from "@max/agents"
import { EvolutionFacade, evolutionAwareFactory } from "@max/evolution"
import { DAGS, BlueprintStore } from "@max/dags"
import {
  ExecutionStore,
  InsightsStore,
  FailurePatternAnalyzer,
  EvolutionPlanner,
  CandidateGenerator,
  PromotionEngine,
  LearningAPI,
  AutonomyOrchestrator,
} from "@max/autonomy"
import {
  CapabilityRegistry,
  CapabilityDiscoveryEngine,
  AgentBirthEngine,
  AgentRetirementEngine,
  MetaAgent,
  TeamOptimizer,
  OrganizationMemory,
  SimulationEngine,
  GovernanceEngine,
  MetaOrchestrator,
  applyHintToBlueprints,
  DigitalTwin,
  ProposalPipeline,
  SafeRollout,
  PendingProposalStore,
  VisualizerAdapter,
  TruthAudit,
  type DiscoverySignal,
} from "@max/meta-system"
import { postChat, postChatRoute } from "./routes/chat.js"
import {
  getWorkspace,
  listWorkspaces,
  listArtifacts,
  getArtifact,
  getWorkspaceEvents,
  getWorkspaceRoute,
  listWorkspacesRoute,
  getWorkspaceEventsRoute,
  listArtifactsRoute,
  getArtifactRoute,
  streamWorkspaceRoute,
} from "./routes/workspace.js"
import { listProviders } from "./routes/providers.js"
import {
  listProvidersRoute,
  healthRoute,
  readyRoute,
  setDefaultProviderRoute,
  setProviderModelRoute,
  providerHealthRoute,
  circuitBreakerStatsRoute,
  circuitBreakerResetRoute,
  failoverQueueRoute,
  failoverQueueAddRoute,
  failoverQueueRemoveRoute,
  autoFailoverRoute,
  setAutoFailoverRoute,
} from "./routes/system.js"
import {
  SseReplayBuffer,
  parseLastEventId,
  encodeSseFrame,
  type SseEvent,
} from "./lib/sse-replay.js"
import {
  evolutionRoutes,
  listMetricsRoute,
  getMetricRoute,
  listAgentsRoute,
  getAgentRoute,
  leaderboardRoute,
  leaderboardForRoleRoute,
  listVersionsRoute,
  listDecisionsRoute,
  recordFeedbackRoute,
  triggerEvolveRoute,
} from "./routes/evolution.js"
import {
  learningRoutes,
  learningStatusRoute,
  learningAgentsRoute,
  learningEvolutionHistoryRoute,
  learningFailurePatternsRoute,
  learningMineFailurePatternsRoute,
} from "./routes/learning.js"
import {
  executionRoutes,
  listExecutionsRoute,
  getExecutionRoute,
  listExecutionsForWorkspaceRoute,
  listExecutionsForRoleRoute,
  appendExecutionFeedbackRoute,
} from "./routes/executions.js"
import {
  metaRoutes,
  listCapabilitiesRoute,
  getCapabilityRoute,
  listProposalsRoute,
  runCycleRoute,
  listEventsRoute,
  countEventsRoute,
  checkGovernanceRoute,
  simulateRoute,
  compareSimulationsRoute,
  getGovernanceConfigRoute,
  putGovernanceConfigRoute,
} from "./routes/meta.js"
import { TelemetryCollector } from "@max/telemetry"
import {
  obsRoutes,
  listObsExecutionsRoute,
  listObsEvolutionsRoute,
  lineageByRoleRoute,
  obsGraphRoute,
  obsTimelineRoute,
} from "./routes/obs.js"
import {
  usageRoutes,
  usageSummaryRoute,
  usageDailyRoute,
  usageLatencyRoute,
} from "./routes/usage.js"
import { govRoutes, listPendingProposalsRoute, resolveProposalRoute } from "./routes/gov.js"
import {
  permissionsRoutes,
  getPermissionsRoute,
  putPermissionsRoute,
  resolvePermissionRoute,
  testPermissionRoute,
  resetPermissionsRoute,
  answerPermissionRoute,
  auditPermissionsRoute,
} from "./routes/permissions.js"
import { approvalRoutes, answerApprovalRoute, type ApprovalAnswerPort } from "./routes/approvals.js"
import {
  createDb,
  closeDb,
  PgWorkspaceStore,
  PgExecutionStore,
  PgProfileStore,
  PgEvolutionStore,
  PgInsightsStore,
  PgBlueprintStore,
  PgCapabilityStore,
  PgGovernanceConfigStore,
  PgPendingProposalStore,
  PgTelemetryStore,
  PgGovernanceEngine,
  PgOrgMemory,
  PgTruthStore,
} from "@max/database"
import { sql } from "drizzle-orm"
import { authMiddleware, requireRole } from "./auth/middleware.js"
import { runReadinessChecks } from "./lib/readiness.js"
import { bootstrapModelRouting } from "@max/core"
import {
  authRoutes,
  authRegisterRoute,
  authLoginRoute,
  authRefreshRoute,
  authLogoutRoute,
} from "./routes/auth.js"
import {
  tenantRoutes,
  tenantCreateRoute,
  tenantListRoute,
  tenantGetRoute,
  tenantUpdateRoute,
  tenantDeleteRoute,
} from "./routes/tenants.js"
import { rateLimiter } from "hono-rate-limiter"
import { securityHeaders } from "./middleware/security-headers.js"
import { createQueue } from "@max/queue"
import { swaggerUI } from "@hono/swagger-ui"
import { FileMemoryStore } from "@max/core"
import type { AgentMemoryStorePort, ModelSelectorPort } from "@max/core"
import type { ModelSelectorPort as CommanderModelSelectorPort } from "@max/commander"
import {
  JsonlEventLog,
  EventLogRegistry,
  type LoggedEvent,
} from "./event-log.js"
import {
  createSseHandler,
  createEventBus,
  createSseReplaySubsystem,
  type EventBus,
} from "./sse-replay.js"

// Re-export so external consumers (tests, future workers) can use the
// durable replay log without re-implementing the JSONL mutex dance.
export { JsonlEventLog, EventLogRegistry }
export { createSseHandler, createEventBus }
export type { LoggedEvent }

type AppEnv = { Variables: { requestId: string; userId?: string; userRole?: string } }
const config = getConfig()

// Fail fast: production must have a JWT secret. Otherwise the auth middleware
// silently no-ops and every protected endpoint is open to the world.
if (config.NODE_ENV === "production" && !config.JWT_SECRET && !config.ADMIN_TOKEN) {
  log.fatal("NODE_ENV=production requires JWT_SECRET or ADMIN_TOKEN — refusing to start")
  process.exit(1)
}
if (!config.JWT_SECRET) {
  log.warn(
    { nodeEnv: config.NODE_ENV, hasAdminToken: Boolean(config.ADMIN_TOKEN) },
    "JWT_SECRET unset — auth middleware will fall back to ADMIN_TOKEN or be disabled",
  )
}

// Initialize OpenTelemetry BEFORE other imports touch network/IO.
initOtel({
  serviceName: config.OTEL_SERVICE_NAME,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  enabled: config.OTEL_ENABLED,
})

const app = new Hono<AppEnv>()

/** Register a route under both /api/ and /api/v1/ for versioning. */
function versionedRoute(
  method: "get" | "post" | "put" | "delete",
  path: string,
  handler: (c: Context) => Response | Promise<Response>,
) {
  app[method](`/api${path}`, handler)
  app[method](`/api/v1${path}`, handler)
}

// ---------------------------------------------------------------------------
// Global error handler + request ID middleware
// ---------------------------------------------------------------------------

app.onError((err, c) => {
  const requestId = c.get("requestId") ?? "unknown"
  log.error({ err, requestId, path: c.req.path }, "unhandled error")
  return c.json({ error: "internal_error", code: "INTERNAL_ERROR", requestId }, 500)
})

app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-Id") ?? crypto.randomUUID()
  c.set("requestId", requestId)
  await next()
  c.header("X-Request-Id", requestId)
})

// Prometheus HTTP metrics — record method, route, status, duration.
app.use("*", async (c, next) => {
  const start = performance.now()
  await next()
  const duration = (performance.now() - start) / 1000
  const route = c.req.routePath || c.req.path || "unknown"
  const method = c.req.method
  const status = c.res.status
  httpRequestTotal.labels(method, route, String(status)).inc()
  httpRequestDuration.labels(method, route, String(status)).observe(duration)
})

// ---------------------------------------------------------------------------
// Wire up runtime + workspace + commander
// ---------------------------------------------------------------------------

const workspaceDir = config.WORKSPACE_DIR

// Path imports for the root-dir constant below. Kept local (no top-level
// import) because `path` is only used here and we don't want to widen
// the module graph of this already-heavy server entry.
import path from "node:path"

// Root dir for durable per-workspace JSONL event logs. The path is
// configurable via EVENTS_DIR so tests and non-default deployments
// can point it at a tmpdir or a fast disk. Defaults to
// `<WORKSPACE_DIR>/events/` so events live next to workspace state.
const eventsRootDir = config.EVENTS_DIR ?? path.join(workspaceDir, "events")

// Durable event-log registry + event bus. The per-workspace append-only
// JSONL log is what backs the replay-capable SSE endpoint
// (`/api/workspaces/:id/stream`) — a reconnecting client can resume
// from any `Last-Event-ID` because we never evict events from disk.
// Compare with `sseReplay` (the in-memory ring buffer, capacity 64)
// which is still used for the websocket-style `SseReplayBuffer.since`
// lookups but is insuficient alone for long reconnects.
const eventLogRegistry = new EventLogRegistry(eventsRootDir)
const workspaceEventBus = createEventBus()

// Database: use PostgreSQL when DATABASE_URL is set, otherwise file-based stores.
const db = config.DATABASE_URL ? createDb(config.DATABASE_URL) : null
const store = (
  db ? new PgWorkspaceStore(db) : new FileWorkspaceStore(workspaceDir)
) as FileWorkspaceStore

const registry = getRegistry()
const providers = registry.list()
let defaultProvider: Provider | undefined = registry.default()

// Load dynamic provider configuration from database (if available)
// This overrides the env defaults with runtime-configured values.
if (db) {
  try {
    // We need to import this here because it depends on database being available.
    const { getProviderConfigsFromDb } = await import("@max/database")
    const configs = await getProviderConfigsFromDb(db)
    for (const [id, cfg] of configs) {
      registry.setProviderConfig(id, cfg)
      if (cfg.defaultProvider === true) {
        registry.setDefaultProviderId(id)
      }
    }
    // Refresh default provider after applying DB overrides.
    defaultProvider = registry.default()
    log.info({ count: configs.size }, "loaded dynamic provider config from database")
  } catch (err) {
    log.warn({ err }, "failed to load dynamic provider config from DB; using env defaults")
  }
}

if (!defaultProvider) {
  log.fatal(
    "No LLM provider configured. Set OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY in .env",
  )
  process.exit(1)
}

// Provider registry: id → Provider instance (for dynamic model selection).
const providerRegistry = new Map<string, Provider>()
for (const p of providers) providerRegistry.set(p.id, p)

// Wrap a getter that reads from the registry every time,
// supporting runtime default provider changes.
const getDefaultProvider = () => registry.default()!

const factory = defaultAgentFactory(getDefaultProvider, providerRegistry)

const eventLog = new Map<string, RuntimeEvent[]>()
const workspaceTouchedAt = new Map<string, number>()
const sseReplay = new SseReplayBuffer(64)
const sseSubscribers = new Map<string, Set<(event: SseEvent) => void>>()

function recordRuntimeEvent(event: RuntimeEvent): void {
  const arr = eventLog.get(event.workspaceId) ?? []
  arr.push(event)
  eventLog.set(event.workspaceId, arr)
  if (arr.length > 500) arr.splice(0, arr.length - 500)
  workspaceTouchedAt.set(event.workspaceId, Date.now())
  publishRuntimeEvent(event)
}

function publishRuntimeEvent(event: RuntimeEvent): void {
  const frame = sseReplay.append(event.workspaceId, { type: "event", event })
  const subs = sseSubscribers.get(event.workspaceId)
  if (subs) {
    for (const send of [...subs]) {
      try {
        send(frame)
      } catch (err) {
        log.error({ err }, "sse subscriber error")
      }
    }
  }
  busEmit<RuntimeEvent>("workspace", event.workspaceId, event)
  // Forward durable events to the replay-enabled SSE handler. The bus
  // delivers them to every open stream; the log keeps them around so a
  // reconnecting client can replay missed events from disk.
  try {
    workspaceEventBus.publish(event.workspaceId, { type: "event", event })
  } catch (err) {
    log.warn({ err, workspaceId: event.workspaceId }, "workspaceEventBus publish failed")
  }
  // Also persist the runtime event to the workspace's JSONL log so it
  // survives a full process restart and can be replayed even if no SSE
  // client was connected at emit time.
  try {
    const log_ = eventLogRegistry.for(event.workspaceId)
    void log_.append(event.type, event)
  } catch (err) {
    log.warn({ err, workspaceId: event.workspaceId }, "event-log append failed")
  }
}

function subscribeWorkspaceStream(
  workspaceId: string,
  handler: (event: SseEvent) => void,
): () => void {
  let subs = sseSubscribers.get(workspaceId)
  if (!subs) {
    subs = new Set()
    sseSubscribers.set(workspaceId, subs)
  }
  subs.add(handler)
  return () => {
    const current = sseSubscribers.get(workspaceId)
    if (!current) return
    current.delete(handler)
    if (current.size === 0) sseSubscribers.delete(workspaceId)
  }
}

// Phase 10 — Telemetry collector (in-memory ring-buffer + optional JSONL persistence).
const telemetryEnabled = config.TELEMETRY_ENABLED
const telemetry = telemetryEnabled
  ? new TelemetryCollector({
      maxBufferSize: config.TELEMETRY_BUFFER_SIZE,
      persistPath: config.TELEMETRY_PERSIST_PATH,
    })
  : undefined

if (telemetry) {
  log.info(
    {
      buffer: config.TELEMETRY_BUFFER_SIZE,
      persist: config.TELEMETRY_PERSIST_PATH ?? "memory-only",
    },
    "telemetry: ON",
  )
}

const sink: RuntimeSink = {
  // The runtime doesn't know about auth context. The chat route stashes
  // tenantId on workspace.metadata before calling runtime.execute, so
  // the sink reads it from there and forwards to the store. Without this
  // bridge, every runtime-internal save would persist the workspace as
  // tenant-less and the load-side isolation check would refuse to return
  // it to the authenticated owner.
  saveWorkspace: async (ws) => {
    const tenantId = (ws.metadata?.tenantId as string | null | undefined) ?? undefined
    return store.saveWorkspace(ws, tenantId ?? undefined)
  },
  loadWorkspace: async (id) => store.loadWorkspace(id),
}

// ---------------------------------------------------------------------------
// Agent Evolution Engine
// ---------------------------------------------------------------------------

const evolutionEnabled = config.EVOLUTION_ENABLED
let evolution: EvolutionFacade | undefined
let finalFactory = factory

if (evolutionEnabled) {
  evolution = new EvolutionFacade({
    rootDir: workspaceDir,
    candidates: providers,
    fallbackProvider: defaultProvider,
    defaultManifests: {},
    ...(db ? { profileStore: new PgProfileStore(db) } : {}),
  })
  await evolution.initialize()
  finalFactory = evolutionAwareFactory(evolution)
  log.info("evolution engine: ON")
}

// Commander: when evolution is ON, use evolution-aware model selection for planning.
const commanderModelSelector: CommanderModelSelectorPort | undefined = evolution
  ? {
      select(role) {
        const sel = evolution!.selectForRole(role)
        return { provider: sel.provider, model: sel.model, score: sel.score, reason: sel.reason }
      },
    }
  : undefined
const commander = new Commander(getDefaultProvider, {
  providerRegistry,
  modelSelector: commanderModelSelector,
})

// Runtime port adapters: when evolution is OFF, use FileMemoryStore so the
// runtime still gets long-term memory injection. When evolution is ON,
// `evolutionAwareFactory` already handles both memory and model selection.
let memoryStorePort: AgentMemoryStorePort | undefined
if (!evolution) {
  const fileStore = new FileMemoryStore({ rootDir: workspaceDir })
  await fileStore.init()
  memoryStorePort = fileStore
  log.info("memory store: file-backed (no evolution)")
}
const modelRouting = evolution ? null : bootstrapModelRouting(providers)
const modelSelectorPort: ModelSelectorPort | undefined = modelRouting?.selector
const modelRouterPort: ModelRouter | undefined = modelRouting?.router

const runtime = new AgentRuntime(finalFactory, sink, {
  memoryStore: memoryStorePort,
  modelSelector: modelSelectorPort,
  modelRouter: modelRouterPort,
  // Magentic-One style outer-loop replan: when the runtime observes N
  // consecutive idle rounds with no progress, ask Commander to re-write the
  // remaining task list given the completed results so far. If Commander
  // returns a non-empty replacement set, the runtime swaps it in. If
  // Commander fails (LLM error, malformed JSON, explicit "give up"), the
  // original pending list stays and the stall counter resets on the next
  // progress event.
  onStall: async (info, pending, results, ctx) => {
    if (!ctx) return undefined
    try {
      const out = await commander.replan(ctx.userRequest, results, pending)
      if (out && Array.isArray(out.tasks) && out.tasks.length > 0) {
        log.info(
          {
            workspaceId: ctx.workspaceId,
            idleRounds: info.idleRounds,
            from: pending.length,
            to: out.tasks.length,
          },
          "commander.replan produced replacement task list",
        )
        return out
      }
      log.warn(
        { workspaceId: ctx.workspaceId, idleRounds: info.idleRounds },
        "commander.replan returned no replacement — keeping original pending",
      )
      return undefined
    } catch (err) {
      log.error(
        { err, workspaceId: ctx.workspaceId },
        "commander.replan threw — keeping original pending",
      )
      return undefined
    }
  },
})
const dagsApprovalRuntimes = new Set<ApprovalAnswerPort>()
// In-memory cache: workspaceId → tenantId | null (null = no tenant, undefined = unknown/not-cached)
// Caches the tenantId per workspace so we don't query the DB on every runtime event.
const workspaceTenantCache = new Map<string, string | null>()
const approvalRuntimeRegistry = {
  register(runtimePort: ApprovalAnswerPort): () => void {
    dagsApprovalRuntimes.add(runtimePort)
    return () => dagsApprovalRuntimes.delete(runtimePort)
  },
  /** Look up pending approval across primary + all DAGS runtimes (tenant isolation). */
  getPendingApproval(requestId: string) {
    const primary = runtime.getPendingApproval?.(requestId)
    if (primary) return primary
    for (const rt of [...dagsApprovalRuntimes]) {
      const pending = rt.getPendingApproval?.(requestId)
      if (pending) return pending
    }
    return undefined
  },
}
function resolveApprovalAcrossRuntimes(
  requestId: string,
  response: { decision: "approve" | "reject"; comment?: string },
): { ok: true } | { ok: false; reason: "unknown" | "comment_required" } {
  const primary = runtime.resolveApproval(requestId, response)
  if (primary.ok) return primary
  if (primary.reason === "comment_required") return primary
  for (const runtimePort of [...dagsApprovalRuntimes]) {
    const next = runtimePort.resolveApproval(requestId, response)
    if (next.ok) return next
    // If any runtime reports comment_required, surface it — even if a
    // different runtime also has the request parked, the user-facing
    // requirement (comment missing) is the most actionable signal.
    if (next.reason === "comment_required") return next
  }
  return primary.ok ? primary : { ok: false, reason: primary.reason }
}

// ---------------------------------------------------------------------------
// Task Queue (BullMQ) — optional, gated by TASK_QUEUE_ENABLED + REDIS_URL
// ---------------------------------------------------------------------------

let queue: import("bullmq").Queue | undefined
if (config.TASK_QUEUE_ENABLED && config.REDIS_URL) {
  queue = createQueue(config.REDIS_URL)
  log.info({ redisUrl: config.REDIS_URL.replace(/\/\/.*@/, "//***@") }, "task queue: ON")
} else if (config.TASK_QUEUE_ENABLED && !config.REDIS_URL) {
  log.warn("TASK_QUEUE_ENABLED=true but REDIS_URL not set — falling back to in-process execution")
}

// Shared BlueprintStore so DAGS and the meta-system see the same blueprints
// (birth writes go through AgentBirthEngine → BlueprintStore.save, retirement
// goes through AgentRetirementEngine → BlueprintStore.retire).
const blueprintStore = (
  db ? new PgBlueprintStore(db) : new BlueprintStore(workspaceDir)
) as BlueprintStore

// Runtime listener: record metrics on task completion/failure.
runtime.on(async (event) => {
  // Prometheus metrics — always tracked, even without evolution.
  if (event.type === "task-start") {
    activeTasks.inc()
  }
  if (event.type === "task-complete" || event.type === "task-failed") {
    activeTasks.dec()
    const role =
      "result" in event ? (event as { result: { agentRole: string } }).result.agentRole : "general"
    const status = event.type === "task-complete" ? "completed" : "failed"
    taskTotal.labels(role, status).inc()
    const durMs =
      "result" in event
        ? ((event as { result: { durationMs?: number } }).result.durationMs ?? 0)
        : 0
    if (durMs > 0) taskDuration.labels(role, status).observe(durMs / 1000)
  }
  if (event.type === "task-complete") {
    const result = event.result
    const meta = (result.metadata ?? {}) as {
      model?: string
      usage?: { promptTokens?: number; completionTokens?: number }
      review?: { score?: number }
    }
    if (meta.usage) {
      const providerId = meta.model ? extractProvider(meta.model, providers) : defaultProvider.id
      if (meta.usage.promptTokens)
        llmTokensTotal
          .labels(providerId, meta.model ?? defaultProvider.defaultModel, "input")
          .inc(meta.usage.promptTokens)
      if (meta.usage.completionTokens)
        llmTokensTotal
          .labels(providerId, meta.model ?? defaultProvider.defaultModel, "output")
          .inc(meta.usage.completionTokens)
    }
  }

  recordRuntimeEvent(event)

  // Forward runtime events to the webhook/SSE subscription bus.
  // Without this, `publishEvent` is never called and webhook/SSE
  // subscribers receive nothing - the function was imported but unused
  // (the `void publishEvent` line below was just suppressing the
  // unused-import warning). Fire-and-forget: webhook delivery is slow
  // (10s timeout per subscription) and must NOT block the runtime loop.
  // Tenant isolation is enforced inside publishEvent via the
  // subscription's tenantId filter.
  //
  // Cache workspace → tenantId mapping to avoid per-event DB round-trip.
  // Without this, concurrent lookups for fast-flying event sequences
  // (task-start + task-complete in rapid succession) can complete out of
  // order, delivering events to SSE subscribers in the wrong order.
  let eventTenantId: string | undefined
  if (event.workspaceId) {
    if (workspaceTenantCache.has(event.workspaceId)) {
      // Cache hit — use cached value (null means "no tenant" so use undefined)
      eventTenantId = workspaceTenantCache.get(event.workspaceId) ?? undefined
    } else {
      // Cache miss — look up and populate cache (including null for "no tenant")
      try {
        eventTenantId = (await store.loadWorkspace(event.workspaceId))?.metadata?.tenantId
        // Store null sentinel if no tenantId so we don't re-query for this workspace
        workspaceTenantCache.set(event.workspaceId, eventTenantId ?? null)
      } catch {
        // Lookup failed — publish without tenant scope rather than dropping the event
      }
    }
  }
  void publishEvent(event.type, event, eventTenantId)

  if (!evolution) return

  if (event.type === "task-complete") {
    const result = event.result
    const meta = (result.metadata ?? {}) as {
      model?: string
      usage?: {
        promptTokens?: number
        completionTokens?: number
        cacheRead?: number
        cacheCreation?: number
      }
      review?: { score?: number }
    }
    const reviewScore = meta.review?.score
    await evolution.recordCompletion({
      task: {
        id: result.taskId,
        agentRole: result.agentRole,
        description: "",
        status: "completed",
        dependsOn: [],
      },
      result,
      provider: meta.model ? extractProvider(meta.model, providers) : defaultProvider.id,
      model: meta.model ?? defaultProvider.defaultModel,
      executionTimeMs: result.durationMs ?? 0,
      tokenInput: meta.usage?.promptTokens ?? 0,
      tokenOutput: meta.usage?.completionTokens ?? 0,
      cacheReadTokens: meta.usage?.cacheRead ?? 0,
      cacheCreationTokens: meta.usage?.cacheCreation ?? 0,
      reviewScore,
      defaultManifest: {
        role: result.agentRole,
        displayName: result.agentRole,
        goal: "",
        systemPrompt: "",
      },
    })
  } else if (event.type === "task-failed") {
    // Record failed task as a metric with error.
    const taskId = event.taskId
    await evolution.metrics.record({
      taskId,
      agentId: "unknown",
      agentRole: "general",
      provider: defaultProvider.id,
      model: defaultProvider.defaultModel,
      executionTime: 0,
      tokenInput: 0,
      tokenOutput: 0,
      retryCount: 0,
      error: event.error,
      timestamp: new Date().toISOString(),
    })
    await evolution.leaderboard.rebuild(evolution.metrics)
  } else if (event.type === "done") {
    // Post-run: attach review scores to non-review task metrics,
    // then consider evolution.
    await evolution.attachReviewScores(event.workspace)
    for (const r of event.workspace.results) {
      if (r.agentRole === "review") continue
      const decision = await evolution.maybeEvolve(r.agentRole)
      if (decision) {
        log.info(
          {
            outcome: decision.outcome,
            role: r.agentRole,
            from: decision.fromVersion,
            to: decision.toVersion,
          },
          "evolution decision",
        )
      }
    }

    // Phase 7 — Auto-trigger meta-system cycle after every workspace completes.
    if (metaOrchestrator && executionStore) {
      try {
        const recentExecutions = await executionStore.listAll()
        const blueprints = await blueprintStore.listAll()
        const graphs = workspaceToGraphs(event.workspace)
        const discoverySignals = extractDiscoverySignals(event.workspace)
        const cycleResult = await metaOrchestrator.cycle({
          recentExecutions,
          blueprints,
          graphs,
          discoverySignals,
        })
        if (cycleResult.births.length > 0 || cycleResult.retirements.length > 0) {
          log.info(
            {
              births: cycleResult.births.length,
              retirements: cycleResult.retirements.length,
              proposals: cycleResult.proposals.length,
              governance: cycleResult.governance.allowed ? "ok" : "BLOCKED",
            },
            "meta-cycle completed",
          )
        }
      } catch (err) {
        log.error({ err }, "meta-cycle failed")
      }
    }
  }
})

// Periodic TTL eviction: drop workspaces idle for >1h, cap at 200 entries.
setInterval(
  () => {
    const now = Date.now()
    const TTL_MS = 60 * 60 * 1000
    for (const [id, ts] of workspaceTouchedAt) {
      if (now - ts > TTL_MS) {
        eventLog.delete(id)
        workspaceTouchedAt.delete(id)
      }
    }
    // Hard cap after TTL pass to avoid pathological growth.
    if (eventLog.size > 200) {
      for (const id of eventLog.keys()) {
        if (eventLog.size <= 200) break
        eventLog.delete(id)
        workspaceTouchedAt.delete(id)
      }
    }
  },
  5 * 60 * 1000,
).unref()

function extractProvider(model: string, candidates: Provider[]): string {
  if (!model) return "unknown"
  // Model strings follow the "provider/model" convention (e.g. "anthropic/claude-sonnet-4-6").
  // Only honor the prefix when the model is explicitly provider-prefixed; bare
  // model names (e.g. "claude-sonnet-4-6") are ambiguous and must NOT be used
  // as a provider id, or we get high-cardinality bogus labels in metrics.
  if (model.includes("/")) {
    const prefix = model.split("/")[0]
    const match = candidates.find((p) => p.id === prefix)
    return match?.id ?? "unknown"
  }
  // Try matching the bare model name as a provider id (unlikely but cheap).
  const match = candidates.find((p) => p.id === model)
  return match?.id ?? "unknown"
}

// ---------------------------------------------------------------------------
// Middleware (registered before all routes so they all get CORS + logging)
// ---------------------------------------------------------------------------

app.use("*", logger())
app.use("*", securityHeaders())
app.use(
  "*",
  cors({
    origin: config.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
)
// Rate limit: 100 requests per minute per IP (hono-rate-limiter).
// X-Forwarded-For / X-Real-IP are ONLY honored when the immediate
// connection peer is in TRUSTED_PROXIES — without this guard, an
// attacker can spoof the header to mint a fresh key per request and
// trivially bypass the 100 req/min cap. When TRUSTED_PROXIES is empty
// (the default), we always fall back to the socket's remote address.
const TRUSTED_PROXY_LIST = config.TRUSTED_PROXIES.split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)

app.use(
  rateLimiter({
    windowMs: 60_000,
    limit: 100,
    standardHeaders: "draft-6",
    keyGenerator: (c) => {
      const remoteAddr = c.env?.incoming?.socket?.remoteAddress ?? "unknown"
      // Only honor forwarded headers when the direct peer is a trusted proxy.
      if (TRUSTED_PROXY_LIST.length > 0 && isTrustedProxy(remoteAddr)) {
        const forwarded = c.req.header("X-Forwarded-For")
        if (forwarded) {
          const ips = forwarded
            .split(",")
            .map((ip) => ip.trim())
            .filter(Boolean)
          // Rightmost is the client when the request was forwarded through
          // our trusted proxy chain. Walk the chain from the right and
          // return the first non-trusted hop (i.e. the real client IP).
          for (let i = ips.length - 1; i >= 0; i--) {
            if (!isTrustedProxy(ips[i]!)) return ips[i]!
          }
        }
        const realIp = c.req.header("X-Real-IP")
        if (realIp) return realIp
      }
      return remoteAddr
    },
  }),
)

/**
 * Test whether `addr` matches any entry in `TRUSTED_PROXY_LIST`. Supports
 * exact IPs (e.g. "10.0.0.1") and IPv4 CIDR blocks (e.g. "10.0.0.0/8").
 * IPv6 CIDR isn't supported yet — the common case is private IPv4.
 */
function isTrustedProxy(addr: string): boolean {
  // Strip IPv6-mapped IPv4 prefix.
  const normalized = addr.startsWith("::ffff:") ? addr.slice(7) : addr
  for (const entry of TRUSTED_PROXY_LIST) {
    if (entry.includes("/")) {
      if (cidrMatch(normalized, entry)) return true
    } else if (normalized === entry) {
      return true
    }
  }
  return false
}

function cidrMatch(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/")
  const bits = Number(bitsStr)
  if (!base || !Number.isFinite(bits) || bits < 0 || bits > 32) return false
  const ipNum = ipv4ToInt(ip)
  const baseNum = ipv4ToInt(base)
  if (ipNum === null || baseNum === null) return false
  if (bits === 0) return true
  const mask = (~0 << (32 - bits)) >>> 0
  return (ipNum & mask) === (baseNum & mask)
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const v = Number(p)
    if (!Number.isInteger(v) || v < 0 || v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

// Auth middleware for sensitive endpoints.
// Priority: JWT_SECRET (JWT auth) > ADMIN_TOKEN (simple bearer) > no auth (dev mode).
const ADMIN_TOKEN = config.ADMIN_TOKEN
function requireAuthMiddleware() {
  // Path 1: JWT auth when JWT_SECRET is configured
  if (config.JWT_SECRET) {
    return authMiddleware(config.JWT_SECRET)
  }
  // Path 2: simple ADMIN_TOKEN bearer check
  return async (c: Context, next: () => Promise<void>) => {
    if (!ADMIN_TOKEN) return next()
    const header = c.req.header("Authorization") ?? ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : ""
    if (token !== ADMIN_TOKEN) {
      return c.json({ error: "unauthorized" }, 401)
    }
    c.set("userId", "admin")
    c.set("userRole", "admin")
    return next()
  }
}

// ---------------------------------------------------------------------------
// Phase 6 — Meta-System (META_AGENT_ENABLED) — declared before routes
// ---------------------------------------------------------------------------

const metaAgentEnabled = config.META_AGENT_ENABLED
let metaOrchestrator: MetaOrchestrator | undefined
let metaGovernance: GovernanceEngine | undefined
let metaOrgMemory: OrganizationMemory | undefined
let metaSimulation: SimulationEngine | undefined
let metaRegistry: CapabilityRegistry | undefined
let metaDiscovery: CapabilityDiscoveryEngine | undefined
let metaPendingStore: PendingProposalStore | undefined
let metaRollout: SafeRollout | undefined
let metaBirth: InstanceType<typeof AgentBirthEngine> | undefined

if (metaAgentEnabled) {
  const metaRoot = config.META_ROOT_DIR ?? workspaceDir
  metaRegistry = (
    db ? new PgCapabilityStore(db) : new CapabilityRegistry(metaRoot)
  ) as CapabilityRegistry
  metaDiscovery = new CapabilityDiscoveryEngine(metaRoot)
  const discovery = metaDiscovery
  // Phase 8.7 — TruthAudit (prediction-vs-reality verification). When
  // DATABASE_URL is set we persist measurements + verifications so the
  // calibration drift survives restarts; otherwise the audit runs
  // in-memory only (still useful for the cycle report, just not durable).
  // Constructed via `TruthAudit.create()` so the historical load completes
  // before the orchestrator can call report()/verify().
  const truthStore = db ? new PgTruthStore(db) : undefined
  const truthAudit = truthStore
    ? await TruthAudit.create({
        getMeasurements: () => truthStore.listAllMeasurements(),
        saveMeasurement: (m) => {
          // The TruthMeasurement type uses `proposalAction` (typed enum) but
          // the DB row stores `action` (string). Map once here so the
          // in-memory type doesn't have to know about persistence.
          const id = `${m.proposalId}::${m.recordedAt}`
          return truthStore.saveMeasurement({
            id,
            proposalId: m.proposalId,
            action: String(m.proposalAction),
            predicted: m.predicted,
            actual: m.actual,
            sampleSize: m.sampleSize,
            recordedAt: m.recordedAt,
          })
        },
      })
    : undefined
  // Phase 8 — when DIGITAL_TWIN_ENABLED, engines are constructed WITHOUT
  // save/retire callbacks; the orchestrator wires manualSaveBlueprint /
  // manualRetireBlueprint so that no mutation bypasses the pipeline.
  const digitalTwinEnabled = config.DIGITAL_TWIN_ENABLED
  metaBirth = new AgentBirthEngine({
    rootDir: metaRoot,
    saveBlueprint: digitalTwinEnabled ? undefined : (bp) => blueprintStore.save(bp),
  })
  const retirement = new AgentRetirementEngine({
    retireBlueprint: digitalTwinEnabled ? undefined : (id) => blueprintStore.retire(id),
  })
  const metaAgent = new MetaAgent()
  const teamOptimizer = new TeamOptimizer({
    rootDir: metaRoot,
    applyToBlueprintStore: digitalTwinEnabled
      ? undefined
      : async (hint) => {
          const blueprints = await blueprintStore.listAll()
          return await applyHintToBlueprints(hint, blueprints, (bp) => blueprintStore.save(bp))
        },
  })
  const orgMemory = (
    db ? new PgOrgMemory(db) : new OrganizationMemory(metaRoot)
  ) as OrganizationMemory
  if (db && orgMemory instanceof PgOrgMemory) {
    orgMemory
      .archiveByRetention({ retainDays: config.EVENT_RETENTION_DAYS })
      .then((result) =>
        log.info({ archived: result.archived }, "org event archive retention applied"),
      )
      .catch((err) => log.warn({ err }, "org event archive retention failed"))
  }
  const governance = (
    db ? new PgGovernanceEngine(db) : new GovernanceEngine(metaRoot)
  ) as GovernanceEngine
  const simulation = new SimulationEngine()
  // Phase 8 — optional Digital Twin + Proposal Pipeline + Safe Rollout.
  let pipeline: ProposalPipeline | undefined
  if (digitalTwinEnabled) {
    pipeline = new ProposalPipeline({
      simulation,
      captureSnapshot: async () =>
        DigitalTwin.capture({
          capabilities: await metaRegistry!.listAll(),
          blueprints: await blueprintStore.listAll(),
          graphs: [],
        }),
      telemetry: telemetry ?? undefined,
    })
    const rolloutMode = config.SAFE_ROLLOUT_MODE
    metaRollout = new SafeRollout(rolloutMode)
    log.info({ rollout: rolloutMode }, "DIGITAL_TWIN_ENABLED: ON")
  }
  // Phase 11 — HITL pending proposal store (only when digital twin is active).
  metaPendingStore = digitalTwinEnabled
    ? ((db
        ? new PgPendingProposalStore(db)
        : new PendingProposalStore(metaRoot)) as PendingProposalStore)
    : undefined
  metaOrchestrator = new MetaOrchestrator({
    registry: metaRegistry,
    discovery,
    birth: metaBirth,
    retirement,
    metaAgent,
    teamOptimizer,
    orgMemory,
    governance,
    pipeline,
    rollout: metaRollout,
    manualSaveBlueprint: digitalTwinEnabled ? (bp) => blueprintStore.save(bp) : undefined,
    manualRetireBlueprint: digitalTwinEnabled ? (id) => blueprintStore.retire(id) : undefined,
    telemetry: telemetry ?? undefined,
    pendingStore: metaPendingStore,
    truthAudit,
  })
  metaGovernance = governance
  metaOrgMemory = orgMemory
  metaSimulation = simulation

  log.info({ digitalTwin: digitalTwinEnabled }, "META_AGENT_ENABLED: ON")
}

// ---------------------------------------------------------------------------
// Phase 5 — DAGS pipeline + AutonomyOrchestrator
// ---------------------------------------------------------------------------

const dagsMode = config.DAGS_MODE
let dags: DAGS | undefined
let orchestrator: AutonomyOrchestrator | undefined
let executionStore: ExecutionStore | undefined
let learningApi: LearningAPI | undefined

if (dagsMode) {
  if (!evolution) {
    throw new Error(
      "DAGS_MODE requires EvolutionFacade (set EVOLUTION_ENABLED=true or unset to enable by default)",
    )
  }
  dags = new DAGS({
    rootDir: workspaceDir,
    evolution,
    candidates: providers,
    store: blueprintStore,
    syncDynamicCapabilities:
      metaAgentEnabled && metaRegistry ? () => syncRegistryToDags(metaRegistry) : undefined,
  })
  log.info("DAGS_MODE: ON")

  executionStore = (
    db ? new PgExecutionStore(db) : new ExecutionStore(workspaceDir)
  ) as ExecutionStore
  if (db && executionStore instanceof PgExecutionStore) {
    executionStore
      .archiveByRetention({ retainDays: config.EVENT_RETENTION_DAYS })
      .then((result) =>
        log.info({ archived: result.archived }, "execution archive retention applied"),
      )
      .catch((err) => log.warn({ err }, "execution archive retention failed"))
  }
  const insightsStore = (
    db ? new PgInsightsStore(db) : new InsightsStore(workspaceDir)
  ) as InsightsStore
  const failureAnalyzer = new FailurePatternAnalyzer(insightsStore)
  const planner = new EvolutionPlanner(workspaceDir)
  const candidateGenerator = new CandidateGenerator(workspaceDir)
  const promotionEngine = new PromotionEngine(workspaceDir, candidateGenerator)
  await promotionEngine.loadHistory()

  const { ReviewIntelligence } = await import("@max/autonomy")
  const reviewIntelligence = new ReviewIntelligence()

  orchestrator = new AutonomyOrchestrator({
    dags,
    review: reviewIntelligence,
    executionStore,
    insightsStore,
    failureAnalyzer,
    planner,
    candidateGenerator,
    promotionEngine,
  })

  learningApi = new LearningAPI(
    executionStore,
    insightsStore,
    failureAnalyzer,
    candidateGenerator,
    promotionEngine,
    planner,
  )
  log.info("autonomy orchestrator: ON")
}

// ---------------------------------------------------------------------------
// Routes — mounted under both /api/ and /api/v1/
// ---------------------------------------------------------------------------

const api = new OpenAPIHono<AppEnv>()

api.openapi(healthRoute, async (c) => {
  const checks: Record<string, "ok" | "degraded" | "down"> = {
    evolution: evolutionEnabled ? "ok" : "degraded",
    metaAgent: metaAgentEnabled ? "ok" : "degraded",
    telemetry: telemetryEnabled ? "ok" : "degraded",
  }

  // DB probe: run SELECT 1 to verify actual connectivity.
  if (db) {
    try {
      await db.execute(sql`SELECT 1`)
      checks.database = "ok"
    } catch {
      checks.database = "down"
    }
  } else {
    checks.database = "degraded"
  }

  // LLM probe: verify the default provider is configured (lightweight, no API call).
  if (defaultProvider?.isConfigured()) {
    checks.llm = "ok"
  } else if (defaultProvider) {
    checks.llm = "degraded"
  } else {
    checks.llm = "down"
  }

  // Disk check: workspace dir writable?
  try {
    const { access } = await import("node:fs/promises")
    await access(workspaceDir)
    checks.disk = "ok"
  } catch {
    checks.disk = "down"
  }

  const anyDown = Object.values(checks).includes("down")
  const anyDegraded = Object.values(checks).includes("degraded")
  const overallStatus = anyDown ? "down" : anyDegraded ? "degraded" : "ok"

  return c.json(
    {
      status: overallStatus,
      database:
        checks.database === "ok"
          ? "connected"
          : checks.database === "degraded"
            ? "file-based"
            : "unreachable",
      providers: registry
        .list()
        .map((p) => ({ id: p.id, name: p.name, configured: p.isConfigured() })),
      defaultProvider: defaultProvider.id,
      evolution: evolutionEnabled ? "on" : "off",
      dagsMode: dagsMode ? "on" : "off",
      metaAgent: metaAgentEnabled ? "on" : "off",
      telemetry: telemetryEnabled ? "on" : "off",
      taskQueue: queue ? "on" : "off",
      multiTenant: config.MULTI_TENANT_ENABLED ? "on" : "off",
      checks,
    },
    overallStatus === "ok" ? 200 : 503,
  )
})

// Readiness probe for Kubernetes — actually probes each critical
// dependency so K8s stops routing traffic when something's broken,
// rather than only catching "config missing at boot". Probes live in
// `lib/readiness.ts` so they can be unit-tested with mocked deps.
api.openapi(readyRoute, async (c) => {
  const { ok, checks } = await runReadinessChecks({
    db: db as { execute: (q: unknown) => Promise<unknown> } | null,
    databaseUrl: config.DATABASE_URL,
    providerCount: registry.list().length,
    workspaceDir,
    runQuery: () => db!.execute(sql`SELECT 1`),
  })
  return c.json({ status: ok ? "ready" : "not_ready", checks }, ok ? 200 : 503)
})

api.openapi(listProvidersRoute, listProviders(registry))

// Feature Flag SDK routes — read & override flags at runtime.
import {
  listFlagsRoute,
  getFlagRoute,
  setOverrideRoute,
  clearOverrideRoute,
  evaluateRoute,
  getFlags,
  __setFeatureFlagsForTests,
} from "./routes/feature-flags.js"

api.openapi(listFlagsRoute, (c) => {
  const flags = getFlags()
  const definitions = flags.listFlagNames()
  const list = definitions.map((name) => {
    const def = flags.getFlagDefinition(name)
    return {
      name,
      enabled: flags.isEnabled(name),
      defaultValue: def?.defaultValue ?? false,
      rolloutPercentage: def?.rolloutPercentage,
      description: def?.description,
    }
  })
  return c.json({ flags: list })
})

api.openapi(getFlagRoute, (c) => {
  const { name } = c.req.valid("param")
  const flags = getFlags()
  const def = flags.getFlagDefinition(name)
  if (!def) return c.json({ error: `Unknown flag: ${name}` }, 404)
  return c.json({
    name,
    enabled: flags.isEnabled(name),
    defaultValue: def.defaultValue,
    rolloutPercentage: def.rolloutPercentage,
    description: def.description,
  })
})

api.openapi(setOverrideRoute, (c) => {
  const { name } = c.req.valid("param")
  const { value, reason } = c.req.valid("json")
  const flags = getFlags()
  if (!flags.getFlagDefinition(name)) {
    return c.json({ error: `Unknown flag: ${name}` }, 404)
  }
  flags.override(name, value)
  const auth = c.get("auth" as never) as { userId?: string } | undefined
  return c.json({
    flagName: name,
    value,
    overriddenBy: auth?.userId,
    overriddenAt: new Date().toISOString(),
  })
})

api.openapi(clearOverrideRoute, (c) => {
  const { name } = c.req.valid("param")
  const flags = getFlags()
  if (!flags.getFlagDefinition(name)) {
    return c.json({ error: `Unknown flag: ${name}` }, 404)
  }
  flags.clearOverride(name)
  return c.body(null, 204)
})

api.openapi(evaluateRoute, (c) => {
  const { flagNames, userId } = c.req.valid("json")
  // Re-create with the requested userId for proper targeting.
  const scoped = createFeatureFlags({ userId })
  const values: Record<string, boolean> = {}
  for (const name of flagNames) {
    values[name] = scoped.isEnabled(name)
  }
  return c.json({ values })
})

void __setFeatureFlagsForTests

// Dynamic provider configuration — requires auth
api.openapi(setDefaultProviderRoute, requireAuthMiddleware(), async (c) => {
  const { providerId } = c.req.valid("json" as never) as { providerId: string }
  const found = registry.get(providerId)
  if (!found) {
    return c.json({ error: "Provider not found" }, 404)
  }
  registry.setDefaultProviderId(providerId)
  // Persist atomically so the "exactly one default" DB invariant holds.
  // Failure to persist is logged but does not roll back the in-memory change —
  // the user sees the switch take effect immediately; only restart-survival
  // is lost if the DB write fails.
  if (db) {
    try {
      const { setDefaultProviderInDb } = await import("@max/database")
      await setDefaultProviderInDb(db, providerId, registry.getEffectiveDefaultModel(providerId))
    } catch (err) {
      getLogger("api").warn({ err, providerId }, "failed to persist default provider to DB")
    }
  }
  return c.json({ ok: true, providerId })
})

api.openapi(setProviderModelRoute, requireAuthMiddleware(), async (c) => {
  const id = c.req.param("id")
  const { model } = c.req.valid("json" as never) as { model: string }
  const found = registry.get(id)
  if (!found) {
    return c.json({ error: "Provider not found" }, 404)
  }
  // Basic sanity: reject empty / whitespace-only / overly long names and
  // anything with control characters. The provider may still reject the
  // name at call time — true whitelist validation requires the provider
  // to publish a model catalog (not yet exposed).
  const trimmed = model.trim()
  if (trimmed.length === 0) {
    return c.json({ error: "Model name cannot be empty" }, 400)
  }
  if (trimmed.length > 200) {
    return c.json({ error: "Model name too long (max 200 chars)" }, 400)
  }
  if (/[\r\n\t\0]/.test(trimmed)) {
    return c.json({ error: "Model name contains invalid characters" }, 400)
  }
  registry.setProviderConfig(id, { defaultModel: trimmed })
  if (db) {
    try {
      const { setProviderModelInDb } = await import("@max/database")
      const updated = await setProviderModelInDb(db, id, trimmed)
      if (!updated) {
        // No existing row — the model will live in memory only until restart.
        getLogger("api").info(
          { providerId: id, model: trimmed },
          "provider model updated in memory; no DB row to update (set default first to persist)",
        )
      }
    } catch (err) {
      getLogger("api").warn(
        { err, providerId: id, model: trimmed },
        "failed to persist model change to DB",
      )
    }
  }
  return c.json({ ok: true, providerId: id, model: trimmed })
})

// ── Circuit Breaker & Health ────────────────────────────────────────────────

// In-memory failover queue (mirrors cc-switch's in-memory failover state)
const failoverQueue = new Map<string, { priority: number; addedAt: number }>()
let autoFailoverEnabled = false

api.openapi(providerHealthRoute, requireAuthMiddleware(), async (c) => {
  const id = c.req.param("id")
  const provider = registry.get(id)
  if (!provider) {
    return c.json({ error: "Provider not found" }, 404)
  }
  const cbProvider = provider as import("@max/providers").CircuitBreakerProvider // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion
  const stats = cbProvider.getCircuitBreakerStats?.()
  const isConfigured = provider.isConfigured()
  // Derive health status from circuit breaker state and configuration
  let status: "healthy" | "degraded" | "down" | "unknown" = "unknown"
  if (stats) {
    if (stats.state === "closed") status = isConfigured ? "healthy" : "down"
    else if (stats.state === "open") status = "down"
    else status = "degraded"
  } else {
    status = isConfigured ? "healthy" : "unknown"
  }
  return c.json({
    status,
    latencyMs: stats?.failures !== undefined ? undefined : undefined, // latency would require a probe
    errorMessage: stats?.state === "open" ? "circuit breaker open" : undefined,
    lastCheckedAt: stats?.lastFailureAt,
  })
})

api.openapi(circuitBreakerStatsRoute, requireAuthMiddleware(), async (c) => {
  const id = c.req.param("id")
  const provider = registry.get(id)
  if (!provider) {
    return c.json({ error: "Provider not found" }, 404)
  }
  const cbProvider = provider as import("@max/providers").CircuitBreakerProvider  
  const stats = cbProvider.getCircuitBreakerStats?.()
  if (!stats) {
    return c.json({ error: "Circuit breaker not available for this provider" }, 404)
  }
  return c.json(stats)
})

api.openapi(circuitBreakerResetRoute, requireAuthMiddleware(), async (c) => {
  const id = c.req.param("id")
  const provider = registry.get(id)
  if (!provider) {
    return c.json({ error: "Provider not found" }, 404)
  }
  const cbProvider = provider as import("@max/providers").CircuitBreakerProvider  
  cbProvider.resetCircuitBreaker?.()
  return c.json({ ok: true, providerId: id })
})

// ── Failover Queue ─────────────────────────────────────────────────────────

api.openapi(failoverQueueRoute, requireAuthMiddleware(), async (c) => {
  const queue = [...failoverQueue.entries()]
    .map(([providerId, entry]) => ({ providerId, ...entry }))
    .sort((a, b) => a.priority - b.priority)
  return c.json({ queue })
})

api.openapi(failoverQueueAddRoute, requireAuthMiddleware(), async (c) => {
  const { providerId, priority = 99 } = c.req.valid("json" as never) as { providerId: string; priority?: number }
  const provider = registry.get(providerId)
  if (!provider) {
    return c.json({ error: "Provider not found" }, 404)
  }
  failoverQueue.set(providerId, { priority, addedAt: Date.now() })
  return c.json({ ok: true, providerId })
})

api.openapi(failoverQueueRemoveRoute, requireAuthMiddleware(), async (c) => {
  const { providerId } = c.req.valid("json" as never) as { providerId: string }
  failoverQueue.delete(providerId)
  return c.json({ ok: true, providerId })
})

api.openapi(autoFailoverRoute, requireAuthMiddleware(), async (c) => {
  return c.json({ enabled: autoFailoverEnabled })
})

api.openapi(setAutoFailoverRoute, requireAuthMiddleware(), async (c) => {
  const { enabled } = c.req.valid("json" as never) as { enabled: boolean }
  autoFailoverEnabled = enabled
  return c.json({ ok: true, enabled: autoFailoverEnabled })
})

// Auth routes (only when DATABASE_URL is set — requires PostgreSQL)
if (db && config.JWT_SECRET) {
  const auth = authRoutes({
    db,
    jwtSecret: config.JWT_SECRET,
    jwtExpiresIn: config.JWT_EXPIRES_IN,
    jwtRefreshExpiresIn: config.JWT_REFRESH_EXPIRES_IN,
    multiTenant: config.MULTI_TENANT_ENABLED,
  })
  api.openapi(authRegisterRoute, auth.register)
  api.openapi(authLoginRoute, auth.login)
  api.openapi(authRefreshRoute, auth.refresh)
  api.openapi(authLogoutRoute, requireAuthMiddleware(), auth.logout)
  log.info("auth routes: ON")

  // Tenant management (admin only)
  const tenants = tenantRoutes({ db })
  api.openapi(tenantCreateRoute, requireAuthMiddleware(), requireRole("admin"), tenants.create)
  api.openapi(tenantListRoute, requireAuthMiddleware(), requireRole("admin"), tenants.list)
  api.openapi(tenantGetRoute, requireAuthMiddleware(), requireRole("admin"), tenants.get)
  api.openapi(tenantUpdateRoute, requireAuthMiddleware(), requireRole("admin"), tenants.update)
  api.openapi(tenantDeleteRoute, requireAuthMiddleware(), requireRole("admin"), tenants.remove)
  log.info("tenant routes: ON")
}

api.openapi(
  postChatRoute,
  requireAuthMiddleware(),
  postChat({
    commander,
    runtime,
    store,
    eventLog,
    dagsMode,
    dags,
    orchestrator,
    telemetry,
    queue,
    dagsApprovalRuntimes: approvalRuntimeRegistry,
    onDagsRuntimeEvent: publishRuntimeEvent,
  }),
)

api.openapi(listWorkspacesRoute, requireAuthMiddleware(), listWorkspaces(store))
api.openapi(getWorkspaceRoute, requireAuthMiddleware(), getWorkspace(store))
api.openapi(getWorkspaceEventsRoute, requireAuthMiddleware(), getWorkspaceEvents(store, eventLog))

// ---------------------------------------------------------------------------
// ScopedBus — replay-friendly fan-out for runtime events (P0-C).
// Mirrors crewAI's EventBus scopes: handlers are keyed by (scope, scopeKey)
// and a fresh subscriber can ask for the last N events on its scope.
// Kept inline (no extra package) — the implementation is ~80 lines and the
// only consumer lives in this server file. Tests for the equivalent primitive
// live in @max/ui-state/src/sync.ts.
// ---------------------------------------------------------------------------
type BusScope = "global" | "workspace"
interface BusEvent<T = unknown> {
  scope: BusScope
  scopeKey: string
  payload: T
  ts: number
}
const REPLAY_LIMIT = 64
const busHandlers = new Map<string, Set<(e: BusEvent) => void>>()
const busRecent = new Map<string, BusEvent[]>()
function busEmit<T>(scope: BusScope, scopeKey: string, payload: T): void {
  const k = `${scope}:${scopeKey}`
  const evt: BusEvent<T> = { scope, scopeKey, payload, ts: Date.now() }
  let buf = busRecent.get(k)
  if (!buf) {
    buf = []
    busRecent.set(k, buf)
  }
  buf.push(evt as BusEvent)
  if (buf.length > REPLAY_LIMIT) buf.splice(0, buf.length - REPLAY_LIMIT)
  const subs = busHandlers.get(k)
  if (subs)
    for (const h of [...subs]) {
      try {
        h(evt as BusEvent)
      } catch (err) {
        log.error({ err }, "bus handler error")
      }
    }
}
function busSubscribe<T>(
  scope: BusScope,
  scopeKey: string,
  handler: (e: BusEvent<T>) => void,
  replay = 0,
): () => void {
  const k = `${scope}:${scopeKey}`
  let subs = busHandlers.get(k)
  if (!subs) {
    subs = new Set()
    busHandlers.set(k, subs)
  }
  const wrapped = handler as (e: BusEvent) => void
  subs.add(wrapped)
  if (replay > 0) {
    const buf = busRecent.get(k) ?? []
    for (const evt of buf.slice(-replay)) {
      try {
        wrapped(evt)
      } catch (err) {
        log.error({ err }, "bus replay error")
      }
    }
  }
  return () => {
    const cur = busHandlers.get(k)
    if (cur) {
      cur.delete(wrapped)
      if (cur.size === 0) busHandlers.delete(k)
    }
  }
}

// Mirror runtime events into the bus so the SSE endpoint below can replay
// and fan-out independently of the workspace-scoped stream route.
// Runtime events are mirrored into the bus by publishRuntimeEvent().

// SSE: replay-friendly bus stream. Query `?scope=workspace&key=<id>&replay=64`
// to attach to a workspace; omit to listen globally.
api.get("/events/bus", requireAuthMiddleware(), async (c) => {
  const scope = (c.req.query("scope") as BusScope) || "global"
  const key = c.req.query("key") || (scope === "global" ? "global" : "")
  const replay = Math.max(0, Math.min(REPLAY_LIMIT, Number(c.req.query("replay") ?? "0") || 0))

  if (scope !== "global" && !key) {
    return c.json({ error: "key query param required for workspace scope" }, 400)
  }

  // Workspace ownership check before subscribing. The bus is in-memory
  // and key-indexed, so a guessed key would otherwise yield a 200 with
  // another tenant's events. The store load now enforces tenant match
  // (see C3 fix in packages/workspace).
  if (scope === "workspace") {
    const tenantId = c.get("tenantId") as string | undefined
    const ws = await store.loadWorkspace(key, tenantId)
    if (!ws) return c.json({ error: "Workspace not found" }, 404)
  }

  const encoder = new TextEncoder()
  let closed = false
  let unsub: (() => void) | undefined

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: Record<string, unknown>) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      // Replay buffer first so a freshly-mounted client catches up on missed events.
      const bufferKey = scope === "global" ? "global" : key
      const buf = busRecent.get(`${scope}:${bufferKey}`) ?? []
      for (const evt of buf.slice(-replay))
        send({ type: "event", scope, key: bufferKey, event: evt.payload, ts: evt.ts })

      unsub = busSubscribe<RuntimeEvent>(
        scope,
        bufferKey,
        (evt) => {
          send({
            type: "event",
            scope: evt.scope,
            key: evt.scopeKey,
            event: evt.payload,
            ts: evt.ts,
          })
        },
        0,
      )
    },
    cancel() {
      closed = true
      unsub?.()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
})

// SSE streaming endpoint — replaces polling for real-time workspace updates.
// Supports `Last-Event-ID` for resilient reconnect: every runtime event is
// buffered in a per-workspace ring (capacity 64) and replayed on reconnect.
// Workspace snapshots and the terminal `done` marker are ephemeral — they
// are sent on every (re)connect but never buffered, so the buffer holds
// only the high-signal runtime events the client might have missed.
api.openapi(streamWorkspaceRoute, requireAuthMiddleware(), async (c: any) => {
  const id = c.req.param("id")
  // tenantId may be set by auth middleware; cast since AppEnv doesn't declare it
  const tenantId = (c as any).get("tenantId") as string | undefined

  const ws = await store.loadWorkspace(id, tenantId)
  if (!ws) return c.json({ error: "Workspace not found" }, 404)

  const encoder = new TextEncoder()
  let unsub: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closed = false

  // The browser's `EventSource` automatically resends the last-seen `id:`
  // as the `Last-Event-ID` request header on reconnect. We replay
  // everything after that id before attaching the live listener.
  const lastEventId = parseLastEventId(c.req.header("Last-Event-ID"))

  const stream = new ReadableStream({
    start(controller) {
      // Centralized teardown: clears the heartbeat interval AND
      // unsubscribes from the runtime event stream. Idempotent via the
      // `closed` flag. Called from `cancel()`, from `sendFrame`/`sendEphemeral`
      // when enqueue throws (client gone), and after delivering the
      // terminal `done` event. Without this, a dropped connection would
      // leak the heartbeat interval and keep the subscription live.
      const cleanup = () => {
        if (closed) return
        closed = true
        try {
          unsub?.()
        } catch {}
        unsub = undefined
        if (heartbeat) {
          clearInterval(heartbeat)
          heartbeat = undefined
        }
      }

      const sendFrame = (event: SseEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(encodeSseFrame(event)))
        } catch {
          cleanup()
        }
      }

      // Ephemeral send: emit a `data:` frame WITHOUT an `id:` line and
      // without buffering. The browser won't track this as the
      // last-seen event id, so a reconnect will re-deliver it (which is
      // what we want for snapshots — the client always needs the latest
      // workspace state, not a stale buffered copy).
      const sendEphemeral = (data: Record<string, unknown>) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          cleanup()
        }
      }

      // Heartbeat: proxies and load balancers (nginx, ALB, etc.) drop
      // idle SSE connections after 60s by default. A `:` comment frame
      // every 25s keeps the connection alive without the browser
      // surfacing it as an event. If enqueue throws (client gone),
      // cleanup so the interval and subscription don't leak.
      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(": ping\n\n"))
        } catch {
          cleanup()
        }
      }, 25_000)

      // 1. Always send the current workspace snapshot first — even if
      //    the buffer has replay events, the client needs the latest
      //    state as a baseline (the buffer only holds runtime events,
      //    not snapshots, so we'd otherwise miss the workspace state
      //    entirely on reconnect).
      sendEphemeral({ type: "workspace", workspace: ws })

      // 2. Replay buffered runtime events the client hasn't seen yet.
      for (const event of sseReplay.since(id, lastEventId)) {
        sendFrame(event)
      }

      // 3. Stream runtime events as they arrive.
      unsub = subscribeWorkspaceStream(id, (frame) => {
        sendFrame(frame)
        const runtimeEvent = (frame.data as { event?: RuntimeEvent }).event
        if (runtimeEvent?.type === "task-complete" || runtimeEvent?.type === "done") {
          store
            .loadWorkspace(id, tenantId)
            .then((updated) => {
              if (updated) sendEphemeral({ type: "workspace", workspace: updated })
              if (updated?.status === "completed" || updated?.status === "failed") {
                sendEphemeral({ type: "done" })
                try {
                  controller.close()
                } catch {}
                cleanup()
              }
            })
            .catch((err) => {
              log.warn({ err, workspaceId: id }, "workspace reload failed in SSE loop")
            })
        }
      })

      // 4. If the workspace is already terminal, deliver `done` once
      //    and close. Because `done` is ephemeral (not buffered), a
      //    reconnect that races with this branch will re-send it — but
      //    only once per connection, never duplicated within a single
      //    stream.
      if (ws.status === "completed" || ws.status === "failed") {
        sendEphemeral({ type: "done" })
        try {
          controller.close()
        } catch {}
        cleanup()
      }
    },
    cancel() {
      // Client disconnected - tear down the subscription and heartbeat
      // so we don't keep emitting into a dead controller.
      if (closed) return
      closed = true
      try {
        unsub?.()
      } catch {}
      unsub = undefined
      if (heartbeat) {
        clearInterval(heartbeat)
        heartbeat = undefined
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
})

api.openapi(listArtifactsRoute, requireAuthMiddleware(), listArtifacts(store))
api.openapi(getArtifactRoute, requireAuthMiddleware(), getArtifact(store))

// ---------------------------------------------------------------------------
// Durable replay SSE endpoint — same wire format as the in-memory
// `streamWorkspaceRoute` above, but backed by the append-only JSONL log
// so reconnecting clients can replay events from any point in history,
// not just the last 64.
//
// Mounted under /api/workspaces/:id/stream-durable (and /api/v1/...) so
// the two endpoints can coexist during the migration. The handler is
// created via `createSseHandler` from `sse-replay.ts`.
// ---------------------------------------------------------------------------
const durableSseHandler = createSseHandler(
  { forWorkspace: (id: string) => eventLogRegistry.for(id) },
  {
    subscribe: (id, cb) => workspaceEventBus.subscribe(id, cb),
    onConnect: async (id) => {
      try {
        const ws = await store.loadWorkspace(id)
        if (ws) return { type: "workspace", workspace: ws } as Record<string, unknown>
      } catch (err) {
        log.warn({ err, workspaceId: id }, "durable sse onConnect failed")
      }
      return null
    },
  },
)
versionedRoute("get", "/workspaces/:id/stream-durable", durableSseHandler)

// ---------------------------------------------------------------------------
// Webhook / SSE subscriptions — public customer-facing surface.
// ---------------------------------------------------------------------------
import {
  createSubscriptionRoute,
  listSubscriptionsRoute,
  deleteSubscriptionRoute,
  streamEventsRoute,
  createSubscription,
  listSubscriptions,
  deleteSubscription,
  registerSseClient,
  unregisterSseClient,
  publishEvent,
} from "./routes/subscriptions.js"

api.openapi(createSubscriptionRoute, requireAuthMiddleware(), async (c) => {
  const { type, target, events } = c.req.valid("json")
  const auth = c.get("auth" as never) as { userId?: string } | undefined
  const tenantId = c.get("tenantId" as never) as string | undefined
  const sub = createSubscription({ type, target, events, createdBy: auth?.userId, tenantId })
  return c.json(sub, 201)
})

api.openapi(listSubscriptionsRoute, requireAuthMiddleware(), async (c) => {
  const tenantId = c.get("tenantId" as never) as string | undefined
  // Strip the signing secret from list responses. The secret is only
  // returned once at creation time; exposing it here would let tenant A
  // read tenant B's webhook key for any global (tenantId-less) subscription.
  const subs = listSubscriptions(tenantId).map(({ secret: _secret, ...rest }) => rest)
  return c.json({ subscriptions: subs })
})

api.openapi(deleteSubscriptionRoute, requireAuthMiddleware(), async (c) => {
  const { id } = c.req.valid("param")
  const tenantId = c.get("tenantId" as never) as string | undefined
  const ok = deleteSubscription(id, tenantId)
  return ok ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
})

// SSE stream for global events (webhook alternative — no setup, no HMAC).
api.openapi(streamEventsRoute, requireAuthMiddleware(), async (c) => {
  const eventsParam = c.req.query("events")
  const events = eventsParam ? eventsParam.split(",").map((s) => s.trim()) : []
  const tenantId = c.get("tenantId" as never) as string | undefined

  const encoder = new TextEncoder()
  const id = `sse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const client = {
        id,
        events,
        tenantId, // auth context — used by publishEvent to scope events per-tenant
        send: (data: string) => {
          if (closed) return
          controller.enqueue(encoder.encode(data))
        },
        close: () => {
          closed = true
          unregisterSseClient(id)
          controller.close()
        },
      }
      registerSseClient(client)

      // Heartbeat every 15s so proxies don't drop idle connections.
      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`))
        } catch {
          closed = true
          unregisterSseClient(id)
          clearInterval(heartbeat)
        }
      }, 15_000)

      controller.enqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify({ id })}\n\n`))

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unregisterSseClient(id)
        try {
          controller.close()
        } catch {}
      }

      c.req.raw.signal.addEventListener("abort", cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
})

// publishEvent is called from the runtime event subscriber above to
// forward runtime events to webhook/SSE subscribers.

// Evolution routes
if (evolution) {
  const evo = evolutionRoutes({ facade: evolution })
  api.openapi(listMetricsRoute, requireAuthMiddleware(), evo.listMetrics)
  api.openapi(getMetricRoute, requireAuthMiddleware(), evo.getMetric)
  api.openapi(listAgentsRoute, requireAuthMiddleware(), evo.listAgents)
  api.openapi(getAgentRoute, requireAuthMiddleware(), evo.getAgent)
  api.openapi(leaderboardRoute, requireAuthMiddleware(), evo.leaderboard)
  api.openapi(leaderboardForRoleRoute, requireAuthMiddleware(), evo.leaderboardForRole)
  api.openapi(listVersionsRoute, requireAuthMiddleware(), evo.listVersions)
  api.openapi(listDecisionsRoute, requireAuthMiddleware(), evo.listDecisions)
  api.openapi(recordFeedbackRoute, requireAuthMiddleware(), evo.recordFeedback)
  api.openapi(triggerEvolveRoute, requireAuthMiddleware(), evo.triggerEvolve)
}

// Phase 5.7 — Learning Dashboard
if (learningApi) {
  const lr = learningRoutes({ api: learningApi })
  api.openapi(learningStatusRoute, requireAuthMiddleware(), lr.status)
  api.openapi(learningAgentsRoute, requireAuthMiddleware(), lr.agents)
  api.openapi(learningEvolutionHistoryRoute, requireAuthMiddleware(), lr.evolutionHistory)
  api.openapi(learningFailurePatternsRoute, requireAuthMiddleware(), lr.failurePatterns)
  api.openapi(learningMineFailurePatternsRoute, requireAuthMiddleware(), lr.mineFailurePatterns)
}

// Phase 5.1 — Execution History
if (executionStore) {
  const er = executionRoutes({ store: executionStore })
  api.openapi(listExecutionsRoute, requireAuthMiddleware(), er.listAll)
  api.openapi(listExecutionsForWorkspaceRoute, requireAuthMiddleware(), er.listForWorkspace)
  api.openapi(listExecutionsForRoleRoute, requireAuthMiddleware(), er.listForRole)
  api.openapi(getExecutionRoute, requireAuthMiddleware(), er.get)
  api.openapi(appendExecutionFeedbackRoute, requireAuthMiddleware(), er.appendFeedback)
}

// Phase 6 — Meta-System routes
if (metaOrchestrator && metaGovernance && metaOrgMemory && metaSimulation) {
  const mr = metaRoutes({
    orchestrator: metaOrchestrator,
    governance: metaGovernance,
    organizationMemory: metaOrgMemory,
    simulation: metaSimulation,
    registry: metaRegistry!,
    discovery: metaDiscovery!,
  })
  api.openapi(listCapabilitiesRoute, requireAuthMiddleware(), mr.listCapabilities)
  api.openapi(getCapabilityRoute, requireAuthMiddleware(), mr.getCapability)
  api.openapi(listProposalsRoute, requireAuthMiddleware(), mr.listProposals)
  api.openapi(runCycleRoute, requireAuthMiddleware(), mr.runCycle)
  api.openapi(listEventsRoute, requireAuthMiddleware(), mr.listEvents)
  api.openapi(countEventsRoute, requireAuthMiddleware(), mr.countEvents)
  api.openapi(checkGovernanceRoute, requireAuthMiddleware(), mr.checkGovernance)
  api.openapi(simulateRoute, requireAuthMiddleware(), mr.simulate)
  api.openapi(compareSimulationsRoute, requireAuthMiddleware(), mr.compareSimulations)
  api.openapi(getGovernanceConfigRoute, requireAuthMiddleware(), mr.getGovernanceConfig)
  api.openapi(
    putGovernanceConfigRoute,
    requireAuthMiddleware(),
    requireRole("admin"),
    mr.putGovernanceConfig,
  )
}

// Phase 10 — Observability routes
if (telemetry) {
  const or = obsRoutes({ telemetry })
  api.openapi(listObsExecutionsRoute, requireAuthMiddleware(), or.listExecutions)
  api.openapi(listObsEvolutionsRoute, requireAuthMiddleware(), or.listEvolutions)
  api.openapi(lineageByRoleRoute, requireAuthMiddleware(), or.lineageByRole)
}

// Usage aggregation routes — depend on evolution.metrics. When evolution is
// disabled we return 503 so the frontend can detect "metrics off" cleanly.
const ur = usageRoutes({ evolution })
api.openapi(usageSummaryRoute, requireAuthMiddleware(), ur.summary)
api.openapi(usageDailyRoute, requireAuthMiddleware(), ur.daily)
api.openapi(usageLatencyRoute, requireAuthMiddleware(), ur.latency)

// Phase 11 — Visualizer adapter endpoints
if (telemetry) {
  const visualizer = new VisualizerAdapter(
    () => telemetry.listExecutions(),
    () => telemetry.listEvolutions(),
  )
  api.openapi(obsGraphRoute, async (c) => {
    const graph = visualizer.getUIReadyGraph(c.req.param("executionId"))
    if (!graph) return c.json({ error: "not_found" }, 404)
    return c.json(graph)
  })
  api.openapi(obsTimelineRoute, async (c) => {
    return c.json(visualizer.getEvolutionTimeline())
  })
}

// Phase 11 — HITL Governance routes
if (metaPendingStore && metaRollout && metaGovernance && metaOrgMemory && metaBirth) {
  const gov = govRoutes({
    pendingStore: metaPendingStore,
    rollout: metaRollout,
    registry: metaRegistry!,
    birth: metaBirth,
    governance: metaGovernance,
    orgMemory: metaOrgMemory,
    manualSaveBlueprint: config.DIGITAL_TWIN_ENABLED
      ? (bp: Parameters<typeof blueprintStore.save>[0]) => blueprintStore.save(bp)
      : undefined,
    manualRetireBlueprint: config.DIGITAL_TWIN_ENABLED
      ? (id: string) => blueprintStore.retire(id)
      : undefined,
    telemetry: telemetry ?? undefined,
  })
  api.use("/gov/*", requireAuthMiddleware())
  api.openapi(listPendingProposalsRoute, (c) => gov.listPending(c))
  api.openapi(resolveProposalRoute, (c) => gov.resolveProposal(c))
}

// Permissions — file-backed store at $rootDir/permissions.json (defaults to
// ~/.maximilian). Always mounted; reads return defaults when the file is
// missing. Auth-gated because the rules are read by the runtime gate.
// Tenant isolation helper for permission/approval answer routes: loads
// the workspace with the caller's tenantId scope. If the workspace doesn't
// belong to the tenant (or doesn't exist), loadWorkspace returns undefined
// and the route returns 403. Without this check, tenant B could answer
// tenant A's pending prompts just by guessing the requestId.
const checkWorkspaceTenant = async (
  workspaceId: string,
  tenantId: string | undefined,
): Promise<boolean> => {
  const ws = await store.loadWorkspace(workspaceId, tenantId)
  return ws !== undefined && ws !== null
}

const perm = permissionsRoutes({
  runtime: {
    resolvePermission: (requestId, decision) => runtime.resolvePermission(requestId, decision),
    getPendingPermission: (requestId) => runtime.getPendingPermission(requestId),
    getPermissionAudit: (query) => runtime.getPermissionAudit(query),
    countPermissionAudit: (opts) => runtime.permissionAuditLog.countMatching(opts),
  },
  checkWorkspaceTenant,
})
api.use("/permissions/*", requireAuthMiddleware())
api.openapi(getPermissionsRoute, perm.get)
api.openapi(putPermissionsRoute, perm.put)
api.openapi(resolvePermissionRoute, perm.resolve)
api.openapi(testPermissionRoute, perm.test)
api.openapi(resetPermissionsRoute, perm.reset)
api.openapi(answerPermissionRoute, perm.answer)
api.openapi(auditPermissionsRoute, perm.audit)

const approvals = approvalRoutes({
  runtime: {
    resolveApproval: resolveApprovalAcrossRuntimes,
    getPendingApproval: (requestId) => approvalRuntimeRegistry.getPendingApproval(requestId),
  },
  checkWorkspaceTenant,
})
api.use("/approvals/*", requireAuthMiddleware())
api.openapi(answerApprovalRoute, approvals.answer)

// Phase 4c — Opencode bridge observation routes (read-only).
// The supervisor + EventBridge are injected when present (Phase 4b wiring),
// otherwise the routes still serve a useful view from the EventStore alone.
import {
  opencodeRoutes,
  listOpencodeSessionsRoute,
  getOpencodeSessionRoute,
  opencodeHealthRoute,
  opencodeEventsRoute,
} from "./routes/opencode.js"
import { getOpencodeStateStore } from "./opencode-state-store.js"
import type { EventBridge } from "@max/core-thin-sdk"

let opencodeBridge: EventBridge | undefined
const opencodeRouter = opencodeRoutes({
  // `supervisor` and `opencodeBridge` are set by Phase 4b once it boots
  // the opencode serve process. Until then the health endpoint reports
  // `not_configured` and the session list falls back to the rebuilt
  // EventStore projection.
  bridgeSnapshot: () => {
    if (!opencodeBridge) {
      return {
        state: "not_configured",
        metrics: {
          eventsReceived: 0,
          eventsMapped: 0,
          eventsAppended: 0,
          eventsDropped: 0,
          reconnects: 0,
          heartbeatTimeouts: 0,
        },
      }
    }
    const m = opencodeBridge.getMetrics()
    return {
      state: opencodeBridge.getState(),
      metrics: {
        eventsReceived: m.eventsReceived,
        eventsMapped: m.eventsMapped,
        eventsAppended: m.eventsAppended,
        eventsDropped: m.eventsDropped,
        reconnects: m.reconnects,
        heartbeatTimeouts: m.heartbeatTimeouts,
      },
    }
  },
})

// Exported so Phase 4b can wire the live supervisor + bridge into this
// module without a circular import.
export function __registerOpencodeBridge(bridge: EventBridge | undefined): void {
  opencodeBridge = bridge
  if (bridge) {
    const stateStore = getOpencodeStateStore()
    // Mirror every persisted event into the projection store. The bridge
    // already buffers + dedupes; the projection is a passive consumer.
    bridge.on("error", (err) => log.warn({ err }, "opencode bridge error"))
    log.info(
      {
        eventsReceived: bridge.getMetrics().eventsReceived,
        state: bridge.getState(),
      },
      "opencode bridge registered",
    )
    void stateStore
  }
}

api.openapi(listOpencodeSessionsRoute, opencodeRouter.listSessions)
api.openapi(getOpencodeSessionRoute, opencodeRouter.getSession)
api.openapi(opencodeHealthRoute, opencodeRouter.health)
api.openapi(opencodeEventsRoute, opencodeRouter.events)

// Mount the API routes under both /api/ and /api/v1/
app.route("/api", api)
app.route("/api/v1", api)

// ---------------------------------------------------------------------------
// OpenAPI / Swagger UI — auto-generated from zod-openapi route definitions
// ---------------------------------------------------------------------------

app.get("/api/openapi.json", (c) =>
  c.json(
    api.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Maximilian API",
        version: "0.1.0",
        description:
          "Meta-agent OS API. Submit user requests, observe execution, manage governance, and configure tool permissions.",
      },
      servers: [
        { url: "/api", description: "Current host" },
        { url: "/api/v1", description: "Versioned" },
      ],
      tags: [
        { name: "chat", description: "Submit user requests" },
        { name: "workspaces", description: "Submit requests and read workspace state" },
        { name: "auth", description: "JWT authentication (register, login, refresh, logout)" },
        { name: "tenants", description: "Multi-tenant organization management" },
        {
          name: "evolution",
          description: "Agent evolution engine — metrics, leaderboard, feedback",
        },
        { name: "executions", description: "Execution history and feedback" },
        {
          name: "learning",
          description: "Learning dashboard — failure patterns, evolution history",
        },
        {
          name: "meta",
          description: "Meta-system — capabilities, proposals, governance, simulation",
        },
        { name: "observability", description: "Execution traces, evolution timeline, lineage" },
        { name: "usage", description: "Token usage, cost, and latency aggregation" },
        { name: "governance", description: "HITL proposal approval/rejection" },
        { name: "approvals", description: "Runtime human approval checkpoints" },
        { name: "opencode", description: "Opencode bridge observation (sessions, health, SSE)" },
        { name: "permissions", description: "OpenCode-style tool permission configuration" },
        { name: "system", description: "Health, readiness, providers" },
      ],
    }),
  ),
)
app.get(
  "/api/docs",
  swaggerUI({
    url: "/api/openapi.json",
    title: "Maximilian API",
  }),
)

// Prometheus metrics endpoint — restricted to ADMIN_TOKEN bearer auth.
// NOT mirrored under /api/v1/ — it's an operational endpoint, not user API.
app.get("/api/metrics", async (c) => {
  const expected = config.ADMIN_TOKEN
  if (expected) {
    const header = c.req.header("Authorization") ?? ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : ""
    if (token !== expected) {
      return c.json({ error: "unauthorized" }, 401)
    }
  } else if (config.NODE_ENV === "production") {
    return c.json({ error: "metrics endpoint requires ADMIN_TOKEN" }, 503)
  }
  const body = await collectMetrics()
  return new Response(body, {
    headers: { "Content-Type": metricsContentType(), "Cache-Control": "no-store" },
  })
})

// ---------------------------------------------------------------------------
// Phase 7 — Meta-system auto-trigger helpers
// ---------------------------------------------------------------------------

function extractDiscoverySignals(workspace: import("@max/core").Workspace): DiscoverySignal[] {
  const signals: DiscoverySignal[] = []
  signals.push({
    text: workspace.userRequest,
    context: `workspace:${workspace.id}:userRequest`,
    source: "user_request_analysis",
  })
  for (const r of workspace.results) {
    if (typeof r.output === "string" && r.output.length > 0) {
      signals.push({
        text: r.output.slice(0, 500),
        context: `workspace:${workspace.id}:result:${r.taskId}`,
        source: "user_request_analysis",
      })
    }
  }
  return signals
}

function workspaceToGraphs(
  workspace: import("@max/core").Workspace,
): import("@max/dags").TeamGraph[] {
  const tasks = workspace.plan?.tasks ?? []
  if (tasks.length === 0) return []
  return [
    {
      id: `graph-${workspace.id}`,
      userRequest: workspace.userRequest,
      capabilities: Array.from(new Set(tasks.map((t) => t.agentRole))),
      nodes: tasks.map((t) => ({
        id: t.id,
        blueprintId: t.id,
        role: t.agentRole,
        displayName: t.agentRole,
        dependsOn: t.dependsOn,
      })),
      edges: [],
      layers: [],
      createdAt: workspace.createdAt,
      status: workspace.status === "completed" ? "completed" : "draft",
    },
  ]
}

async function syncRegistryToDags(
  registry: CapabilityRegistry,
): Promise<import("@max/dags").Capability[]> {
  const active = await registry.listByStatus("active")
  return active.map((c): import("@max/dags").Capability => ({
    id: c.id,
    displayName: c.displayName,
    description: c.description || `Dynamic capability registered via CapabilityRegistry.`,
    category: "general",
    keywords: deriveKeywords(c.id, c.displayName),
    defaultGoal: `Deliver ${c.displayName} work for: {{userRequest}}`,
    promptTemplate: `You are a ${c.displayName} agent. Address: {{userRequest}}\n\nFollow standard best practices for ${c.displayName}.`,
    defaultTools: [],
    defaultConstraints: { outputFormat: "code" },
    dependsOn: [],
    tags: ["dynamic", "registry"],
  }))
}

function deriveKeywords(id: string, displayName: string): string[] {
  const idParts = id.split(/[_-]+/).filter((p) => p.length > 2)
  const nameParts = displayName
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 2)
  return Array.from(new Set([id, ...idParts, ...nameParts]))
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const port = config.PORT
log.info(
  {
    port,
    providers: registry
      .list()
      .map((p) => `${p.id}(${p.defaultModel})`)
      .join(", "),
  },
  "starting server",
)

const server = serve({ fetch: app.fetch, port })

// Graceful shutdown: stop accepting connections → drain queue → flush
// telemetry → close DB → exit. Everything that needs to wait for async
// work (telemetry spans, queue draining, DB pool) lives INSIDE the
// server.close() callback so we don't race the process exit.
function shutdown(signal: string) {
  log.info({ signal }, "shutting down")
  // Force exit after 10s if graceful close hangs.
  setTimeout(() => {
    log.warn("shutdown timed out, forcing exit")
    process.exit(1)
  }, 10_000).unref()

  server.close(async () => {
    // Each cleanup step is independently guarded so a partial failure
    // (e.g. queue.close throwing on an already-dead Redis connection)
    // doesn't skip the cleanup that runs after it. A single try/finally
    // around `process.exit(0)` would mask the late steps with an exit
    // before they ever ran.
    if (queue) {
      await queue.close().catch((err) => {
        log.error({ err }, "error closing queue")
      })
      log.info("queue closed")
    }
    // Flush telemetry (OTel spans, Prometheus metrics) BEFORE closing DB
    // so any final spans tied to DB writes can still report.
    await telemetry?.flush().catch((err) => {
      log.error({ err }, "error flushing telemetry")
    })
    log.info("telemetry flushed")
    // Close the durable event-log registry (flushes and releases file
    // handles). Without this, the open write handle for each workspace
    // leaks into the kernel.
    await eventLogRegistry.closeAll().catch((err) => {
      log.error({ err }, "error closing event-log registry")
    })
    log.info("event-log registry closed")
    // BullMQ's queue.close() also closes its ioredis connection, but if
    // the app owns a separate Redis connection (future), close it here.
    await closeDb().catch((err) => {
      log.error({ err }, "error closing DB")
    })
    log.info("db closed")
    process.exit(0)
  })
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
