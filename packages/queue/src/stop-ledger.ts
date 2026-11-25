// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Durable per-workspace stop ledger (borrowing: MiniApps minimax-bot
 * engine.mjs, commit 0e8c24a — "queued helpers can be stopped").
 *
 * The cross-process pub/sub signal ({@link ./stop-signal.ts}) is
 * at-least-once at best: a stop that lands while the worker process is
 * down (or between restarts) is lost, and a job still sitting in BullMQ's
 * waiting list is then executed — exactly the "stopped: false, job runs
 * anyway" defect. A Redis marker survives the process, so the worker's
 * dispatch guard can refuse to start a stopped workspace even after a
 * restart.
 *
 * The marker is keyed by workspace id and carries a TTL. Workspace ids are
 * minted per planning request (Commander/DAGS), so a stale marker only
 * affects an explicit re-run of the SAME id within the TTL window; the TTL
 * bounds that residue instead of leaking keys forever.
 *
 * Purely additive: every read/write failure fails OPEN (the guard returns
 * "not stopped"), because a broken ledger must not wedge or falsely skip
 * healthy work.
 */

import { Redis } from "ioredis"

/** Redis key prefix — matches the canonical namespacing of the other queue keys. */
export const WORKSPACE_STOPPED_KEY_PREFIX = "maximilian:workspace:stopped:"

/**
 * How long a stop stays authoritative. Long enough to cover a worker
 * restart / redeploy (the case this ledger exists for), short enough that
 * an explicit re-run of the same workspace id is not blocked forever.
 */
export const DEFAULT_WORKSPACE_STOP_TTL_SECONDS = 24 * 60 * 60

/** A stopped marker as persisted in Redis. */
export interface WorkspaceStopRecord {
  at: number
  reason?: string
}

/** Storage port so tests never need Redis. */
export interface WorkspaceStopLedger {
  markStopped(workspaceId: string, reason?: string): Promise<void>
  isStopped(workspaceId: string): Promise<boolean>
  clear(workspaceId: string): Promise<void>
}

/** Canonical Redis key for a workspace stop marker (exported for probes/tests). */
export function workspaceStoppedKey(workspaceId: string): string {
  return `${WORKSPACE_STOPPED_KEY_PREFIX}${workspaceId}`
}

/** In-memory ledger — unit tests and single-process hosts. */
export class InMemoryWorkspaceStopLedger implements WorkspaceStopLedger {
  private readonly stops = new Map<string, WorkspaceStopRecord>()

  async markStopped(workspaceId: string, reason?: string): Promise<void> {
    this.stops.set(workspaceId, {
      at: Date.now(),
      ...(reason !== undefined ? { reason } : {}),
    })
  }

  async isStopped(workspaceId: string): Promise<boolean> {
    return this.stops.has(workspaceId)
  }

  async clear(workspaceId: string): Promise<void> {
    this.stops.delete(workspaceId)
  }

  get size(): number {
    return this.stops.size
  }
}

/** Redis-backed ledger used by the API publisher and the worker guard. */
export class RedisWorkspaceStopLedger implements WorkspaceStopLedger {
  private readonly conn: Redis
  private readonly ttlMs: number

  constructor(conn: Redis, ttlSeconds: number = DEFAULT_WORKSPACE_STOP_TTL_SECONDS) {
    this.conn = conn
    this.ttlMs = ttlSeconds * 1000
  }

  async markStopped(workspaceId: string, reason?: string): Promise<void> {
    const record: WorkspaceStopRecord = {
      at: Date.now(),
      ...(reason !== undefined ? { reason } : {}),
    }
    await this.conn.set(workspaceStoppedKey(workspaceId), JSON.stringify(record), "PX", this.ttlMs)
  }

  async isStopped(workspaceId: string): Promise<boolean> {
    return (await this.conn.exists(workspaceStoppedKey(workspaceId))) === 1
  }

  async clear(workspaceId: string): Promise<void> {
    await this.conn.del(workspaceStoppedKey(workspaceId))
  }

  /** Release the owned connection (worker shutdown). */
  close(): void {
    this.conn.disconnect()
  }
}

/** Open a Redis-backed ledger on its own connection. */
export function createRedisWorkspaceStopLedger(
  redisUrl: string,
  ttlSeconds: number = DEFAULT_WORKSPACE_STOP_TTL_SECONDS,
): RedisWorkspaceStopLedger {
  return new RedisWorkspaceStopLedger(
    new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: false }),
    ttlSeconds,
  )
}

/** Minimal shape of a BullMQ job the guard needs. */
export interface StopGuardJob {
  data: { workspaceId?: unknown }
  /** BullMQ's Job.discard() is synchronous in the installed typings. */
  discard?: () => void | Promise<void>
}

/**
 * Dispatch guard (borrowing: engine.mjs runHelper()'s `if (status ===
 * 'stopped') return`): a workspace carrying a durable stop marker must not
 * be executed. Returns true when the caller should skip the job.
 *
 * Fails open on ledger errors: an unavailable Redis must not fabricate a
 * stop (and must not wedge the queue). The pub/sub suppression window in
 * `@max/core` remains the low-latency fast path; this is the durability
 * backstop.
 */
export async function skipIfWorkspaceStopped(
  ledger: WorkspaceStopLedger,
  job: StopGuardJob,
): Promise<boolean> {
  const workspaceId = job?.data?.workspaceId
  if (typeof workspaceId !== "string" || workspaceId.length === 0) return false
  let stopped: boolean
  try {
    stopped = await ledger.isStopped(workspaceId)
  } catch {
    return false
  }
  if (!stopped) return false
  // Best-effort: a discarded job will not be retried into execution.
  try {
    await job.discard?.()
  } catch {
    // Active jobs may reject discard(); completing without executing is
    // still correct.
  }
  return true
}
