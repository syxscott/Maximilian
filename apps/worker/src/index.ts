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
 *   PARK_YIELD_ENABLED — release the BullMQ slot while a run waits on a
 *                        human decision (default: true; OAC worker.go:277
 *                        borrowing, see src/park-yield.ts)
 */

import path from "node:path"
import { getConfig } from "@max/config"
import { getLogger, initOtel } from "@max/telemetry"
import { getRegistry, type Provider } from "@max/providers"
import { loadProviderCredentialsFromVault } from "@max/core"
import {
  AgentRuntime,
  type RuntimeSink,
  type Workspace,
  FileMemoryStore,
  type ModelRouter,
  isPolicyDeniedMessage,
} from "@max/core"
import { createDefaultAgentFactory } from "@max/agents"
import { EvolutionFacade, evolutionAwareFactory, SealedFileVault } from "@max/evolution"
import {
  AutonomyOrchestrator,
  CandidateGenerator,
  EvolutionPlanner,
  FailurePatternAnalyzer,
  PromotionEngine,
  ReviewIntelligence,
} from "@max/autonomy"
import { withGoalJudgement } from "@max/meta-system"
import { DAGS } from "@max/dags"
import {
  createDb,
  closeDb,
  PgWorkspaceStore,
  PgMetricsStore,
  PgBlueprintStore,
  PgExecutionStore,
  PgInsightsStore,
  getProviderConfigsFromDb,
} from "@max/database"
import { FileWorkspaceStore } from "@max/workspace"
import {
  createWorker,
  createQueue,
  createWorkspaceEventPublisher,
  acquireResourceLease,
  CrashBudget,
  crashCategoryOfClassification,
  recoverStalledJobs,
  subscribeWorkspaceStop,
  type WorkspaceProcessor,
} from "@max/queue"
import { Gateway, createWebhookAdapter } from "@max/gateway"
import { Commander, type ModelSelectorPort as CommanderModelSelectorPort } from "@max/commander"
import { AutoResumeSuppressedError, bootstrapModelRouting, classifyError } from "@max/core"
import type { Job } from "bullmq"
import type { WorkspaceJobData } from "@max/queue"
import {
  asScheduledExtras,
  materializeScheduledWorkspace,
  type ScheduledJobExtras,
} from "./jobs-materialize.js"
import {
  DetachedRunRegistry,
  ParkSignal,
  executeUntilPark,
  type ParkStateInfo,
  type ParkYieldOutcome,
} from "./park-yield.js"

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

  // Vault-sourced provider credentials (see apps/api for the rationale):
  // merged into env before the registry singleton is created.
  const vaultCredentials = await loadProviderCredentialsFromVault()
  if (Object.keys(vaultCredentials).length > 0) {
    Object.assign(process.env, vaultCredentials)
    log.info(
      { providers: Object.keys(vaultCredentials).length },
      "provider credentials loaded from vault",
    )
  }

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

  const factory = await createDefaultAgentFactory(() => registry.default()!, providerRegistry)

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
      lessonGating: config.LESSON_GATING,
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

  // Autonomy closed loop (Phase 5 parity with the API): in queue mode the
  // worker IS the executing process, so `observe` must run here — the
  // API's own observe calls never see queue-mode workspaces. Without this
  // the execution records / structured reviews / promotion pipeline stay
  // cold for every queued run.
  let orchestrator: AutonomyOrchestrator | undefined
  if (config.DAGS_MODE) {
    if (!evolution) {
      log.warn("DAGS_MODE without EVOLUTION_ENABLED — autonomy observe disabled (worker)")
    } else {
      const workerBlueprintStore = new PgBlueprintStore(
        db,
      ) as unknown as import("@max/dags").BlueprintStore
      const dags = new DAGS({
        rootDir: config.WORKSPACE_DIR,
        evolution,
        candidates: providers,
        // Same cast pattern as the API: the Pg store satisfies the
        // BlueprintStore contract without extending the file class.
        store: workerBlueprintStore,
      })
      const insightsStore = new PgInsightsStore(
        db,
      ) as unknown as import("@max/autonomy").InsightsStore
      const candidateGenerator = new CandidateGenerator(config.WORKSPACE_DIR)
      const promotionEngine = new PromotionEngine(config.WORKSPACE_DIR, candidateGenerator)
      await promotionEngine.loadHistory()
      orchestrator = new AutonomyOrchestrator({
        dags,
        review: new ReviewIntelligence({ provider: registry.default()! }),
        executionStore: new PgExecutionStore(
          db,
        ) as unknown as import("@max/autonomy").ExecutionStore,
        insightsStore,
        failureAnalyzer: new FailurePatternAnalyzer(insightsStore),
        planner: new EvolutionPlanner(config.WORKSPACE_DIR),
        candidateGenerator,
        promotionEngine,
        // Promotion write-back (see apps/api for the rationale).
        applyPromotion: async (candidate, record) => {
          const parent = await workerBlueprintStore.get(candidate.parentBlueprintId)
          if (!parent) return
          await workerBlueprintStore.save({
            ...parent,
            systemPrompt: candidate.systemPrompt,
            version: candidate.version,
            metadata: {
              ...((parent.metadata as Record<string, unknown>) ?? {}),
              promotedBy: record.id,
              promotedAt: record.promotedAt,
            },
          })
        },
      })
      log.info("autonomy orchestrator: ON (worker)")
    }
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

  // Park-yield (borrowing; OpenAgentCore worker.go:277 — see park-yield.ts).
  // When PARK_YIELD_ENABLED (default on), a queued run that parks on a
  // human decision releases its BullMQ slot: the processor races execute
  // against the runtime's parked edge, detaches the run (which keeps
  // living in the runtime's waiting registry — the in-process parked
  // promise is the wake channel, so the resumed turn continues from the
  // park point without re-running) and returns. The runtime's global park
  // hook fans out to the per-job signal of the job that owns the
  // workspace; entries are delete-on-settle so a detached run's LATER
  // parks are ignored (its slot was already released).
  const parkYieldEnabled = config.PARK_YIELD_ENABLED !== false
  const parkListeners = new Map<string, (info: ParkStateInfo) => void>()
  const detachedRuns = new DetachedRunRegistry()

  const runtime = new AgentRuntime(finalFactory, sink, {
    // Tool loop (minimax-code borrowing) — see the API entry for the flag.
    enableToolLoop: config.TOOL_LOOP_ENABLED,
    permissionAskTimeoutMs: config.PERMISSION_ASK_TIMEOUT_MS,
    memoryStore: memoryStorePort,
    modelSelector: modelSelectorPort,
    modelRouter: modelRouterPort,
    ...(parkYieldEnabled
      ? {
          onParkStateChange: (info: ParkStateInfo): void => {
            parkListeners.get(info.workspaceId)?.(info)
          },
        }
      : {}),
  })

  // Commander (POST /api/chat parity) — kind=workspace job fires arrive as
  // a bare `message`; materializing them into real workspaces goes through
  // the same planner the API's chat route uses, with the same
  // evolution-aware model selection when evolution is ON.
  const commanderModelSelector: CommanderModelSelectorPort | undefined = evolution
    ? {
        select(role) {
          const sel = evolution!.selectForRole(role)
          return { provider: sel.provider, model: sel.model, score: sel.score, reason: sel.reason }
        },
      }
    : undefined
  const commander = new Commander(() => registry.default()!, {
    providerRegistry,
    modelSelector: commanderModelSelector,
  })

  // Scheduled-fire extras in flight. BullMQ delivers the scheduler's
  // fields (message/jobId/scheduledAt) on job.data, but the shared
  // WorkspaceProcessor contract only passes workspaceId/mode/tenantId/
  // resourceBudget. BullMQ emits "active" for a job strictly before it
  // invokes the processor (run loop: getNextJob → emit → processJob), so
  // stashing here and taking inside the processor is race-free for this
  // consumer. Delete-on-read keeps the map bounded; a missed entry (job
  // data without a workspaceId) degrades to today's skip behaviour.
  const pendingScheduled = new Map<string, ScheduledJobExtras>()
  // Placeholder → real workspace id for fires this process materialized,
  // so the completed/failure logs and webhook notifications can name the
  // workspace that actually ran instead of the ws-sched-… placeholder.
  const materializedByScheduledId = new Map<string, string>()

  // Runtime event forwarding. Two jobs:
  //  1. Evolution feeding — in queue mode the worker IS the execution
  //     process, so this is the only place recordCompletion / metrics /
  //     maybeEvolve can run. Without it the whole learning engine stays
  //     cold in the recommended deployment (mirror of the API's handler).
  //  2. Event backflow — publish every runtime event to Redis so the API
  //     can fan it out to SSE/webhook subscribers.
  const publishWorkspaceEvent = createWorkspaceEventPublisher(redisUrl)

  // SQLite session store (M4 double-write): the worker is the executing
  // process in queue mode, so it is the single writer for conversation
  // turns, events and usage. The JSONL event log stays authoritative.
  let onSessionEvent: ((event: unknown) => void) | undefined
  if (config.SESSION_STORE_ENABLED) {
    try {
      const { SessionStore, createSessionRuntimeListener } = await import("@max/session-store")
      const sessionPath =
        config.SESSION_STORE_PATH ??
        path.join(
          config.EVENTS_DIR ?? path.join(config.WORKSPACE_DIR, "events"),
          "session-store.sqlite",
        )
      const s = new SessionStore({ path: sessionPath })
      s.migrate()
      onSessionEvent = createSessionRuntimeListener(s) as (event: unknown) => void
      log.info({ path: sessionPath }, "session store: ON")
    } catch (err) {
      log.warn({ err }, "session store unavailable — running without the SQLite side store")
    }
  }

  runtime.on(async (event) => {
    // 0. SQLite double-write (session-store wiring).
    if (onSessionEvent) {
      try {
        onSessionEvent(event)
      } catch (err) {
        log.warn({ err, workspaceId: event.workspaceId }, "session store write failed")
      }
    }

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

    // 2.5 Autonomy closed loop (worker parity): a queued workspace's only
    // chance to be observed is here, when its run completes.
    if (orchestrator && event.type === "done") {
      try {
        await orchestrator.observe(event.workspace)
      } catch (err) {
        log.warn({ err, workspaceId: event.workspaceId }, "orchestrator.observe failed (worker)")
      }
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

  // Post-execute steps shared by the synchronous path and the detached
  // (parked) path: review attach + goal judgement. The runtime already
  // wrote the final state via the sink — these only decorate it.
  const finalizeExecutedWorkspace = async (
    final: Workspace,
    tenantId: string | undefined,
  ): Promise<void> => {
    const reviewResult = final.results.find((r) => r.agentRole === "review")
    const review = reviewResult?.metadata?.review as import("@max/core").ReviewResult | undefined
    if (review) {
      final.review = review
      await store.saveWorkspace(final, tenantId)
    }
    // Goal-judge (hermes borrowing): grade the user's goal from the run's
    // outcome evidence and persist it under workspace.metadata. Best-effort —
    // a judgement failure must not fail the job after the work completed.
    try {
      const judged = await withGoalJudgement(final)
      if (judged !== final) await store.saveWorkspace(judged, tenantId)
    } catch (err) {
      log.warn({ workspaceId: final.id, err }, "goal judgement attach failed")
    }
  }

  // Processor parity for detached failures: a run that throws after its
  // slot was released must still leave a `failed` terminal state.
  const persistFailedWorkspace = async (
    workspace: Workspace,
    message: string,
    tenantId: string | undefined,
  ): Promise<void> => {
    const failed: Workspace = {
      ...workspace,
      status: "failed",
      error: message,
      updatedAt: new Date().toISOString(),
    }
    try {
      await store.saveWorkspace(failed, tenantId)
    } catch (saveErr) {
      log.error({ workspaceId: workspace.id, err: saveErr }, "failed to persist failed state")
    }
  }

  // Notification egress (openclaw gateway borrowing) — extracted so the
  // detached (parked) completion path can notify when the run ACTUALLY
  // finishes instead of when its job returned at park time. The job id is
  // unavailable on that path (the job completed at park time), so the body
  // omits it there.
  const sendCompletionNotification = (
    workspaceId: string,
    opts?: { scheduledWorkspaceId?: string; jobId?: string },
  ): void => {
    if (!notificationGateway) return
    const scheduledWorkspaceId = opts?.scheduledWorkspaceId
    notificationGateway.notify({
      channel: "webhook",
      recipientId: process.env.GATEWAY_NOTIFY_RECIPIENT ?? "default",
      title: `Workspace ${workspaceId} completed`,
      body: scheduledWorkspaceId
        ? `Scheduled job materialized workspace ${workspaceId}; all tasks finished.`
        : opts?.jobId
          ? `All tasks finished (job ${opts.jobId}).`
          : `All tasks finished.`,
      workspaceId,
      severity: "info",
    })
  }

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

    // Scheduled fire? Take (read + delete) the extras the "active" hook
    // stashed for this job before BullMQ invoked the processor.
    const scheduledExtras =
      workspaceId != null ? (pendingScheduled.get(workspaceId) ?? undefined) : undefined
    if (workspaceId != null) pendingScheduled.delete(workspaceId)

    // Load with the job's tenant scope. Without this, a dev-mode worker
    // would refuse to surface tenant-owned workspaces and execution
    // would silently never start.
    tenantCacheSet(workspaceId, tenantId)
    const workspace = await store.loadWorkspace(workspaceId, tenantId)
    if (!workspace) {
      if (scheduledExtras) {
        // Scheduled fire for a not-yet-existing workspace: MATERIALIZE.
        // Runner mode — the workspace is created here through the same
        // commander/runtime path POST /api/chat uses (no HTTP), then
        // executed; the jobId→workspaceId backfill rides the existing
        // publishWorkspaceEvent channel (type "job-materialized").
        log.info(
          { workspaceId, jobId: scheduledExtras.jobId ?? "unknown" },
          "scheduled fire: materializing workspace from message",
        )
        const lease = await acquireResourceLease(redisUrl, resourceBudget)
        // The park listener is registered under the REAL materialized id
        // (inside the runner); track it so the finally below can always
        // clean up, whatever the outcome.
        let parkListenerWorkspaceId = workspaceId
        try {
          // Park-yield plumbing for the materialized run: the signal is
          // registered under the REAL workspace id inside the runner (the
          // placeholder id never parks — it does not exist), the detached
          // lifecycle lands in the shared registry (duplicate-dispatch
          // guard), and the completion notification fires when the run
          // actually finishes, not when the job returned at park time.
          const signal = new ParkSignal()
          const final = await materializeScheduledWorkspace(
            {
              commander,
              runtime,
              store,
              publishEvent: publishWorkspaceEvent,
              ...(parkYieldEnabled
                ? {
                    park: {
                      signal,
                      registerParkListener: (id: string): void => {
                        parkListeners.set(id, signal.observe)
                        parkListenerWorkspaceId = id
                      },
                      detach: (detached: Promise<void>, id: string): void => {
                        detachedRuns.track(id, detached)
                        parkListeners.delete(id)
                      },
                      onDetachedComplete: async (detachedFinal: Workspace): Promise<void> => {
                        sendCompletionNotification(detachedFinal.id)
                      },
                    },
                  }
                : {}),
            },
            scheduledExtras,
            { tenantId, scheduledWorkspaceId: workspaceId },
          )
          if (workspaceId != null) materializedByScheduledId.set(workspaceId, final.id)
          log.info(
            {
              jobId: scheduledExtras.jobId ?? "unknown",
              scheduledWorkspaceId: workspaceId,
              workspaceId: final.id,
              status: final.status,
            },
            "scheduled fire materialized and executed",
          )
        } catch (err) {
          log.error(
            { workspaceId, jobId: scheduledExtras.jobId ?? "unknown", err },
            "scheduled fire materialization failed",
          )
          throw err
        } finally {
          await lease.release()
          if (parkYieldEnabled) parkListeners.delete(parkListenerWorkspaceId)
        }
        return
      }
      log.error({ workspaceId, tenantId }, "workspace not found — skipping job")
      return
    }

    // Stop-suppression pre-check: an explicit user stop arms a window
    // during which machinery must not re-dispatch this workspace. A BullMQ
    // retry landing inside the window would otherwise reset the just-
    // stopped workspace back to planning and undo the stop.
    const suppression = runtime.checkAutoResume(workspaceId)
    if (suppression.suppressed) {
      log.warn(
        { workspaceId, remainingMs: suppression.remainingMs },
        "auto-resume suppressed (explicit stop within the suppression window) — skipping dispatch",
      )
      return
    }

    // Park-yield duplicate guard: a workspace with a detached (parked) run
    // is status "executing" and ALIVE in this process's waiting registry —
    // falling through to the mid-execution reset below would re-plan and
    // double-execute it. (A worker restart empties the registry, so a
    // genuinely orphaned workspace still recovers through the reset path.)
    if (parkYieldEnabled && detachedRuns.has(workspaceId)) {
      log.warn(
        { workspaceId },
        "workspace has a detached (parked) run in flight — skipping duplicate dispatch",
      )
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
    let final: Workspace | undefined
    try {
      if (parkYieldEnabled) {
        // Park-yield (borrowing; OpenAgentCore worker.go:277): race the
        // execute call against the parked edge. When the run parks on a
        // human decision, arm the detached terminal handlers and return —
        // the BullMQ slot is released while the run keeps living in the
        // runtime's waiting registry (resuming continues from the park
        // point, nothing re-runs).
        const signal = new ParkSignal()
        parkListeners.set(workspaceId, signal.observe)
        let raced: ParkYieldOutcome
        try {
          raced = await executeUntilPark({
            workspaceId,
            execute: () => runtime.execute(workspace, { autoResume: true }),
            signal,
            onDetachedComplete: async (detachedFinal) => {
              await finalizeExecutedWorkspace(detachedFinal, tenantId)
              log.info(
                { workspaceId, status: detachedFinal.status },
                "detached (parked) workspace execution complete",
              )
              sendCompletionNotification(workspaceId)
            },
            onDetachedFailure: async (err) => {
              if (err instanceof AutoResumeSuppressedError) {
                // The stop path already persisted the terminal state —
                // keep it (same parity as the synchronous catch).
                log.warn(
                  { workspaceId, remainingMs: err.remainingMs },
                  "detached execution suppressed after explicit stop",
                )
                return
              }
              log.error(
                { workspaceId, err: err.message },
                "detached runtime.execute threw - marking workspace failed",
              )
              await persistFailedWorkspace(workspace, err.message, tenantId)
            },
          })
        } finally {
          parkListeners.delete(workspaceId)
        }
        if (raced.outcome === "parked") {
          detachedRuns.track(workspaceId, raced.detached)
          return
        }
        final = raced.result
      } else {
        final = await runtime.execute(workspace, { autoResume: true })
      }
    } catch (err) {
      if (err instanceof AutoResumeSuppressedError) {
        // The execute-time gate is the authoritative suppression check (it
        // closes the race against a stop landing after our pre-check). The
        // stop path already persisted the terminal state — do NOT mark
        // failed here, and do NOT rethrow or BullMQ retries would fight
        // the stop for the rest of the window.
        log.warn(
          { workspaceId, remainingMs: err.remainingMs },
          "execution suppressed after explicit stop",
        )
        return
      }
      // Runtime threw - the workspace must NOT be left in planning/executing
      // or the user sees a permanently stuck state. Persist a `failed`
      // terminal state with the error message so they have something to
      // act on. Re-throw so BullMQ records the failure on the job itself.
      const message = (err as Error)?.message ?? String(err)
      log.error({ workspaceId, err: message }, "runtime.execute threw - marking workspace failed")
      await persistFailedWorkspace(workspace, message, tenantId)
      throw err
    } finally {
      await lease.release()
    }

    await finalizeExecutedWorkspace(final, tenantId)

    log.info({ workspaceId, status: final.status }, "workspace execution complete")
  }

  // Create and start the BullMQ worker.
  const concurrency = Number(config.WORKER_CONCURRENCY ?? 3)
  const { worker, stopHeartbeat } = createWorker(redisUrl, processor, concurrency)

  // Cross-process stop signals (user stop arriving at the API while the
  // workspace executes HERE): abort the local runtime — which also arms
  // THIS process's suppression window, settles in-flight bash executions,
  // and rejects parked permission prompts.
  const unsubscribeStops = await subscribeWorkspaceStop(redisUrl, (signal) => {
    log.info(
      { workspaceId: signal.workspaceId, reason: signal.reason, source: signal.source },
      "stop signal received",
    )
    runtime.abort(signal.workspaceId, signal.reason ?? "remote stop")
  })

  // Startup crash-recovery sweep (swarms borrowing): workspaces left in
  // executing/reviewing by a dead worker are batch-reset per the closed
  // error taxonomy — transient/rate_limit go back to planning and are
  // re-enqueued; permanent/context_limit/cancelled are held with a reason;
  // unknown is counted but left untouched.
  try {
    const recoveryQueue = createQueue(redisUrl)
    const report = await recoverStalledJobs(
      {
        listStalledRunning: () => store.listStalledRunning(),
        resetToRetryable: async (id) => {
          const stalled = await store.listStalledRunning()
          const row = stalled.find((r) => r.id === id)
          const ws = await store.loadWorkspace(id, row?.tenantId ?? undefined)
          if (!ws) return
          ws.status = "planning"
          await store.saveWorkspace(ws, row?.tenantId ?? undefined)
          await recoveryQueue.add("execute", {
            workspaceId: id,
            mode: "commander",
            ...(row?.tenantId !== null && row?.tenantId !== undefined
              ? { tenantId: row.tenantId }
              : {}),
          })
        },
        holdWithReason: async (id, category) => {
          const stalled = await store.listStalledRunning()
          const row = stalled.find((r) => r.id === id)
          const ws = await store.loadWorkspace(id, row?.tenantId ?? undefined)
          if (!ws) return
          const held = ws.metadata?.recoveryHold as { category?: string } | undefined
          if (held?.category === category) return // idempotent across restarts
          await store.saveWorkspace(
            {
              ...ws,
              metadata: {
                ...(ws.metadata ?? {}),
                recoveryHold: { category, heldAt: new Date().toISOString() },
              },
            },
            row?.tenantId ?? undefined,
          )
        },
      },
      (err) => crashCategoryOfClassification(classifyError(err)),
      { maxResets: 20 },
    )
    log.info(
      {
        scanned: report.scanned,
        reset: report.reset,
        held: report.held,
        unknownLeft: report.unknownLeft,
        errors: report.errors.length,
      },
      "startup crash-recovery sweep complete",
    )
    await recoveryQueue.close()
  } catch (err) {
    // Recovery is best-effort: a sweep failure must not keep the worker
    // from processing new jobs.
    log.error({ err }, "startup crash-recovery sweep failed")
  }

  worker.on("ready", () => {
    log.info({ concurrency, redisUrl: redisUrl.replace(/\/\/.*@/, "//***@") }, "worker ready")
  })

  // Stash the scheduler's extras (message/jobId/…) before the processor
  // runs — see pendingScheduled above for why this is race-free.
  worker.on("active", (job: Job<WorkspaceJobData>) => {
    const extras = asScheduledExtras(job.data)
    if (extras && typeof job.data.workspaceId === "string") {
      pendingScheduled.set(job.data.workspaceId, extras)
    }
  })

  // Per-workspace crash budgets (ZCode zcode-server-cli borrowing): a
  // workspace whose jobs keep crashing inside the window stops burning
  // BullMQ retries — the job is discarded with the budget's structured
  // reason instead of being re-attempted into the same failure.
  const crashBudgets = new Map<string, CrashBudget>()
  const crashBudgetFor = (workspaceId: string): CrashBudget => {
    let budget = crashBudgets.get(workspaceId)
    if (!budget) {
      budget = new CrashBudget()
      crashBudgets.set(workspaceId, budget)
    }
    return budget
  }

  worker.on("failed", async (job: Job<WorkspaceJobData> | undefined, err: Error) => {
    log.error(
      { jobId: job?.id, workspaceId: job?.data.workspaceId, err: err.message },
      "job failed",
    )
    if (!job) return
    const decision = crashBudgetFor(job.data.workspaceId).recordCrash(Date.now())
    if (!decision.allowRestart) {
      await job.discard()
      log.error(
        { jobId: job.id, workspaceId: job.data.workspaceId, reason: decision.reason },
        "crash budget exhausted — remaining retries discarded",
      )
    }
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
    // A clean completion proves health — the budget starts fresh.
    crashBudgetFor(job.data.workspaceId).reset()
    // Name the workspace that actually ran (materialized scheduled fires
    // completed under a ws-sched-… placeholder id).
    const ranWorkspaceId = materializedByScheduledId.get(job.data.workspaceId)
    log.info(
      {
        jobId: job.id,
        workspaceId: ranWorkspaceId ?? job.data.workspaceId,
        ...(ranWorkspaceId ? { scheduledWorkspaceId: job.data.workspaceId } : {}),
      },
      "job completed",
    )
    // Park-yield: a job that returned at park time "completes" while its
    // run is still parked in the waiting registry — defer the notification
    // to the detached run's real completion (onDetachedComplete).
    if (parkYieldEnabled && detachedRuns.has(job.data.workspaceId)) {
      log.info(
        { jobId: job.id, workspaceId: job.data.workspaceId },
        "job returned at park time - completion notification deferred to the detached run",
      )
      return
    }
    if (notificationGateway) {
      const workspaceId = ranWorkspaceId ?? job.data.workspaceId
      sendCompletionNotification(workspaceId, {
        ...(ranWorkspaceId ? { scheduledWorkspaceId: job.data.workspaceId } : {}),
        jobId: String(job.id),
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
      await unsubscribeStops().catch((err) => {
        log.error({ err }, "error unsubscribing stop signals")
      })
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
