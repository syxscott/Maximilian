/**
 * event-bridge.ts — `EventBridge` consumes an opencode SSE stream and
 * dispatches each envelope into Maximilian's `EventStore`.
 *
 * Responsibilities:
 *   1. Subscribe to `sdk.subscribeEvents(...)` (or any compatible
 *      `AsyncIterable<EventEnvelope>`).
 *   2. Translate each envelope through the `OPENCODE_EVENT_MAP` table.
 *   3. Buffer events under back-pressure (`appendBufferHighWatermark`).
 *   4. Reconnect on error / connection drop with exponential backoff.
 *   5. Detect a dead SSE (no events in `heartbeatTimeoutMs`) and force a
 *      reconnect.
 *   6. Expose lifecycle metrics + an `error` EventEmitter channel so
 *      supervisors / dashboards can observe bridge state.
 *
 * 借鉴 opencode: SSE wire format follows
 * `docs/opencode-sdk-spec.md` §5 — `: heartbeat\n\n` frames are emitted every
 * 15s by the server; the bridge treats 30s of silence as a dead stream.
 */

import { EventEmitter } from "node:events";
import type { EventStore } from "@max/core";

import {
  OPENCODE_EVENT_MAP,
  buildMappingIndex,
  isOpencodeEvent,
  mapOpencodeEvent,
  type MappedEventDraft,
  type OpencodeEvent,
  type OpencodeEventMapping,
} from "./event-mapping.js";

// ── SDK contract ────────────────────────────────────────────────────────────

/**
 * Minimal subset of the opencode SDK we depend on. The real
 * `OpencodeSdk.subscribeEvents(client, query, signal)` exported from
 * `./sdk.js` matches this signature exactly, so a real client can be
 * passed in production.
 */
export interface EventBridgeSdk {
  subscribeEvents(
    query?: { directory?: string },
    signal?: AbortSignal,
  ): AsyncIterable<OpencodeEvent>;
}

// ── options / metrics ───────────────────────────────────────────────────────

export interface EventBridgeOptions {
  /**
   * Workspace id used as a fallback aggregate when an envelope lacks both
   * `location.workspaceID` and `data.sessionID`.
   */
  workspaceId?: string;
  /**
   * If the SSE yields nothing for this many milliseconds, the bridge will
   * tear down the stream and reconnect. Default: 30s.
   */
  heartbeatTimeoutMs?: number;
  /**
   * Exponential-backoff parameters for reconnection attempts.
   * `maxBackoffMs` caps the delay; the actual delay doubles on each
   * consecutive failure.
   */
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /**
   * Hard cap on reconnect attempts. Once exceeded, the bridge stops trying
   * and emits `error`. Use `Infinity` to retry forever.
   */
  maxReconnects?: number;
  /**
   * Max events buffered while the consumer is back-pressured. Beyond
   * this, new events are counted as `eventsDropped` and skipped.
   */
  appendBufferHighWatermark?: number;
  /**
   * Polled while draining; if it returns false, events stay buffered.
   * Defaults to always returning true (EventStore is in-memory / sync).
   * Tests pass `() => gateOpen` so they can simulate back-pressure.
   */
  isReady?: () => boolean;
  /**
   * Override the mapping index (defaults to `OPENCODE_EVENT_MAP`).
   */
  mappingEntries?: ReadonlyArray<OpencodeEventMapping>;
  /**
   * Optional SSE directory query — forwarded to `sdk.subscribeEvents`.
   */
  subscribeQuery?: { directory?: string };
}

export interface EventBridgeMetrics {
  eventsReceived: number;
  eventsMapped: number;
  eventsAppended: number;
  eventsDropped: number;
  reconnects: number;
  reconnectsFailed: number;
  heartbeatTimeouts: number;
  backpressureWaits: number;
}

// ── EventBridge ─────────────────────────────────────────────────────────────

type BridgeState = "idle" | "starting" | "running" | "stopping" | "stopped" | "errored";

/**
 * Internal record carrying per-event metadata between the SSE consumer
 * and the append worker.
 */
interface BufferedEvent {
  draft: MappedEventDraft;
  sourceEvent: OpencodeEvent;
  enqueuedAt: number;
  attempts: number;
}

// ── defaults ────────────────────────────────────────────────────────────────

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000;
const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_MAX_RECONNECTS = 10;
const DEFAULT_BUFFER_HIGH_WATERMARK = 1_000;
const READY_POLL_INTERVAL_MS = 25;

// ── class ───────────────────────────────────────────────────────────────────

