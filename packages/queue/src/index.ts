/**
 * BullMQ queue shared between the API (producer) and Worker (consumer).
 *
 * Usage:
 *   API side:    const q = createQueue(redisUrl); await q.add("execute", { workspaceId });
 *   Worker side: const { worker, stopHeartbeat } = createWorker(redisUrl, processor);
 *                 // processor(workspaceId); call stopHeartbeat() on shutdown.
 */

export * from "./resource-lease.js"
export * from "./background-job.js"
export * from "./stop-ledger.js"

import { Queue, Worker, type JobsOptions } from "bullmq"
import { Redis } from "ioredis"
import {
  createRedisWorkspaceStopLedger,
  skipIfWorkspaceStopped,
  type StopGuardJob,
  type WorkspaceStopLedger,
} from "./stop-ledger.js"

/** Minimal structural slice of a BullMQ job used by the waiting-job canceller. */
export interface WaitingJobHandle {
  id?: string
  data?: { workspaceId?: unknown }
  getState(): Promise<string>
  remove(): Promise<void>
}

/** Structural slice of a BullMQ queue used by {@link cancelWaitingJob}. */
export interface JobLookupQueue {
  getJob(jobId: string): Promise<WaitingJobHandle | null | undefined>
}

/** Structural slice of a BullMQ queue used by {@link cancelWaitingWorkspaceJobs}. */
export interface JobListingQueue extends JobLookupQueue {
  getJobs(types?: string | string[]): Promise<WaitingJobHandle[]>
}

/** Canonical queue name — must match between producer and consumer. */
export const WORKSPACE_QUEUE = "workspace-execution"

/**
 * Heartbeat key — each running worker writes this with a TTL so the API
 * can detect when no worker is alive and refuse to enqueue (a job
 * enqueued with no live worker would sit in Redis forever and the user
 * would see their workspace stuck in "planning" with no error).
 *
 * Exported so the worker's healthcheck script and any external probe
 * can read the same key without re-deriving the string literal.
 */
export const HEARTBEAT_KEY = "maximilian:worker:heartbeat"
/** Heartbeat TTL — must be > refresh interval. */
const HEARTBEAT_TTL_SECONDS = 30
/** Maximum allowed age of the latest heartbeat. */
export const HEARTBEAT_MAX_AGE_MS = HEARTBEAT_TTL_SECONDS * 1000

export interface ResourceBudget {
  vramMb?: number
  exclusive?: boolean
}

/** Data persisted in each BullMQ job. */
export interface WorkspaceJobData {
  workspaceId: string
  /** "commander" | "dags" — tells the worker which execution path to use. */
  mode: "commander" | "dags"
  /**
   * Tenant ID of the user who enqueued the job. The worker uses this to
   * load/save the workspace with the correct tenant scope — without it,
   * the workspace store would refuse to surface tenant-owned data to a
   * dev-mode (no-tenant) worker. May be undefined for dev/no-tenant jobs.
   */
  tenantId?: string
  resourceBudget?: ResourceBudget
}

/** Default retry policy: 3 attempts, exponential back-off starting at 2 s. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 3600 }, // keep completed jobs for 1 h
  removeOnFail: { age: 86400 }, // keep failed jobs for 1 d
}

/**
 * Create a BullMQ Queue (producer side — used by the API).
 */
export function createQueue(redisUrl: string): Queue {
  return new Queue(WORKSPACE_QUEUE, {
    connection: { url: redisUrl },
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  })
}

export type WorkspaceProcessor = (
  workspaceId: string,
  mode: "commander" | "dags",
  tenantId: string | undefined,
  resourceBudget: ResourceBudget | undefined,
) => Promise<void>

/**
 * Create a BullMQ Worker (consumer side — used by the worker process).
 *
 * `processor` receives the workspaceId and is responsible for loading the
 * workspace from the database, running the agent runtime, and persisting
 * the final state.
 *
 * Side effect: starts a heartbeat that refreshes the Redis heartbeat key
 * every `HEARTBEAT_TTL_SECONDS / 2` ms. Without this, the API has no
 * way to detect a missing worker and would happily enqueue jobs into
 * a void, leaving workspaces stuck in "planning" forever.
 */
