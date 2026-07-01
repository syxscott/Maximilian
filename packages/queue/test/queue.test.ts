/**
 * Tests for @max/queue.
 *
 * Static checks (always run):
 *   - WORKSPACE_QUEUE has the canonical name used by API + worker
 *   - HEARTBEAT_MAX_AGE_MS aligns with the heartbeat TTL constant
 *   - DEFAULT_JOB_OPTIONS shape (3 attempts, exponential backoff, retention)
 *
 * Live checks (skip when REDIS_URL is not set):
 *   - createQueue → enqueue → drain via createWorker end-to-end
 *   - readWorkerHeartbeat returns undefined before any worker has run
 *   - createWorker writes a heartbeat that readWorkerHeartbeat can see
 *
 * The skip pattern is the same one used by apps/api/test/pg-smoke.test.ts
 * so CI can opt in by exporting REDIS_URL (e.g. via a service container).
 */
import { describe, it, expect } from "vitest";
import {
  WORKSPACE_QUEUE,
  HEARTBEAT_MAX_AGE_MS,
  DEFAULT_JOB_OPTIONS,
  createQueue,
  createWorker,
  readWorkerHeartbeat,
  type WorkspaceJobData,
} from "../src/index.js";

describe("queue constants & defaults", () => {
  it("WORKSPACE_QUEUE has the canonical name", () => {
    expect(WORKSPACE_QUEUE).toBe("workspace-execution");
  });

  it("HEARTBEAT_MAX_AGE_MS is the documented 30s", () => {
    expect(HEARTBEAT_MAX_AGE_MS).toBe(30_000);
  });

  it("DEFAULT_JOB_OPTIONS retries 3x with exponential backoff and 1h retention", () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({ type: "exponential", delay: 2000 });
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({ age: 3600 });
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toEqual({ age: 86400 });
  });
});

// ── Live tests (require REDIS_URL) ─────────────────────────────────────────

const redisUrl = process.env.REDIS_URL;
const skipRedis = !redisUrl;
const d = skipRedis ? describe.skip : describe;

d("live redis (REDIS_URL set)", () => {
  it("readWorkerHeartbeat returns undefined before any worker has run", async () => {
    expect(redisUrl).toBeTruthy();
    const beat = await readWorkerHeartbeat(redisUrl!);
    expect(beat).toBeUndefined();
  });

  it("createWorker writes a heartbeat that readWorkerHeartbeat can see", async () => {
    const received: Array<{ workspaceId: string; mode: string; tenantId?: string }> = [];
    const worker = createWorker(redisUrl!, async (workspaceId, mode, tenantId) => {
      received.push({ workspaceId, mode, tenantId });
    }, 1);

    // Heartbeat fires synchronously on createWorker. Give it a tick to land.
    await new Promise((r) => setTimeout(r, 250));
    const beat = await readWorkerHeartbeat(redisUrl!);
    expect(typeof beat).toBe("number");
    expect(Math.abs(Date.now() - (beat as number))).toBeLessThan(HEARTBEAT_MAX_AGE_MS);

    // Enqueue a job and confirm the worker drains it.
    const queue = createQueue(redisUrl!);
    const job = await queue.add("execute", {
      workspaceId: "ws-test-1",
      mode: "commander",
      tenantId: "tenant-test",
    } satisfies WorkspaceJobData);

    await job.waitUntilFinished(queue, 5_000).catch(() => {});
    // Give the worker a moment in case waitUntilFinished raced.
    await new Promise((r) => setTimeout(r, 250));
    expect(received).toEqual([
      { workspaceId: "ws-test-1", mode: "commander", tenantId: "tenant-test" },
    ]);

    await queue.close();
    await worker.close();
  }, 15_000);
});