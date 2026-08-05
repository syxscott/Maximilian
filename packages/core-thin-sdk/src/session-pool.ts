// session-pool.ts — per-workspace opencode session management
// 借鉴 opencode: cache pattern echoed from packages/sdk/js/src/v2/server.ts,
// which keeps a "url + close" reference to a single opencode instance —
// generalized here to N sessions keyed by workspaceId.

import type { OpencodeHttpClient } from "./client.js";
import * as Sdk from "./sdk.js";
import type { Session } from "./types.js";

/** Cached session record — tracks liveness + last access for LRU/TTL eviction. */
interface PoolEntry {
  session: Session;
  lastAccessedAt: number;
}

export interface SessionPoolOptions {
  /** Max cached sessions before LRU eviction. Default: 32. */
  maxSessions?: number;
  /** Idle TTL — sessions untouched for this long are eligible for sweep. Default: 30 min. */
  ttlMs?: number;
  /** Sweeper interval in ms. Default: 60_000. Pass 0 to disable the timer. */
  cleanupIntervalMs?: number;
}

export interface PooledSession {
  session: Session;
  /** Returns the same session, refreshing its LRU position. */
  touch(): PooledSession;
}

/**
 * Workspace-keyed cache of opencode sessions. Each `getOrCreate` call either
 * returns the cached session (touching its LRU timestamp) or creates a new one
 * via `OpencodeSdk.createSession`.
 *
 * On `shutdown()`, every cached session is `DELETE`d against the server.
 */
export class SessionPool {
  private readonly client: OpencodeHttpClient;
  private readonly maxSessions: number;
  private readonly ttlMs: number;
  private readonly cleanupIntervalMs: number;
  private readonly map = new Map<string, PoolEntry>();
  private readonly inflight = new Map<string, Promise<PooledSession>>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(client: OpencodeHttpClient, opts: SessionPoolOptions = {}) {
    this.client = client;
    this.maxSessions = opts.maxSessions ?? 32;
    this.ttlMs = opts.ttlMs ?? 30 * 60 * 1000;
    this.cleanupIntervalMs = opts.cleanupIntervalMs ?? 60_000;
    this.startSweeper();
  }

  /**
   * Get or create a session for `workspaceId`. Concurrent calls for the same
   * workspaceId coalesce onto a single `createSession` round-trip.
   */
  async getOrCreate(
    workspaceId: string,
    opts: { title?: string; parentID?: string; agent?: string } = {},
  ): Promise<PooledSession> {
    const existing = this.map.get(workspaceId);
    if (existing) {
      existing.lastAccessedAt = Date.now();
      return wrapEntry(workspaceId, existing);
    }
    const pending = this.inflight.get(workspaceId);
    if (pending) return pending;

    const create = (async () => {
      const session = await Sdk.createSession(this.client, {
        title: opts.title,
        parentID: opts.parentID,
        agent: opts.agent,
      });
      const entry: PoolEntry = { session, lastAccessedAt: Date.now() };
      this.map.set(workspaceId, entry);
      this.evictIfNeeded();
      return wrapEntry(workspaceId, entry);
    })();
    this.inflight.set(workspaceId, create);
    try {
      return await create;
    } finally {
      this.inflight.delete(workspaceId);
    }
  }

  /** Drop a session from the cache without deleting it server-side. */
  release(workspaceId: string): void {
    this.map.delete(workspaceId);
  }

  /** Delete the session server-side and drop it from the cache. */
  async destroy(workspaceId: string): Promise<void> {
    const entry = this.map.get(workspaceId);
    if (!entry) return;
    try {
      await Sdk.deleteSession(this.client, entry.session.id);
    } finally {
      this.map.delete(workspaceId);
    }
  }

  /** Return all cached sessions (read-only — do not mutate). */
  list(): Session[] {
    return Array.from(this.map.values()).map((e) => e.session);
  }

  /** Delete + drop every cached session. */
  async shutdown(): Promise<void> {
    this.stopSweeper();
    const ids = Array.from(this.map.keys());
    await Promise.allSettled(ids.map((id) => this.destroy(id)));
    this.map.clear();
  }

  /** Number of cached sessions (used by tests + observability). */
  size(): number {
    return this.map.size;
  }

  private startSweeper(): void {
    if (this.cleanupIntervalMs <= 0) return;
    this.sweepTimer = setInterval(() => this.sweep(), this.cleanupIntervalMs);
    if (typeof this.sweepTimer === "object" && "unref" in this.sweepTimer) {
      (this.sweepTimer as { unref?: () => void }).unref?.();
    }
  }

  private stopSweeper(): void {
    if (!this.sweepTimer) return;
    clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.map) {
      if (now - entry.lastAccessedAt > this.ttlMs) {
        this.map.delete(id);
      }
    }
  }

  private evictIfNeeded(): void {
    if (this.map.size <= this.maxSessions) return;
    // Find and drop the LRU entry.
    let oldestId: string | undefined;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [id, entry] of this.map) {
      if (entry.lastAccessedAt < oldestTs) {
        oldestTs = entry.lastAccessedAt;
        oldestId = id;
      }
    }
    if (oldestId !== undefined) this.map.delete(oldestId);
  }
}

function wrapEntry(workspaceId: string, entry: PoolEntry): PooledSession {
  return {
    session: entry.session,
    touch(): PooledSession {
      entry.lastAccessedAt = Date.now();
      return wrapEntry(workspaceId, entry);
    },
  };
}