export declare interface EventBridge {
  /** Fires for every read / map / dispatch error (not user-thrown). */
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "reconnect", listener: (info: { attempt: number; delayMs: number }) => void): this;
  on(event: "drop", listener: (info: { type: string; reason: string }) => void): this;
  on(event: "state", listener: (state: BridgeState) => void): this;
  /**
   * Fires synchronously after a successful mapping and before the draft is
   * appended to the EventStore. Use {@link EventBridge.subscribe} to
   * register; the callback receives the opencode envelope plus the
   * already-mapped draft so consumers (e.g. MetaSystemOpencodeBridge) can
   * react to specific event types without polling the store.
   *
   * 借鉴 opencode: opencode's internal EventBus exposes a similar
   * observer hook so downstream reducers can subscribe to raw envelopes
   * without re-deriving them from the EventStore.
   */
  on(
    event: "mapped",
    listener: (info: MappedEventInfo) => void,
  ): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

/**
 * Payload delivered to `EventBridge.subscribe()` callbacks. Includes both
 * the raw opencode envelope and the mapped draft so consumers can choose
 * which representation to match on.
 */
export interface MappedEventInfo {
  /** The original opencode event type, e.g. "session.idle". */
  opencodeType: string;
  /** The raw opencode envelope (before mapping). */
  sourceEvent: OpencodeEvent;
  /** The mapped draft that will be appended to the EventStore. */
  draft: MappedEventDraft;
}

export class EventBridge extends EventEmitter {
  private readonly sdk: EventBridgeSdk;
  private readonly store: EventStore;
  private readonly workspaceId: string;
  private readonly subscribeQuery: { directory?: string };
  private readonly heartbeatTimeoutMs: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxReconnects: number;
  private readonly bufferHighWatermark: number;
  private readonly isReady: () => boolean;
  private readonly mappingIndex: Map<string, OpencodeEventMapping>;

  private state: BridgeState = "idle";
  private rootController: AbortController | null = null;
  private streamController: AbortController | null = null;
  private reconnectAttempts = 0;
  private lastEventAt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly buffer: BufferedEvent[] = [];
  private readonly metrics: EventBridgeMetrics = {
    eventsReceived: 0,
    eventsMapped: 0,
    eventsAppended: 0,
    eventsDropped: 0,
    reconnects: 0,
    reconnectsFailed: 0,
    heartbeatTimeouts: 0,
    backpressureWaits: 0,
  };