export interface CreateWorkerOptions {
  /**
   * Durable stop ledger consulted before every dispatch. Defaults to a
   * Redis-backed ledger on `redisUrl`. Inject an in-memory ledger in tests.
   */
  stopLedger?: WorkspaceStopLedger
}

/**
 * Dispatch guard wired into every job (borrowing: engine.mjs runHelper()'s
 * "already stopped → do not execute" guard). A workspace stopped while its
 * job was queued keeps its durable marker across restarts, so the retry /
 * post-restart pickup is refused here instead of silently running.
 */
async function guardStoppedWorkspace(
  ledger: WorkspaceStopLedger,
  job: StopGuardJob,
  processor: WorkspaceProcessor,
): Promise<void> {
  if (await skipIfWorkspaceStopped(ledger, job)) return
  const { workspaceId, mode, tenantId, resourceBudget } = job.data as WorkspaceJobData
  await processor(workspaceId, mode, tenantId, resourceBudget)
}

export function createWorker(
  redisUrl: string,
  processor: WorkspaceProcessor,
  concurrency = 3,
  options: CreateWorkerOptions = {},
): { worker: Worker<WorkspaceJobData>; stopHeartbeat: () => void } {
  const ownedLedger =
    options.stopLedger === undefined ? createRedisWorkspaceStopLedger(redisUrl) : undefined
  const stopLedger = options.stopLedger ?? ownedLedger!
  const worker = new Worker<WorkspaceJobData>(
    WORKSPACE_QUEUE,
    async (job) => {
      await guardStoppedWorkspace(stopLedger, job, processor)
    },
    {
      connection: { url: redisUrl },
      concurrency,
      // Stall detection: if a job doesn't complete within 5 min, assume the
      // worker crashed and re-enqueue it.
      stalledInterval: 30_000,
      lockDuration: 300_000,
    },
  )
  if (ownedLedger !== undefined) {
    // The default ledger owns a dedicated Redis connection; release it with
    // the worker so shutdown doesn't leak it.
    worker.on("closed", () => ownedLedger.close())
  }
  const stopHeartbeat = startHeartbeat(redisUrl)
  return { worker, stopHeartbeat }
}

// ---------------------------------------------------------------------------
// Waiting-job cancellation (borrowing: engine.mjs 0e8c24a).
//
// A stop that arrives while a workspace job is still waiting in BullMQ has
// two durability gaps: pub/sub can be missed, and the waiting job itself
// stays live. These helpers let a host remove the queued job outright;
// publishWorkspaceStop covers the marker side so a restart cannot pick the
// workspace back up.
// ---------------------------------------------------------------------------

/** Result of cancelling one known BullMQ job id. */
export type WaitingJobCancelOutcome =
  | { cancelled: true; jobId: string; state: string }
  | { cancelled: false; jobId: string; state: string | undefined; reason: string }

