/**
 * BullMQ Worker — processes workspace execution jobs from Redis.
 *
 * Mirrors the in-process execution logic from the API's chat route,
 * but runs as a separate process for horizontal scalability.
 *
 * Environment:
 *   REDIS_URL          — redis://host:port (required)
 *   DATABASE_URL       — PostgreSQL connection string (required)
 *   WORKSPACE_DIR      — directory for file-based workspace storage (fallback)
 *   OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY — LLM provider
 *   WORKER_CONCURRENCY — max concurrent jobs (default: 3)
 */

import { getConfig } from "@max/config"
import { getLogger, initOtel } from "@max/telemetry"
import { getRegistry, type Provider } from "@max/providers"
import {
  AgentRuntime,
  type RuntimeSink,
  type Workspace,
  FileMemoryStore,
  type ModelRouter,
  isPolicyDeniedMessage,
} from "@max/core"
import { defaultAgentFactory } from "@max/agents"
import { EvolutionFacade, evolutionAwareFactory, SealedFileVault } from "@max/evolution"
import {
  createDb,
  closeDb,
  PgWorkspaceStore,
  PgMetricsStore,
  getProviderConfigsFromDb,
} from "@max/database"
import { FileWorkspaceStore } from "@max/workspace"
import {
  createWorker,
  createWorkspaceEventPublisher,
  acquireResourceLease,
  type WorkspaceProcessor,
} from "@max/queue"
import { Gateway, createWebhookAdapter } from "@max/gateway"
import { bootstrapModelRouting } from "@max/core"
import type { Job } from "bullmq"
import type { WorkspaceJobData } from "@max/queue"

const log = getLogger("worker")

/**
 * Resolve the provider id from a "provider/model" string for metric labels.
 * Mirrors extractProvider() in apps/api — bare model names must NOT become
 * provider labels (high-cardinality bogus metrics).
 */
function extractProvider(model: string, candidates: Provider[]): string {
  if (!model) return "unknown"
  if (model.includes("/")) {
    const prefix = model.split("/")[0]
    return candidates.find((p) => p.id === prefix)?.id ?? "unknown"
  }
  return candidates.find((p) => p.id === model)?.id ?? "unknown"
}

