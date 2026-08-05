/**
 * opencode-state-store.ts — in-memory projection of opencode SSE state.
 *
 * 借鉴 opencode: opencode exposes `/event` SSE stream and SDK helpers like
 * `listSessions` + `subscribeEvents`. Maximilian wraps the bridge in an
 * `EventBridge` (see `@max/core-thin-sdk`) which funnels every envelope
 * through the `OPENCODE_EVENT_MAP` into the local `EventStore`. This module
 * projects that append-only log into a small session-scoped read model:
 *
 *   sessionId → { status, messageCount, lastEventAt, lastEventType, recent[] }
 *
 * Design choices:
 *   - The store is decoupled from the `EventBridge` itself — callers feed it
 *     via `applyEvent(...)` so unit tests can drive it with synthetic
 *     `StoredEvent` rows (no live SSE needed).
 *   - On startup the store rebuilds by re-reading any persisted event log
 *     via `rebuildFrom(eventStore)`. The /api/opencode/sessions endpoint
 *     thus shows the same view across a restart.
 *   - Listeners are notified with the full snapshot on every change so SSE
 *     clients can hand the list straight to the wire.
 *   - Per-session `recent` buffers are capped (`MAX_RECENT`) so memory
 *     doesn't grow unbounded during long-lived sessions.
 */

import { EventEmitter } from "node:events";
import type { EventStore, StoredEvent } from "@max/core";

// ── types ──────────────────────────────────────────────────────────────────

export type OpencodeSessionStatus =
  | "idle"
  | "busy"
  | "retry"
  | "error"
  | "compacting"
  | "unknown";

export interface OpencodeSessionState {
  sessionId: string;
  /** Aggregate id we track this session under — usually == sessionId. */
  aggregateId: string;
  /** Current derived status. `unknown` until we've seen any event. */
  status: OpencodeSessionStatus;
  /** Number of message:* events observed for this session. */
  messageCount: number;
  /** Number of tool:* events observed for this session. */
  toolCallCount: number;
  /** ISO timestamp of the most recent event. */
  lastEventAt: string;
  /** Type discriminator of the most recent event. */
  lastEventType: string;
  /** Cap-bounded tail of recent events (newest last). */
  recent: ReadonlyArray<StoredEvent>;
  /** Set when the session goes into a terminal error — used for UI badging. */
  lastError?: string;
}

export interface OpencodeSessionsSnapshot {
  sessions: ReadonlyArray<OpencodeSessionState>;
  generatedAt: string;
}

export interface OpencodeStateStoreEvents {
  /** Fires whenever any session's state changes. */
  change: [OpencodeSessionsSnapshot];
}

// ── config ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RECENT = 25;
/** Idle sessions are pruned after this long (default 30 min). */
const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;
/** Sweep cadence for the idle-prune timer. */
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

// ── helpers ────────────────────────────────────────────────────────────────

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Map a `StoredEvent` to the session id we want to bucket it under. Most
 * `StoredEvent`s carry `sessionID` in `data`; workspace:* events fall back
 * to `aggregateId`.
 */
function sessionIdOf(event: StoredEvent): string | undefined {
  const data = event.data as { sessionID?: unknown } | undefined;
  const fromData = data ? readString(data.sessionID) : undefined;
  if (fromData) return fromData;
  // Workspace events use aggregateId == workspaceId; surface them under
  // that bucket so the dashboard shows workspace-level status.
  if (event.aggregateId && event.aggregateId !== "global") return event.aggregateId;
  return undefined;
}

function statusFromEvent(event: StoredEvent): OpencodeSessionStatus | undefined {
  switch (event.type) {
    case "session:idle":
      return "idle";
    case "session:status": {
      const t = readString((event.data as { statusType?: unknown })?.statusType);
      if (t === "busy") return "busy";
      if (t === "retry") return "retry";
      if (t === "idle") return "idle";
      return undefined;
    }
    case "compaction:start":
      return "compacting";
    case "compaction:done":
      return "idle";
    case "session:error":
      return "error";
    default:
      return undefined;
  }
}

function isMessageEvent(type: string): boolean {
  return type.startsWith("message:")
}

function isToolEvent(type: string): boolean {
  return type.startsWith("tool:")
}

function errorMessageOf(event: StoredEvent): string | undefined {
  if (event.type !== "session:error") return undefined;
  const data = event.data as { error?: { message?: unknown } | string | undefined } | undefined
  if (!data) return undefined
  if (typeof data.error === "string") return data.error
  if (data.error && typeof data.error === "object") {
    return readString(data.error.message)
  }
  return undefined
}

// ── OpencodeStateStore ─────────────────────────────────────────────────────

export interface OpencodeStateStoreOptions {
  /** Max events retained per session in `recent`. Default: 25. */
  maxRecent?: number;
  /** Idle TTL in ms — sessions idle longer than this are pruned. Default 30 min. */
  idleTtlMs?: number;
  /** Sweep cadence. Set 0 to disable the timer. Default: 60_000. */
  sweepIntervalMs?: number;
}

export declare interface OpencodeStateStore {
  on<K extends keyof OpencodeStateStoreEvents>(
    event: K,
    listener: (...args: OpencodeStateStoreEvents[K]) => void,
  ): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  emit<K extends keyof OpencodeStateStoreEvents>(
    event: K,
    ...args: OpencodeStateStoreEvents[K]
  ): boolean;
}