/** States from which a queued job can still be removed with no side effects. */
export function isCancellableWaitingState(state: string): boolean {
  return state === "waiting" || state === "delayed" || state === "paused"
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Remove a single waiting/delayed/paused job by id. Active jobs are left
 * alone (their processor owns them); terminal jobs are reported as not
 * cancellable. Returns a discriminated result instead of throwing so callers
 * can surface an honest outcome.
 */
export async function cancelWaitingJob(
  queue: JobLookupQueue,
  jobId: string,
): Promise<WaitingJobCancelOutcome> {
  const job = await queue.getJob(jobId)
  if (!job) return { cancelled: false, jobId, state: undefined, reason: "job not found" }
  let state: string
  try {
    state = await job.getState()
  } catch (err) {
    return {
      cancelled: false,
      jobId,
      state: undefined,
      reason: `getState failed: ${errorMessage(err)}`,
    }
  }
  if (!isCancellableWaitingState(state)) {
    return {
      cancelled: false,
      jobId,
      state,
      reason: `job is ${state}; only waiting/delayed/paused jobs can be removed`,
    }
  }
  try {
    await job.remove()
  } catch (err) {
    return { cancelled: false, jobId, state, reason: `remove failed: ${errorMessage(err)}` }
  }
  return { cancelled: true, jobId, state }
}

export interface WorkspaceWaitingJobCancelSummary {
  /** BullMQ ids removed from the queue. */
  cancelledJobIds: string[]
  /** Per-job failures; a partial sweep still reports what it removed. */
  errors: string[]
}

/**
 * Remove every waiting/delayed/paused job whose payload targets
 * `workspaceId` (the scheduled-fire path enqueues one placeholder job per
 * fire, so this clears all of them). Non-matching jobs are ignored.
 */
export async function cancelWaitingWorkspaceJobs(
  queue: JobListingQueue,
  workspaceId: string,
): Promise<WorkspaceWaitingJobCancelSummary> {
  const cancelledJobIds: string[] = []
  const errors: string[] = []
  let jobs: WaitingJobHandle[]
  try {
    jobs = await queue.getJobs(["waiting", "delayed", "paused"])
  } catch (err) {
    return { cancelledJobIds, errors: [`getJobs failed: ${errorMessage(err)}`] }
  }
  for (const job of jobs) {
    if (job.data?.workspaceId !== workspaceId) continue
    const jobId = job.id
    if (typeof jobId !== "string" || jobId.length === 0) {
      errors.push(`job targeting ${workspaceId} has no id`)
      continue
    }
    try {
      await job.remove()
      cancelledJobIds.push(jobId)
    } catch (err) {
      errors.push(`job ${jobId}: ${errorMessage(err)}`)
    }
  }
  return { cancelledJobIds, errors }
}

/**
 * Read the worker heartbeat. Returns the timestamp (ms since epoch) of
 * the last heartbeat, or undefined if no worker has heartbeated yet (or
 * the TTL has expired and the key is gone).
 *
 * The API calls this before enqueuing a workspace job. If the heartbeat
 * is missing or older than HEARTBEAT_MAX_AGE_MS, the API returns 503
 * rather than silently enqueueing into a void.
 *
 * Connection reuse: a long-lived Redis client is cached per `redisUrl` so
 * repeated heartbeats (e.g. on every chat request) don't open a fresh
 * TCP connection each time. The cache is a module-level Map; tests that
 * need to reset it can call `__resetHeartbeatConnCacheForTest()`.
 */
const heartbeatConnCache = new Map<string, Redis>()

function getOrCreateHeartbeatConn(redisUrl: string): Redis {
  const cached = heartbeatConnCache.get(redisUrl)
  // Exclude 'end' (terminal) AND 'reconnecting' (mid-retry) — only reuse
  // a connection that is actively connected. Without this, a cached conn
  // in 'reconnecting' state returns to callers, fails immediately, gets
  // evicted, and a fresh conn is created — churning connections on every
  // heartbeat call during a Redis outage.
  if (cached && cached.status !== "end" && cached.status !== "reconnecting") return cached
  const conn = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  })
  conn.on("end", () => {
    if (heartbeatConnCache.get(redisUrl) === conn) heartbeatConnCache.delete(redisUrl)
  })
  conn.on("error", () => {
    // Errors are surfaced via the GET promise — keep the connection alive
    // so transient blips don't tear down the cache entry.
  })
  heartbeatConnCache.set(redisUrl, conn)
  return conn
}

/** Test-only hook to clear the cached heartbeat Redis client. */
export function __resetHeartbeatConnCacheForTest(): void {
  for (const conn of heartbeatConnCache.values()) {
    try {
      conn.disconnect()
    } catch {
      // ignore — best-effort cleanup
    }
  }
  heartbeatConnCache.clear()
}