async function main() {
  // Initialize OpenTelemetry (no-op if OTEL_ENABLED=false).
  // Must be called BEFORE other imports touch network/IO.
  initOtel({
    serviceName: "maximilian-worker",
    otlpEndpoint: getConfig().OTEL_EXPORTER_OTLP_ENDPOINT,
    enabled: getConfig().OTEL_ENABLED,
  })

  const config = getConfig()
  const redisUrl = config.REDIS_URL
  if (!redisUrl) {
    log.fatal("REDIS_URL is required for the worker process")
    process.exit(1)
  }

  if (!config.DATABASE_URL) {
    log.fatal(
      "DATABASE_URL is required for the worker process (file-based storage not supported for queue mode)",
    )
    process.exit(1)
  }

  // Wire up stores.
  const db = createDb(config.DATABASE_URL)
  const store = new PgWorkspaceStore(db) as unknown as FileWorkspaceStore

  const registry = getRegistry()
  const providers = registry.list()
  const defaultProvider: Provider | undefined = providers[0]
  if (!defaultProvider) {
    log.fatal("No LLM provider configured")
    process.exit(1)
  }

  // Apply DB-stored provider config (same dynamic switching the API uses)
  // so the worker honors PUT /api/system/providers/* changes after restart.
  try {
    const configs = await getProviderConfigsFromDb(db)
    for (const [id, cfg] of configs) {
      registry.setProviderConfig(id, { defaultModel: cfg.defaultModel, enabled: cfg.enabled })
      if (cfg.defaultProvider) {
        registry.setDefaultProviderId(id)
      }
    }
    if (configs.size > 0) {
      log.info({ count: configs.size }, "loaded dynamic provider config from database (worker)")
    }
  } catch (err) {
    log.warn({ err }, "failed to load dynamic provider config from DB (worker); using env defaults")
  }

  // Provider registry: id → Provider for dynamic model selection.
  const providerRegistry = new Map<string, Provider>()
  for (const p of providers) providerRegistry.set(p.id, p)

  const factory = defaultAgentFactory(() => registry.default()!, providerRegistry)

  // Optional evolution engine — when ON, evolutionAwareFactory handles
  // both memory injection and model selection internally. Hoisted to
  // function scope so the runtime event listener and the job processor
  // can feed it (metrics, curator, reflection, evolution decisions).
  let finalFactory = factory
  let evolution: EvolutionFacade | undefined
  if (config.EVOLUTION_ENABLED) {
    // Sealed-file vault: same guard as the API — evolution cycles refuse
    // to run when a sealed benchmark/eval file changed mid-process. The
    // manifest is re-sealed at boot (the seal protects this process's
    // evolution window).
    let sealedVault: SealedFileVault | undefined
    if (config.EVOLUTION_SEALED_DIR) {
      sealedVault = new SealedFileVault(config.EVOLUTION_SEALED_DIR)
      await sealedVault.seal(["**/*"]).catch((err) => {
        log.warn(
          { err, dir: config.EVOLUTION_SEALED_DIR },
          "failed to seal evolution dir — guard disabled this boot",
        )
        sealedVault = undefined
      })
    }
    evolution = new EvolutionFacade({
      rootDir: config.WORKSPACE_DIR,
      candidates: providers,
      fallbackProvider: defaultProvider,
      defaultManifests: {},
      // The worker is PG-only (see startup check below), so metrics go to
      // Postgres — the file store here would fragment learning state
      // across worker hosts.
      metricsStore: new PgMetricsStore(db),
      ...(sealedVault ? { sealedVault } : {}),
    })
    await evolution.initialize()
    finalFactory = evolutionAwareFactory(evolution)
    log.info("evolution engine: ON (worker)")
  }

  // Tenant cache: the sink is created once at startup but each job
  // scopes to a different tenant. The processor seeds this map before
  // runtime.execute so the sink can scope its read/write calls.
  const tenantCache = new Map<string, string | undefined>()
  // Cap the cache so a long-lived worker processing unbounded workspace
  // ids doesn't grow the map forever. Insertion order = oldest first,
  // so evict from the front. A miss after eviction is safe: it just
  // falls back to the unscoped (NULL-tenant) store path.
  const TENANT_CACHE_MAX = 1024
  function tenantCacheSet(id: string, tenantId: string | undefined): void {
    if (!tenantCache.has(id) && tenantCache.size >= TENANT_CACHE_MAX) {
      const oldest = tenantCache.keys().next().value
      if (oldest !== undefined) tenantCache.delete(oldest)
    }
    tenantCache.set(id, tenantId)
  }

  const sink: RuntimeSink = {
    // Worker bridge: read tenantId from workspace.metadata (set by the
    // API before enqueueing the job). The runtime itself is tenant-blind.
    saveWorkspace: async (ws) => {
      const tenantId =
        (ws.metadata?.tenantId as string | null | undefined) ?? tenantCache.get(ws.id) ?? undefined
      tenantCacheSet(ws.id, tenantId ?? undefined)
      return store.saveWorkspace(ws, tenantId ?? undefined)
    },
    loadWorkspace: async (id) => {
      const tenantId = tenantCache.get(id)
      // Cache miss falls back to no tenant scope. This matches legacy
      // behaviour for orphaned workspaces and is safer than guessing.
      return store.loadWorkspace(id, tenantId)
    },
  }

  // Runtime port adapters (used only when evolution is OFF).
  let memoryStorePort: import("@max/core").AgentMemoryStorePort | undefined
  if (!config.EVOLUTION_ENABLED) {
    const fileStore = new FileMemoryStore({ rootDir: config.WORKSPACE_DIR })
    await fileStore.init()
    memoryStorePort = fileStore
    log.info("memory store: file-backed (worker, no evolution)")
  }
  const modelRouting = config.EVOLUTION_ENABLED ? null : bootstrapModelRouting(providers)
  const modelSelectorPort: import("@max/core").ModelSelectorPort | undefined =
    modelRouting?.selector
  const modelRouterPort: ModelRouter | undefined = modelRouting?.router

  const runtime = new AgentRuntime(finalFactory, sink, {
    memoryStore: memoryStorePort,
    modelSelector: modelSelectorPort,
    modelRouter: modelRouterPort,
  })

  // Runtime event forwarding. Two jobs:
  //  1. Evolution feeding — in queue mode the worker IS the execution
  //     process, so this is the only place recordCompletion / metrics /
  //     maybeEvolve can run. Without it the whole learning engine stays
  //     cold in the recommended deployment (mirror of the API's handler).
  //  2. Event backflow — publish every runtime event to Redis so the API
  //     can fan it out to SSE/webhook subscribers.
  const publishWorkspaceEvent = createWorkspaceEventPublisher(redisUrl)
  runtime.on(async (event) => {
    // 1. Backflow (always — even with evolution off, SSE clients need it).
    try {
      const tenantId =
        event.workspaceId != null ? (tenantCache.get(event.workspaceId) ?? undefined) : undefined
      await publishWorkspaceEvent({ workspaceId: event.workspaceId, tenantId, event })
    } catch (err) {
      log.warn({ err, workspaceId: event.workspaceId }, "workspace event publish failed")
    }

    // 2. Structured logging (previous behavior).
    if (event.type === "task-complete") {
      log.info({ taskId: event.taskId, workspaceId: event.workspaceId }, "task completed")
    } else if (event.type === "task-failed") {
      log.error(
        { taskId: event.taskId, workspaceId: event.workspaceId, error: event.error },
        "task failed",
      )
    }

    // 3. Evolution feeding (mirror of apps/api runtime listener).
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
        reviewScore: meta.review?.score,
        defaultManifest: {
          role: result.agentRole,
          displayName: result.agentRole,
          goal: "",
          systemPrompt: "",
        },
      })
    } else if (event.type === "task-failed") {
      // Governance rejections are the permission system working as
      // designed — keep them out of the failure-mode metrics (same
      // exclusion as recordCompletion and the API's task-failed branch).
      if (isPolicyDeniedMessage(event.error)) return
      await evolution.metrics.record({
        taskId: event.taskId,
        agentId: "unknown",
        agentRole: "general",
        provider: defaultProvider.id,
        model: defaultProvider.defaultModel,
        executionTime: 0,
        tokenInput: 0,
        tokenOutput: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        retryCount: 0,
        error: event.error,
        timestamp: new Date().toISOString(),
      })
      await evolution.leaderboard.rebuild(evolution.metrics)
    } else if (event.type === "done") {
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
            "evolution decision (worker)",
          )
        }
      }
    }
  })

  // The processor function: called by BullMQ for each job.
  const processor: WorkspaceProcessor = async (
    workspaceId: string,
    mode: "commander" | "dags",
    tenantId: string | undefined,
    resourceBudget,
  ) => {
    log.info(
      { workspaceId, mode, tenantId: tenantId ?? "dev", resourceBudget },
      "processing workspace job",
    )

    // Load with the job's tenant scope. Without this, a dev-mode worker
    // would refuse to surface tenant-owned workspaces and execution
    // would silently never start.
    tenantCacheSet(workspaceId, tenantId)
    const workspace = await store.loadWorkspace(workspaceId, tenantId)
    if (!workspace) {
      log.error({ workspaceId, tenantId }, "workspace not found — skipping job")
      return
    }

    if (workspace.status === "executing" || workspace.status === "reviewing") {
      // BullMQ retry path: a previous attempt crashed mid-execution and
      // left the workspace in a non-planning state. A fresh runtime cannot
      // resume `executing` directly - reset to `planning` so the runtime
      // re-enters its normal flow. Without this, the retry would skip and
      // leave the workspace permanently stuck while BullMQ marks the job done.
      log.warn(
        { workspaceId, status: workspace.status },
        "workspace left in mid-execution state (likely by a crashed worker); resetting to planning for retry",
      )
      workspace.status = "planning"
    } else if (workspace.status !== "planning") {
      log.warn({ workspaceId, status: workspace.status }, "workspace already terminal - skipping")
      return
    }

    // Propagate tenantId into the runtime via workspace.metadata so the
    // sink (above) can persist intermediate saves with the right scope.
    workspace.metadata = { ...(workspace.metadata ?? {}), tenantId: tenantId ?? null }

    const lease = await acquireResourceLease(redisUrl, resourceBudget)
    let final: Workspace
    try {
      final = await runtime.execute(workspace)
    } catch (err) {
      // Runtime threw - the workspace must NOT be left in planning/executing
      // or the user sees a permanently stuck state. Persist a `failed`
      // terminal state with the error message so they have something to
      // act on. Re-throw so BullMQ records the failure on the job itself.
      const message = (err as Error)?.message ?? String(err)
      log.error({ workspaceId, err: message }, "runtime.execute threw - marking workspace failed")
      const failed: Workspace = {
        ...workspace,
        status: "failed",
        error: message,
        updatedAt: new Date().toISOString(),
      }
      try {
        await store.saveWorkspace(failed, tenantId)
      } catch (saveErr) {
        log.error(
          { workspaceId, err: saveErr },
          "failed to persist failed state after runtime error",
        )
      }
      throw err
    } finally {
      await lease.release()
    }

    // Persist review if present. The runtime already wrote the final
    // state via the sink — we just need to attach the review verdict
    // that lives in agent result metadata.
    const reviewResult = final.results.find((r) => r.agentRole === "review")
    const review = reviewResult?.metadata?.review as import("@max/core").ReviewResult | undefined
    if (review) {
      final.review = review
      await store.saveWorkspace(final, tenantId)
    }
    log.info({ workspaceId, status: final.status }, "workspace execution complete")
  }

  // Create and start the BullMQ worker.
  const concurrency = Number(config.WORKER_CONCURRENCY ?? 3)
  const { worker, stopHeartbeat } = createWorker(redisUrl, processor, concurrency)

  worker.on("ready", () => {
    log.info({ concurrency, redisUrl: redisUrl.replace(/\/\/.*@/, "//***@") }, "worker ready")
  })

  worker.on("failed", (job: Job<WorkspaceJobData> | undefined, err: Error) => {
    log.error(
      { jobId: job?.id, workspaceId: job?.data.workspaceId, err: err.message },
      "job failed",
    )
  })

  // Notification egress (openclaw gateway borrowing): when a channel is
  // configured (GATEWAY_WEBHOOK_URL), completion events flow out through
  // the gateway so humans on chat channels learn a workspace finished
  // without polling the dashboard.
  const gatewayWebhookUrl = process.env.GATEWAY_WEBHOOK_URL
  const notificationGateway = gatewayWebhookUrl
    ? new Gateway().registerAdapter(
        createWebhookAdapter({
          url: gatewayWebhookUrl,
          token: process.env.GATEWAY_WEBHOOK_TOKEN,
        }),
      )
    : undefined

  worker.on("completed", (job: Job<WorkspaceJobData>) => {
    log.info({ jobId: job.id, workspaceId: job.data.workspaceId }, "job completed")
    if (notificationGateway) {
      const workspaceId = job.data.workspaceId
      notificationGateway.notify({
        channel: "webhook",
        recipientId: process.env.GATEWAY_NOTIFY_RECIPIENT ?? "default",
        title: `Workspace ${workspaceId} completed`,
        body: `All tasks finished (job ${String(job.id)}).`,
        workspaceId,
        severity: "info",
      })
    }
  })

  worker.on("error", (err: Error) => {
    log.error({ err }, "worker error")
  })

  // Graceful shutdown. Each step is independently guarded so a partial
  // failure (e.g. queue.close throwing on an already-dead Redis
  // connection) doesn't skip the cleanup that runs after it. The
  // heartbeat is a separate Redis client owned by createWorker; without
  // calling stopHeartbeat it leaks across SIGTERM.
  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down worker")
    // Abort every in-flight runtime so parked permission/approval prompts
    // reject, agent.execute calls unwind, and BullMQ doesn't have to wait
    // for the stalled-job detector to re-enqueue work that k8s was about
    // to SIGKILL anyway. Without this, a 30s k8s grace period ends in
    // SIGKILL, the job goes stalled, and the workspace re-runs from
    // scratch on the next worker - duplicating side effects and API calls.
    try {
      runtime.abortAll()
    } catch (err) {
      log.error({ err }, "error aborting in-flight runtimes during shutdown")
    }
    try {
      if (notificationGateway) {
        await notificationGateway.close().catch(() => {})
      }
      await worker.close().catch((err) => {
        log.error({ err }, "error closing worker")
      })
      stopHeartbeat()
      await closeDb().catch((err) => {
        log.error({ err }, "error closing DB")
      })
      log.info("worker shutdown complete")
      process.exit(0)
    } catch (err) {
      log.error({ err }, "error during shutdown")
      process.exit(1)
    }
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))
}

main().catch((err) => {
  log.fatal({ err }, "worker failed to start")
  process.exit(1)
})
