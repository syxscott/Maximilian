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

    if (workspace.status !== "planning") {
      log.warn(
        { workspaceId, status: workspace.status },
        "workspace not in planning state — skipping",
      )
      return
    }

    // Propagate tenantId into the runtime via workspace.metadata so the
    // sink (above) can persist intermediate saves with the right scope.
    workspace.metadata = { ...(workspace.metadata ?? {}), tenantId: tenantId ?? null }

    const lease = await acquireResourceLease(redisUrl, resourceBudget)
    let final: Workspace
    try {
      final = await runtime.execute(workspace)
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

  worker.on("completed", (job: Job<WorkspaceJobData>) => {
    log.info({ jobId: job.id, workspaceId: job.data.workspaceId }, "job completed")
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
    try {
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