export async function readWorkerHeartbeat(redisUrl: string): Promise<number | undefined> {
  const conn = getOrCreateHeartbeatConn(redisUrl)
  try {
    const raw = await conn.get(HEARTBEAT_KEY)
    if (!raw) return undefined
    const ts = Number(raw)
    return Number.isFinite(ts) ? ts : undefined
  } catch {
    // Connection broken — drop the cached entry so the next call reconnects.
    if (heartbeatConnCache.get(redisUrl) === conn) heartbeatConnCache.delete(redisUrl)
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Runtime-event backflow (queue mode).
//
// In queue mode the runtime executes inside the worker process, so the
// API never sees task/task-stream events from its own runtime listener —
// SSE clients would connect and hang on a single snapshot. The worker
// publishes every runtime event on this channel; the API subscribes and
// feeds them into the same fan-out path as locally-produced events
// (in-memory log, SSE, durable JSONL log, webhook subscriptions).
// ---------------------------------------------------------------------------

export const WORKSPACE_EVENTS_CHANNEL = "maximilian:workspace-events"

/** Envelope published by the worker for every runtime event. */
export interface WorkspaceEventEnvelope {
  workspaceId: string
  /** Tenant scope of the job — lets the API route webhook/SSE without a DB lookup. */
  tenantId?: string
  /** A @max/core RuntimeEvent (untyped here to avoid a package dependency cycle). */
  event: unknown
}

/**
 * Create a publisher used by the worker to forward runtime events to the
 * API. Returns an async publish function; failures are the caller's to
 * log (publishing is best-effort — losing one progress event must not
 * crash execution).
 */
export function createWorkspaceEventPublisher(
  redisUrl: string,
): (envelope: WorkspaceEventEnvelope) => Promise<void> {
  const conn = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: false })
  conn.on("error", () => {
    // Surface via the publish promise; keep the connection alive.
  })
  return async (envelope) => {
    await conn.publish(WORKSPACE_EVENTS_CHANNEL, JSON.stringify(envelope))
  }
}

/**
 * Subscribe to worker-forwarded runtime events (API side). Returns a
 * close() for shutdown. Messages that fail to parse are dropped — a
 * malformed envelope must never take down the API process.
 */
export function subscribeWorkspaceEvents(
  redisUrl: string,
  handler: (envelope: WorkspaceEventEnvelope) => void,
): { close: () => void } {
  // Redis pub/sub requires a dedicated connection in subscriber mode.
  const conn = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false })
  conn.on("error", () => {
    // ioredis auto-reconnects; transient errors are expected during blips.
  })
  conn.subscribe(WORKSPACE_EVENTS_CHANNEL).catch(() => {
    // Subscription retries with the connection; nothing to do here.
  })
  conn.on("message", (channel: string, raw: string) => {
    if (channel !== WORKSPACE_EVENTS_CHANNEL) return
    try {
      const parsed = JSON.parse(raw) as WorkspaceEventEnvelope
      if (parsed && typeof parsed.workspaceId === "string" && parsed.event) {
        handler(parsed)
      }
    } catch {
      // Malformed envelope — drop.
    }
  })
  return {
    close: () => {
      try {
        void conn.unsubscribe()
      } catch {
        // ignore
      }
      conn.disconnect()
    },
  }
}

/**
 * Start a background heartbeat. Writes a timestamp to Redis every
 * `HEARTBEAT_TTL_SECONDS / 2` seconds with a TTL of `HEARTBEAT_TTL_SECONDS`.
 * Returns a stop function.
 *
 * Transient Redis errors are logged at warn (not swallowed silently) so
 * that operators see a failing heartbeat before the key actually expires
 * and the API starts returning 503 on the producer side. A single failed
 * beat is non-fatal — the next interval will retry.
 */
function startHeartbeat(redisUrl: string): () => void {
  const conn = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  })
  const intervalMs = (HEARTBEAT_TTL_SECONDS * 1000) / 2
  let stopped = false
  let failedBeats = 0

  const beat = () => {
    if (stopped) return
    conn
      .set(HEARTBEAT_KEY, String(Date.now()), "EX", HEARTBEAT_TTL_SECONDS)
      .catch((err) => {
        failedBeats += 1
        // Throttle: don't flood logs on a sustained outage. Reset the
        // counter if the connection recovers so the next failure is loud.
        if (failedBeats === 1 || failedBeats % 30 === 0) {
          console.warn(
            `[queue] heartbeat refresh failed (count=${failedBeats}):`,
            (err as Error).message,
          )
        }
      })
      .then(() => {
        if (failedBeats > 0) {
          console.info(`[queue] heartbeat recovered after ${failedBeats} failed beat(s)`)
          failedBeats = 0
        }
      })
  }
  beat()
  const timer = setInterval(beat, intervalMs)
  // `.unref()` so the heartbeat timer alone never holds the event loop
  // open after SIGTERM has torn everything else down. The Redis client
  // below also disconnects on stop().
  timer.unref()

  return () => {
    stopped = true
    clearInterval(timer)
    conn.disconnect()
  }
}
export * from "./crash-budget.js"
export * from "./crash-recovery.js"
export * from "./stop-signal.js"
export * from "./ownership-index.js"
export * from "./store-health.js"
export * from "./cron-outage.js"