  constructor(opts: { sdk: EventBridgeSdk; eventStore: EventStore; workspaceId?: string } & EventBridgeOptions) {
    super();
    if (!opts.sdk) throw new Error("EventBridge: `sdk` is required");
    if (!opts.eventStore) throw new Error("EventBridge: `eventStore` is required");

    this.sdk = opts.sdk;
    this.store = opts.eventStore;
    this.workspaceId = opts.workspaceId ?? "default";
    this.subscribeQuery = opts.subscribeQuery ?? {};
    this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.initialBackoffMs = opts.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.maxReconnects = opts.maxReconnects ?? DEFAULT_MAX_RECONNECTS;
    this.bufferHighWatermark = opts.appendBufferHighWatermark ?? DEFAULT_BUFFER_HIGH_WATERMARK;
    this.isReady = opts.isReady ?? (() => true);
    this.mappingIndex = buildMappingIndex(opts.mappingEntries ?? OPENCODE_EVENT_MAP);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  /** Start consuming the SSE stream. Idempotent (a second call no-ops). */
  async start(): Promise<void> {
    if (this.state === "running" || this.state === "starting") return;
    this.transitionTo("starting");

    this.rootController = new AbortController();
    const rootSignal = this.rootController.signal;

    // Detached promise: `start()` resolves once the first SSE iteration
    // is wired up; failures from the SSE itself are reported via `error`.
    this.runLoop(rootSignal).catch((err: unknown) => {
      this.failWith(err instanceof Error ? err : new Error(String(err)));
    });

    this.transitionTo("running");
  }

  /**
   * Stop the bridge, drain any buffered events, and cancel all in-flight
   * work. After `stop()` resolves, the bridge cannot be reused.
   */
  async stop(): Promise<void> {
    if (this.state === "idle" || this.state === "stopped") return;
    this.transitionTo("stopping");

    if (this.rootController) {
      this.rootController.abort();
      this.rootController = null;
    }
    if (this.streamController) {
      this.streamController.abort();
      this.streamController = null;
    }
    this.stopHeartbeat();
    this.stopDrain();

    // Best-effort drain: events already buffered still get appended, but
    // their source stream has already been torn down. We force-drain even
    // when `isReady()` is still returning false so `stop()` can resolve.
    await this.flushBuffer({ force: true });

    this.buffer.length = 0;
    this.transitionTo("stopped");
  }

  /** Snapshot of the current counter set (read-only). */
  getMetrics(): Readonly<EventBridgeMetrics> {
    return { ...this.metrics };
  }

  /** Current bridge state. */
  getState(): BridgeState {
    return this.state;
  }

  /** Number of events currently buffered (mostly useful for tests / metrics). */
  getBufferDepth(): number {
    return this.buffer.length;
  }

  // ── core loop ──────────────────────────────────────────────────────────

  private async runLoop(rootSignal: AbortSignal): Promise<void> {
    while (!rootSignal.aborted) {
      const streamSignal = this.acquireStreamSignal(rootSignal);

      try {
        await this.consumeStream(streamSignal);
        // Stream completed without an error — treat as a graceful close;
        // reconnect unless the user explicitly stopped us.
        if (rootSignal.aborted) return;
        if (!this.shouldReconnect()) {
          throw new Error("EventBridge: stream closed by server and reconnect is disabled");
        }
      } catch (err) {
        if (rootSignal.aborted || rootSignal.reason === "manual-stop") return;
        this.metrics.reconnectsFailed += 1;
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }

      if (!this.shouldReconnect()) {
        throw new Error(
          `EventBridge: max reconnects (${this.maxReconnects}) exceeded; giving up`,
        );
      }

      const delay = this.computeBackoff();
      this.reconnectAttempts += 1;
      this.metrics.reconnects += 1;
      this.emit("reconnect", { attempt: this.reconnectAttempts, delayMs: delay });

      if (await this.sleep(delay, rootSignal)) return; // aborted during sleep
    }
  }

  private async consumeStream(signal: AbortSignal): Promise<void> {
    const iterable = this.sdk.subscribeEvents(this.subscribeQuery, signal);
    this.lastEventAt = Date.now();
    this.startHeartbeat();

    for await (const raw of iterable) {
      if (signal.aborted) break;
      this.lastEventAt = Date.now();
      this.metrics.eventsReceived += 1;
      if (!isOpencodeEvent(raw)) {
        this.drop("?", "non-envelope value yielded by SSE");
        continue;
      }
      this.dispatchOne(raw);
    }

    this.stopHeartbeat();
  }

  // ── mapping / dispatch ─────────────────────────────────────────────────

  private dispatchOne(event: OpencodeEvent): void {
    let draft: MappedEventDraft;
    try {
      draft = mapOpencodeEvent(event, this.mappingIndex, this.workspaceId);
    } catch (err) {
      this.drop(event.type ?? "?", `mapper threw: ${describe(err)}`);
      return;
    }
    this.metrics.eventsMapped += 1;
    this.enqueue({ draft, sourceEvent: event, enqueuedAt: Date.now(), attempts: 0 });
    // Notify live subscribers (e.g. MetaSystemOpencodeBridge) so they can
    // react in real-time without polling the EventStore. Listener errors
    // are caught and surfaced through the bridge's `error` channel —
    // they don't break the append pipeline.
    this.emit("mapped", {
      opencodeType: event.type ?? "",
      sourceEvent: event,
      draft,
    });
  }

  /**
   * Register a callback for mapped events as they flow through the bridge.
   * The callback fires synchronously after a successful mapping, before
   * the draft is appended to the EventStore.
   *
   * Returns an unsubscribe function. Multiple subscribers are supported;
   * each receives every event (no per-subscriber filtering at this layer —
   * filter inside the callback by `opencodeType` or `draft.type`).
   *
   * 借鉴 opencode: the opencode EventBus exposes a similar observer hook
   * so downstream reducers can subscribe to raw envelopes without
   * re-deriving them from the EventStore.
   */
  subscribe(callback: (info: MappedEventInfo) => void): () => void {
    const listener = (info: MappedEventInfo): void => {
      try {
        callback(info);
      } catch (err) {
        this.failWith(err instanceof Error ? err : new Error(String(err)));
      }
    };
    this.on("mapped", listener);
    return () => {
      this.off("mapped", listener);
    };
  }

  private enqueue(item: BufferedEvent): void {
    if (this.buffer.length >= this.bufferHighWatermark) {
      this.metrics.eventsDropped += 1;
      this.emit("drop", {
        type: item.draft.type,
        reason: "buffer-overflow",
      });
      return;
    }
    this.buffer.push(item);
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.drainTimer) return;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      void this.flushBuffer();
    }, 0);
  }

  private async flushBuffer(opts?: { force?: boolean }): Promise<void> {
    const force = opts?.force === true;
    // Drain as long as we have entries and the store is ready.
    while (this.buffer.length > 0) {
      if (!force && !this.isReady()) {
        this.metrics.backpressureWaits += 1;
        // Yield to the event loop and reschedule.
        await this.sleep(READY_POLL_INTERVAL_MS);
        continue;
      }
      const item = this.buffer[0];
      if (!item) break;
      try {
        this.appendDraft(item.draft);
        this.metrics.eventsAppended += 1;
        this.buffer.shift();
      } catch (err) {
        item.attempts += 1;
        // Push to the back and back off briefly so a transient store
        // error (e.g. sync write contention) doesn't tightloop us.
        if (item.attempts > 5) {
          this.buffer.shift();
          this.metrics.eventsDropped += 1;
          this.emit("drop", {
            type: item.draft.type,
            reason: `append-failed: ${describe(err)}`,
          });
          continue;
        }
        this.buffer.push(this.buffer.shift()!);
        await this.sleep(Math.min(50 * item.attempts, 250));
      }
    }
  }

  private appendDraft(draft: MappedEventDraft): void {
    this.store.append({
      type: draft.type,
      aggregateId: draft.aggregateId,
      data: draft.data,
    });
  }

  // ── heartbeat ──────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastEventAt = Date.now();
    // Poll at one-third of the heartbeat window so we have at most a 33%
    // overshoot before declaring the stream dead. A 100ms floor keeps the
    // cadence responsive for tests with small `heartbeatTimeoutMs` values.
    const cadence = Math.max(100, Math.floor(this.heartbeatTimeoutMs / 3));
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastEventAt < this.heartbeatTimeoutMs) return;
      this.metrics.heartbeatTimeouts += 1;
      this.emit("error", new Error("EventBridge: heartbeat timeout — forcing reconnect"));
      this.streamController?.abort("heartbeat-timeout");
      this.stopHeartbeat();
    }, cadence);
    // Don't keep the process alive solely for the heartbeat timer.
    if (typeof (this.heartbeatTimer as { unref?: () => void }).unref === "function") {
      (this.heartbeatTimer as { unref: () => void }).unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private stopDrain(): void {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  // ── abort / sleep ──────────────────────────────────────────────────────

  private acquireStreamSignal(parent: AbortSignal): AbortSignal {
    this.streamController = new AbortController();
    const child = this.streamController.signal;

    if (parent.aborted) {
      this.streamController.abort(parent.reason);
    } else {
      const onParentAbort = () => {
        this.streamController?.abort(parent.reason);
      };
      parent.addEventListener("abort", onParentAbort, { once: true });
      // Once the child aborts, drop the parent listener too.
      child.addEventListener(
        "abort",
        () => parent.removeEventListener("abort", onParentAbort),
        { once: true },
      );
    }
    return child;
  }

  private shouldReconnect(): boolean {
    if (this.maxReconnects === Infinity) return true;
    return this.reconnectAttempts < this.maxReconnects;
  }

  private computeBackoff(): number {
    const pow = Math.min(
      this.maxBackoffMs,
      this.initialBackoffMs * 2 ** Math.max(0, this.reconnectAttempts - 1),
    );
    // Small jitter (±10%) to avoid thundering-herd reconnects.
    const jitter = Math.random() * 0.2 - 0.1;
    return Math.max(this.initialBackoffMs, Math.floor(pow * (1 + jitter)));
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(true);
        return;
      }
      const t = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve(false);
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        signal?.removeEventListener("abort", onAbort);
        resolve(true);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      // Don't unref: the reconnect timer is a load-bearing part of the
      // bridge's lifecycle. Unref'ing it lets the event loop idle out
      // before the timer fires (visible in tests with vitest's runner).
    });
  }

  // ── state helpers ──────────────────────────────────────────────────────

  private transitionTo(next: BridgeState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit("state", next);
  }

  private failWith(err: Error): void {
    this.metrics.eventsDropped += 0;
    this.transitionTo("errored");
    this.emit("error", err);
  }

  private drop(type: string, reason: string): void {
    this.metrics.eventsDropped += 1;
    this.emit("drop", { type, reason });
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// ── factory / re-exports ────────────────────────────────────────────────────

export function createEventBridge(opts: {
  sdk: EventBridgeSdk;
  eventStore: EventStore;
  workspaceId?: string;
} & EventBridgeOptions): EventBridge {
  return new EventBridge(opts);
}
