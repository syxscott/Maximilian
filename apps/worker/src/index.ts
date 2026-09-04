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
} from "@max/core"
import { defaultAgentFactory } from "@max/agents"
import { EvolutionFacade, evolutionAwareFactory } from "@max/evolution"
import { createDb, closeDb, PgWorkspaceStore, getProviderConfigsFromDb } from "@max/database"
import { FileWorkspaceStore } from "@max/workspace"
import { createWorker, acquireResourceLease, type WorkspaceProcessor } from "@max/queue"
import { Gateway, createWebhookAdapter } from "@max/gateway"
import { bootstrapModelRouting } from "@max/core"
import type { Job } from "bullmq"
import type { WorkspaceJobData } from "@max/queue"

const log = getLogger("worker")

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
  // both memory injection and model selection internally.
  let finalFactory = factory
  if (config.EVOLUTION_ENABLED) {
    const evolution = new EvolutionFacade({
      rootDir: config.WORKSPACE_DIR,
      candidates: providers,
      fallbackProvider: defaultProvider,
      defaultManifests: {},
    })
    await evolution.initialize()
    finalFactory = evolutionAwareFactory(evolution)
    log.info("evolution engine: ON (worker)")
  }

  const sink: RuntimeSink = {
    // Worker bridge: read tenantId from workspace.metadata (set by the
    // API before enqueueing the job). The runtime itself is tenant-blind.
    saveWorkspace: async (ws) => {
      const tenantId = (ws.metadata?.tenantId as string | null | undefined) ?? undefined
      return store.saveWorkspace(ws, tenantId ?? undefined)
    },
    loadWorkspace: async (id) => store.loadWorkspace(id),
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

  // Runtime event listener: log task completion.
  runtime.on((event) => {
    if (event.type === "task-complete") {
      log.info({ taskId: event.taskId, workspaceId: event.workspaceId }, "task completed")
    } else if (event.type === "task-failed") {
      log.error(
        { taskId: event.taskId, workspaceId: event.workspaceId, error: event.error },
        "task failed",
      )
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
