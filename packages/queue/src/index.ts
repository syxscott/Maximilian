/**
 * BullMQ queue shared between the API (producer) and Worker (consumer).
 *
 * Usage:
 *   API side:    const q = createQueue(redisUrl); await q.add("execute", { workspaceId });
 *   Worker side: const w = createWorker(redisUrl, processor); // processor(workspaceId)
 */

import { Queue, Worker, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

/** Canonical queue name — must match between producer and consumer. */
export const WORKSPACE_QUEUE = "workspace-execution";

/**
 * Heartbeat key — each running worker writes this with a TTL so the API
 * can detect when no worker is alive and refuse to enqueue (a job
 * enqueued with no live worker would sit in Redis forever and the user
 * would see their workspace stuck in "planning" with no error).
 *
 * Exported so the worker's healthcheck script and any external probe
 * can read the same key without re-deriving the string literal.
 */
export const HEARTBEAT_KEY = "maximilian:worker:heartbeat";
/** Heartbeat TTL — must be > refresh interval. */
const HEARTBEAT_TTL_SECONDS = 30;
/** Maximum allowed age of the latest heartbeat. */
export const HEARTBEAT_MAX_AGE_MS = HEARTBEAT_TTL_SECONDS * 1000;

/** Data persisted in each BullMQ job. */
export interface WorkspaceJobData {
  workspaceId: string;
  /** "commander" | "dags" — tells the worker which execution path to use. */
  mode: "commander" | "dags";
  /**
   * Tenant ID of the user who enqueued the job. The worker uses this to
   * load/save the workspace with the correct tenant scope — without it,
   * the workspace store would refuse to surface tenant-owned data to a
   * dev-mode (no-tenant) worker. May be undefined for dev/no-tenant jobs.
   */
  tenantId?: string;
}

/** Default retry policy: 3 attempts, exponential back-off starting at 2 s. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 3600 },   // keep completed jobs for 1 h
  removeOnFail: { age: 86400 },       // keep failed jobs for 1 d
};

/**
 * Create a BullMQ Queue (producer side — used by the API).
 */
export function createQueue(redisUrl: string): Queue {
  return new Queue(WORKSPACE_QUEUE, {
    connection: { url: redisUrl },
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

export type WorkspaceProcessor = (
  workspaceId: string,
  mode: "commander" | "dags",
  tenantId: string | undefined,
) => Promise<void>;

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
export function createWorker(
  redisUrl: string,
  processor: WorkspaceProcessor,
  concurrency = 3,
): Worker<WorkspaceJobData> {
  const worker = new Worker<WorkspaceJobData>(
    WORKSPACE_QUEUE,
    async (job) => {
      const { workspaceId, mode, tenantId } = job.data;
      await processor(workspaceId, mode, tenantId);
    },
    {
      connection: { url: redisUrl },
      concurrency,
      // Stall detection: if a job doesn't complete within 5 min, assume the
      // worker crashed and re-enqueue it.
      stalledInterval: 30_000,
      lockDuration: 300_000,
    },
  );
  startHeartbeat(redisUrl);
  return worker;
}

/**
 * Read the worker heartbeat. Returns the timestamp (ms since epoch) of
 * the last heartbeat, or undefined if no worker has heartbeated yet (or
 * the TTL has expired and the key is gone).
 *
 * The API calls this before enqueuing a workspace job. If the heartbeat
 * is missing or older than HEARTBEAT_MAX_AGE_MS, the API returns 503
 * rather than silently enqueueing into a void.
 */
export async function readWorkerHeartbeat(redisUrl: string): Promise<number | undefined> {
  const conn = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  try {
    const raw = await conn.get(HEARTBEAT_KEY);
    if (!raw) return undefined;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : undefined;
  } finally {
    conn.disconnect();
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
  });
  const intervalMs = (HEARTBEAT_TTL_SECONDS * 1000) / 2;
  let stopped = false;
  let failedBeats = 0;

  const beat = () => {
    if (stopped) return;
    conn
      .set(HEARTBEAT_KEY, String(Date.now()), "EX", HEARTBEAT_TTL_SECONDS)
      .catch((err) => {
        failedBeats += 1;
        // Throttle: don't flood logs on a sustained outage. Reset the
        // counter if the connection recovers so the next failure is loud.
        if (failedBeats === 1 || failedBeats % 30 === 0) {
          console.warn(
            `[queue] heartbeat refresh failed (count=${failedBeats}):`,
            (err as Error).message,
          );
        }
      })
      .then(() => {
        if (failedBeats > 0) {
          console.info(`[queue] heartbeat recovered after ${failedBeats} failed beat(s)`);
          failedBeats = 0;
        }
      });
  };
  beat();
  const timer = setInterval(beat, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
    conn.disconnect();
  };
}