export class OpencodeStateStore extends EventEmitter {
  private readonly sessions = new Map<string, OpencodeSessionState>();
  private readonly maxRecent: number;
  private readonly idleTtlMs: number;
  private readonly sweepIntervalMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: OpencodeStateStoreOptions = {}) {
    super();
    this.maxRecent = opts.maxRecent ?? DEFAULT_MAX_RECENT;
    this.idleTtlMs = opts.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    if (this.sweepIntervalMs > 0) this.startSweeper();
  }

  // ── write side ────────────────────────────────────────────────────────

  /**
   * Apply a single `StoredEvent` from the bridge. Returns the updated
   * session (or `undefined` if the event didn't belong to any session
   * — e.g. server.connected, pty.* events scoped to a workspace).
   */
  applyEvent(event: StoredEvent): OpencodeSessionState | undefined {
    const id = sessionIdOf(event);
    if (!id) return undefined;

    let session = this.sessions.get(id);
    if (!session) {
      session = {
        sessionId: id,
        aggregateId: event.aggregateId,
        status: "unknown",
        messageCount: 0,
        toolCallCount: 0,
        lastEventAt: event.timestamp,
        lastEventType: event.type,
        recent: [],
      };
      this.sessions.set(id, session);
    }

    const newStatus = statusFromEvent(event);
    const recent = pushBounded(session.recent, event, this.maxRecent);

    const updated: OpencodeSessionState = {
      ...session,
      aggregateId: session.aggregateId === "global" ? event.aggregateId : session.aggregateId,
      status: newStatus ?? session.status,
      messageCount: isMessageEvent(event.type)
        ? session.messageCount + 1
        : session.messageCount,
      toolCallCount: isToolEvent(event.type)
        ? session.toolCallCount + 1
        : session.toolCallCount,
      lastEventAt: event.timestamp,
      lastEventType: event.type,
      lastError: errorMessageOf(event) ?? session.lastError,
      recent,
    };
    this.sessions.set(id, updated);
    this.notifyChange();
    return updated;
  }

  /**
   * Re-hydrate the projection from an existing `EventStore`. Used at boot
   * so a freshly-started API can show sessions that already produced
   * events while the previous instance was alive.
   */
  rebuildFrom(store: EventStore): OpencodeSessionsSnapshot {
    this.sessions.clear();
    const ids = store.getAggregateIds();
    for (const aggId of ids) {
      for (const ev of store.getEvents(aggId)) {
        this.applyEvent(ev);
      }
    }
    return this.snapshot();
  }

  // ── read side ─────────────────────────────────────────────────────────

  listSessions(): ReadonlyArray<OpencodeSessionState> {
    return Array.from(this.sessions.values()).sort((a, b) =>
      b.lastEventAt.localeCompare(a.lastEventAt),
    );
  }

  getSession(id: string): OpencodeSessionState | undefined {
    return this.sessions.get(id);
  }

  snapshot(): OpencodeSessionsSnapshot {
    return {
      sessions: this.listSessions(),
      generatedAt: new Date().toISOString(),
    };
  }

  size(): number {
    return this.sessions.size
  }

  // ── maintenance ───────────────────────────────────────────────────────

  /** Drop idle sessions that haven't seen an event in `idleTtlMs`. */
  pruneIdle(now: number = Date.now()): number {
    let removed = 0;
    const cutoffMs = this.idleTtlMs;
    for (const [id, s] of this.sessions) {
      const lastMs = Date.parse(s.lastEventAt)
      if (Number.isFinite(lastMs) && now - lastMs > cutoffMs && s.status !== "busy") {
        this.sessions.delete(id)
        removed += 1
      }
    }
    if (removed > 0) this.notifyChange()
    return removed
  }

  /** Clear all in-memory state. Mostly useful for tests. */
  clear(): void {
    this.sessions.clear()
    this.notifyChange()
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = undefined
    }
  }

  // ── internals ─────────────────────────────────────────────────────────

  private notifyChange(): void {
    const snap = this.snapshot();
    this.emit("change", snap);
  }

  private startSweeper(): void {
    this.sweepTimer = setInterval(() => this.pruneIdle(), this.sweepIntervalMs);
    const t = this.sweepTimer as unknown as { unref?: () => void };
    t.unref?.();
  }
}

function pushBounded<T>(
  arr: ReadonlyArray<T>,
  item: T,
  max: number,
): ReadonlyArray<T> {
  const next = arr.length >= max ? arr.slice(arr.length - max + 1) : arr.slice();
  next.push(item);
  return next;
}

// ── singleton accessor ────────────────────────────────────────────────────

let _instance: OpencodeStateStore | undefined;

/**
 * Get the process-wide singleton. Lazily constructed so test code that
 * imports this module doesn't accidentally allocate state.
 */
export function getOpencodeStateStore(): OpencodeStateStore {
  if (!_instance) _instance = new OpencodeStateStore();
  return _instance;
}

/** Replace the singleton (used by tests + by `rebuildFrom` boot logic). */
export function __setOpencodeStateStoreForTests(store: OpencodeStateStore | undefined): void {
  if (_instance && _instance !== store) _instance.stop();
  _instance = store;
}
