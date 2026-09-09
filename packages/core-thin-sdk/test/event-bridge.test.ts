/**
 * event-bridge tests — verify mapping, back-pressure, reconnect, and
 * heartbeat behavior using a mock SDK that yields canned envelopes.
 *
 * The mock SDK implements the {@link EventBridgeSdk} contract: a
 * `subscribeEvents(query?, signal?)` that returns an `AsyncIterable`.
 * A fresh event pump is constructed on each `subscribeEvents()` call so
 * reconnect attempts don't share state.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  EventBridge,
  OPENCODE_EVENT_MAP,
  buildMappingIndex,
  mapOpencodeEvent,
  type EventStoreLike,
  type OpencodeEvent,
} from "../src/index.js"

/** Test-only EventStore stub. The real @max/core EventStore is not
 *  available in this package (would create a cycle) so we implement the
 *  structural EventStoreLike interface here. */
class FakeEventStore implements EventStoreLike {
  public events: any[] = []
  private seqs = new Map<string, number>()
  append(params: { type: string; aggregateId: string; data: unknown }) {
    const seq = (this.seqs.get(params.aggregateId) ?? 0) + 1
    this.seqs.set(params.aggregateId, seq)
    const e = {
      id: `ev-${seq}-${params.aggregateId}`,
      type: params.type,
      aggregateId: params.aggregateId,
      data: params.data,
      timestamp: new Date().toISOString(),
      seq,
    }
    this.events.push(e)
    return e
  }
  recentForWorkspace(workspaceId: string, limit = 100) {
    return this.events.filter((e) => e.aggregateId === workspaceId).slice(-limit)
  }
  getEvents(aggregateId: string, fromSeq?: number) {
    return this.events.filter(
      (e) => e.aggregateId === aggregateId && (fromSeq === undefined || e.seq > fromSeq),
    )
  }
}
import type { EventBridgeSdk } from "../src/event-bridge.js";

// Pump-driven async iterables cause vitest's unhandled-rejection
// watcher to occasionally fire between the time the pump rejects its
// internal promise and the bridge's `consumeStream` catches the
// `for await` throw. Swallow pump-origin rejections so tests stay
// focused on bridge behavior.
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (
    message.includes("fail-") ||
    message.includes("event-pump-error") ||
    message.includes("synthetic-failure-")
  ) {
    return;
  }
  // Re-throw for unrelated rejections so the test suite isn't silently
  // hiding real bugs.
  throw reason;
});

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * A controllable async-iterable producer. Tests push envelopes with
 * `push()`, terminate the stream with `end()`, error it with `error()`,
 * or abort it via the signal passed to `subscribeEvents()`.
 */
interface EventPump {
  iterable: AsyncIterable<OpencodeEvent>;
  push: (e: OpencodeEvent) => void;
  pushMany: (events: OpencodeEvent[]) => void;
  end: () => void;
  error: (err: Error) => void;
  pendingCount: () => number;
}

function makeEventPump(signal?: AbortSignal): EventPump {
  // Track errors separately so we can surface them via *rejection of the
  // NEXT call to next()*. We never reject a pending next() in-place: that
  // path is racy with vitest's unhandled-rejection watcher and adds nothing
  // the deferred-rejection path can't already do.
  const queue: OpencodeEvent[] = [];
  const pendingErrors: Error[] = [];
  let resolver: ((v: IteratorResult<OpencodeEvent>) => void) | null = null;
  let rejecter: ((err: unknown) => void) | null = null;
  let endReason: "end" | "error" | null = null;
  let errorDelivered = false;
  let aborted = signal?.aborted ?? false;

  const onAbort = () => {
    aborted = true;
    if (resolver) {
      resolver({ value: undefined as unknown as OpencodeEvent, done: true });
      resolver = null;
      rejecter = null;
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const iterable: AsyncIterable<OpencodeEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next: (): Promise<IteratorResult<OpencodeEvent>> => {
          if (aborted) {
            return Promise.resolve({
              value: undefined as unknown as OpencodeEvent,
              done: true,
            });
          }
          // In-flight rejection: error() was called while a next() was
          // pending. Reject the pending promise so the for-await sees
          // the error via its try/catch chain.
          if (endReason === "error" && !errorDelivered && rejecter) {
            errorDelivered = true;
            const err = pendingErrors.shift() ?? new Error("event-pump-error");
            const r = rejecter;
            resolver = null;
            rejecter = null;
            r(err);
            return new Promise<IteratorResult<OpencodeEvent>>((_, reject) => {
              reject(err);
            }).catch((e: unknown) => {
              throw e;
            });
          }
          if (
            (endReason === "error" && errorDelivered) ||
            (endReason === "error" && !rejecter)
          ) {
            // Either already delivered via in-flight, or queued for the
            // next next() call.
            if (!errorDelivered && pendingErrors.length > 0) {
              errorDelivered = true;
              const err = pendingErrors.shift()!;
              endReason = null;
              return new Promise<IteratorResult<OpencodeEvent>>((_, reject) => {
                reject(err);
              }).catch((e: unknown) => {
                throw e;
              });
            }
          }
          if (endReason === "end") {
            return Promise.resolve({
              value: undefined as unknown as OpencodeEvent,
              done: true,
            });
          }
          if (queue.length > 0) {
            const value = queue.shift()!;
            return Promise.resolve({ value, done: false });
          }
          return new Promise<IteratorResult<OpencodeEvent>>((resolve, reject) => {
            resolver = resolve;
            rejecter = reject;
            if (aborted) {
              resolve({
                value: undefined as unknown as OpencodeEvent,
                done: true,
              });
              resolver = null;
              rejecter = null;
            } else if (endReason === "end") {
              resolve({
                value: undefined as unknown as OpencodeEvent,
                done: true,
              });
              resolver = null;
              rejecter = null;
            } else if (endReason === "error" && !errorDelivered) {
              errorDelivered = true;
              const err = pendingErrors.shift() ?? new Error("event-pump-error");
              endReason = null;
              reject(err);
              resolver = null;
              rejecter = null;
            }
          });
        },
        return: () => {
          aborted = true;
          if (resolver) {
            resolver({
              value: undefined as unknown as OpencodeEvent,
              done: true,
            });
            resolver = null;
            rejecter = null;
          }
          return Promise.resolve({
            value: undefined as unknown as OpencodeEvent,
            done: true,
          });
        },
      };
    },
  };

  return {
    iterable,
    push: (e: OpencodeEvent) => {
      if (endReason || aborted) return;
      if (resolver) {
        resolver({ value: e, done: false });
        resolver = null;
        rejecter = null;
        return;
      }
      queue.push(e);
    },
    pushMany: (events: OpencodeEvent[]) => {
      for (const e of events) {
        if (endReason || aborted) return;
        if (resolver) {
          resolver({ value: e, done: false });
          resolver = null;
          rejecter = null;
          continue;
        }
        queue.push(e);
      }
    },
    end: () => {
      endReason = "end";
      if (resolver) {
        resolver({
          value: undefined as unknown as OpencodeEvent,
          done: true,
        });
        resolver = null;
        rejecter = null;
      }
    },
    error: (err: Error) => {
      endReason = "error";
      pendingErrors.push(err);
      // Reject any in-flight next() so the consumer sees the error
      // immediately. If no next() is in flight, the next call will
      // pick up `pendingErrors` instead.
      if (resolver && rejecter && !errorDelivered) {
        errorDelivered = true;
        const e = pendingErrors.shift()!;
        const r = rejecter;
        resolver = null;
        rejecter = null;
        endReason = null;
        r(e);
      }
    },
    pendingCount: () => queue.length,
  };
}

/**
 * Build a mock SDK that creates a brand-new pump on every `subscribeEvents`.
 * Tests grab the latest pump via `pumps[pumps.length - 1]` to feed envelopes.
 */
function makeSdk(opts?: { onSubscribe?: (n: number) => void }): {
  sdk: EventBridgeSdk;
  pumps: EventPump[];
} {
  const pumps: EventPump[] = [];
  const sdk: EventBridgeSdk = {
    subscribeEvents(_q, signal) {
      const pump = makeEventPump(signal);
      pumps.push(pump);
      opts?.onSubscribe?.(pumps.length);
      return pump.iterable;
    },
  };
  return { sdk, pumps };
}

const sampleSessionEvent = (
  type: string,
  data: Record<string, unknown>,
): OpencodeEvent => ({
  id: "evt_1",
  type,
  data,
});

const tick = (ms = 20): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  pred: () => boolean,
  timeoutMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await tick();
  }
  throw new Error(`waitFor: predicate did not become true within ${timeoutMs}ms`);
}

// ── mapping unit tests ────────────────────────────────────────────────────

describe("OPENCODE_EVENT_MAP", () => {
  const index = buildMappingIndex();

  it("maps the documented opencode events to Maximilian types", () => {
    const expectations: Array<[string, string]> = [
      ["session.next.text.delta", "message:delta"],
      ["session.next.text.part", "message:part"],
      ["message.part.delta", "message:part"],
      ["message.updated", "message:part"],
      ["message.part.updated", "message:part"],
      ["session.next.user.message", "message:user"],
      ["session.next.tool.called", "tool:called"],
      ["session.next.tool.progress", "tool:progress"],
      ["session.next.tool.success", "tool:success"],
      ["session.next.tool.failed", "tool:failed"],
      ["session.next.compaction.started", "compaction:start"],
      ["session.compacted", "compaction:done"],
      ["session.error", "session:error"],
      ["session.idle", "session:idle"],
      ["session.status", "session:status"],
      ["permission.v2.asked", "permission:asked"],
      ["permission.asked", "permission:asked"],
      ["permission.v2.replied", "permission:replied"],
      ["permission.replied", "permission:replied"],
      ["question.v2.asked", "question:asked"],
      ["question.asked", "question:asked"],
      ["question.v2.replied", "question:replied"],
      ["question.replied", "question:replied"],
      ["question.v2.rejected", "question:rejected"],
      ["question.rejected", "question:rejected"],
      ["todo.updated", "todo:updated"],
      ["lsp.updated", "lsp:updated"],
      ["mcp.tools.changed", "mcp:tools:changed"],
      ["pty.created", "pty:created"],
      ["pty.exited", "pty:exited"],
      ["workspace.ready", "workspace:ready"],
      ["workspace.failed", "workspace:failed"],
      ["workspace.status", "workspace:status"],
      ["server.connected", "server:connected"],
      ["session.next.prompted", "message:user"],
      ["session.next.prompt.admitted", "message:user"],
      ["session.next.compaction.start", "compaction:start"],
    ];

    expect(OPENCODE_EVENT_MAP.length).toBeGreaterThanOrEqual(expectations.length);

    for (const [opencodeType, maxType] of expectations) {
      const entry = index.get(opencodeType);
      expect(entry, `no mapping for ${opencodeType}`).toBeDefined();
      expect(entry?.maxType).toBe(maxType);
    }
  });

  it("falls back to unknown:* for unmapped events", () => {
    const draft = mapOpencodeEvent(
      { type: "some.future.event", data: {} },
      index,
      "ws-1",
    );
    expect(draft.type).toBe("unknown:some.future.event");
    expect(draft.aggregateId).toBe("ws-1");
  });

  it("preserves aggregateId from sessionID when no location is set", () => {
    const draft = mapOpencodeEvent(
      sampleSessionEvent("session.next.text.delta", {
        sessionID: "ses_42",
        assistantMessageID: "msg_1",
        textID: "txt_1",
        delta: "hello",
      }),
      index,
      "ws-default",
    );
    expect(draft.type).toBe("message:delta");
    expect(draft.aggregateId).toBe("ses_42");
    expect(draft.data).toMatchObject({
      sessionID: "ses_42",
      messageID: "msg_1",
      textID: "txt_1",
      delta: "hello",
    });
  });

  it("prefers location.workspaceID over data.sessionID", () => {
    const draft = mapOpencodeEvent(
      {
        id: "evt_x",
        type: "lsp.updated",
        data: {},
        location: { workspaceID: "ws-override" },
      },
      index,
      "ws-default",
    );
    expect(draft.aggregateId).toBe("ws-override");
  });
});

// ── bridge integration tests ──────────────────────────────────────────────

describe("EventBridge", () => {
  let store: EventStore;
  // Track all bridges so `afterEach` can stop any stragglers.
  const bridges: EventBridge[] = [];

  beforeEach(() => {
    store = new FakeEventStore();
    bridges.length = 0;
  });

  afterEach(async () => {
    for (const b of bridges) {
      if (b.getState() !== "stopped") {
        await b.stop().catch(() => {
          /* swallow */
        });
      }
    }
  });

  function buildBridge(
    opts: ConstructorParameters<typeof EventBridge>[0],
  ): EventBridge {
    const b = new EventBridge(opts);
    bridges.push(b);
    return b;
  }

  it("dispatches mapped events into the EventStore", async () => {
    const { sdk, pumps } = makeSdk();
    const bridge = buildBridge({
      sdk,
      eventStore: store,
      workspaceId: "ws-1",
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      maxReconnects: 0,
    });

    await bridge.start();
    // First subscribe call creates the initial pump.
    await waitFor(() => pumps.length === 1);
    const p0 = pumps[0];
    p0.pushMany([
      sampleSessionEvent("session.next.text.delta", {
        sessionID: "ses_1",
        assistantMessageID: "msg_1",
        textID: "txt_1",
        delta: "hello ",
      }),
      sampleSessionEvent("session.next.text.delta", {
        sessionID: "ses_1",
        assistantMessageID: "msg_1",
        textID: "txt_1",
        delta: "world",
      }),
      sampleSessionEvent("session.idle", { sessionID: "ses_1" }),
    ]);

    await waitFor(() => store.getEvents("ses_1").length >= 3);
    const events = store.getEvents("ses_1");
    expect(events.map((e) => e.type)).toEqual([
      "message:delta",
      "message:delta",
      "session:idle",
    ]);
    expect(events[0].data).toMatchObject({ delta: "hello " });
    expect(events[2].data).toMatchObject({ sessionID: "ses_1" });

    const metrics = bridge.getMetrics();
    expect(metrics.eventsReceived).toBe(3);
    expect(metrics.eventsMapped).toBe(3);
    expect(metrics.eventsAppended).toBe(3);
    expect(metrics.eventsDropped).toBe(0);

    await bridge.stop();
    expect(bridge.getState()).toBe("stopped");
  });

  it("falls back to workspaceId when neither location nor sessionID is set", async () => {
    const { sdk, pumps } = makeSdk();
    const bridge = buildBridge({
      sdk,
      eventStore: store,
      workspaceId: "ws-fallback",
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      maxReconnects: 0,
    });

    await bridge.start();
    await waitFor(() => pumps.length === 1);
    pumps[0].push({
      id: "evt_1",
      type: "server.connected",
      data: {},
    });

    await waitFor(() => store.getEvents("ws-fallback").length > 0);
    expect(store.getEvents("ws-fallback").map((e) => e.type)).toContain(
      "server:connected",
    );

    await bridge.stop();
  });

  it("emits unknown:* events for unmapped types instead of dropping them", async () => {
    const { sdk, pumps } = makeSdk();
    const bridge = buildBridge({
      sdk,
      eventStore: store,
      workspaceId: "ws-1",
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      maxReconnects: 0,
    });

    await bridge.start();
    await waitFor(() => pumps.length === 1);
    pumps[0].push({ type: "future.event.kind", data: { foo: "bar" } });

    await waitFor(() => store.getEvents("ws-1").length > 0);
    const events = store.getEvents("ws-1");
    expect(events.map((e) => e.type)).toEqual(["unknown:future.event.kind"]);
    expect(events[0].data).toMatchObject({ opencodeType: "future.event.kind" });

    await bridge.stop();
  });

  it("ignores non-envelope values without throwing", async () => {
    const { sdk, pumps } = makeSdk();
    const bridge = buildBridge({
      sdk,
      eventStore: store,
      workspaceId: "ws-1",
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      maxReconnects: 0,
    });

    await bridge.start();
    await waitFor(() => pumps.length === 1);
    const p0 = pumps[0];
    p0.push({ type: "garbage" } as OpencodeEvent);
    p0.push({} as unknown as OpencodeEvent);
    p0.push(null as unknown as OpencodeEvent);
    p0.push(sampleSessionEvent("session.idle", { sessionID: "ses_x" }));

    await waitFor(() => store.getEvents("ses_x").length >= 1);

    // `garbage` is technically an envelope (has a `type` field) and gets
    // mapped to `unknown:garbage`; only `{}` and `null` are recognized as
    // non-envelopes and dropped.
    const ev = store.getEvents("ses_x");
    expect(ev.map((e) => e.type)).toEqual(["session:idle"]);
    const metrics = bridge.getMetrics();
    expect(metrics.eventsReceived).toBe(4);
    expect(metrics.eventsMapped).toBe(2);
    expect(metrics.eventsDropped).toBeGreaterThanOrEqual(2);

    await bridge.stop();
  });

  it("buffers when the store reports busy and drains once ready", async () => {
    const { sdk, pumps } = makeSdk();
    let gateOpen = false;
    const isReady = () => gateOpen;

    const bridge = buildBridge({
      sdk,
      eventStore: store,
      workspaceId: "ws-1",
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      maxReconnects: 0,
      isReady,
    });

    await bridge.start();
    await waitFor(() => pumps.length === 1);
    pumps[0].pushMany([
      sampleSessionEvent("session.idle", { sessionID: "ses_buf" }),
      sampleSessionEvent("session.idle", { sessionID: "ses_buf" }),
      sampleSessionEvent("session.idle", { sessionID: "ses_buf" }),
    ]);

    // Give the bridge time to map + try (and fail) to drain.
    await tick(40);

    expect(store.getEvents("ses_buf")).toHaveLength(0);
    expect(bridge.getBufferDepth()).toBe(3);
    const blocked = bridge.getMetrics();
    expect(blocked.eventsMapped).toBe(3);
    expect(blocked.eventsAppended).toBe(0);
    expect(blocked.backpressureWaits).toBeGreaterThanOrEqual(1);

    gateOpen = true;
    await waitFor(() => store.getEvents("ses_buf").length >= 3);

    expect(store.getEvents("ses_buf").map((e) => e.type)).toEqual([
      "session:idle",
      "session:idle",
      "session:idle",
    ]);
    const after = bridge.getMetrics();
    expect(after.eventsAppended).toBe(3);
    expect(after.eventsDropped).toBe(0);

    await bridge.stop();
  });

  it("drops events when the buffer reaches its high watermark", async () => {
    const { sdk, pumps } = makeSdk();
    const bridge = buildBridge({
      sdk,
      eventStore: store,
      workspaceId: "ws-1",
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      appendBufferHighWatermark: 2,
      // Never-ready so the buffer never drains.
      isReady: () => false,
      // Disable reconnect-on-close so we don't loop after the test stops.
      maxReconnects: 0,
    });

    await bridge.start();
    await waitFor(() => pumps.length === 1);

    const errors: unknown[] = [];
    bridge.on("drop", (info) => errors.push(info));

    for (let i = 0; i < 5; i++) {
      pumps[0].push(sampleSessionEvent("session.idle", { sessionID: "ses_drop" }));
    }
    await waitFor(
      () => bridge.getMetrics().eventsDropped >= 3,
      500,
    );

    const m = bridge.getMetrics();
    expect(m.eventsReceived).toBe(5);
    expect(m.eventsDropped).toBeGreaterThanOrEqual(3);
    expect(errors.length).toBeGreaterThanOrEqual(3);

    await bridge.stop();
  });

  it("reconnects with exponential backoff when the stream errors", async () => {
    const { sdk, pumps } = makeSdk();

    const bridge = buildBridge({
      sdk,
      eventStore: store,
      workspaceId: "ws-1",
      initialBackoffMs: 5,
      maxBackoffMs: 20,
      maxReconnects: 3,
      heartbeatTimeoutMs: 1_000_000, // disabled for this test
    });

    const errors: Error[] = [];
    const reconnects: Array<{ attempt: number; delayMs: number }> = [];
    bridge.on("error", (err: Error) => errors.push(err));
    bridge.on("reconnect", (info) => reconnects.push(info));

    await bridge.start();
    await waitFor(() => pumps.length >= 1);
    pumps[0].error(new Error("synthetic-failure-1"));

    // Wait for reconnect attempt #1 to spawn pump #2.
    await waitFor(() => pumps.length >= 2);

    pumps[1].push(
      sampleSessionEvent("session.idle", { sessionID: "ses_recover" }),
    );
    await waitFor(() => store.getEvents("ses_recover").length > 0);

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(reconnects.length).toBeGreaterThanOrEqual(1);
    expect(reconnects[0].attempt).toBe(1);
    expect(reconnects[0].delayMs).toBeGreaterThan(0);

    const metrics = bridge.getMetrics();
    expect(metrics.reconnects).toBeGreaterThanOrEqual(1);
    expect(metrics.eventsAppended).toBeGreaterThanOrEqual(1);

    await bridge.stop();
  });

  it("backs off increasingly on consecutive failures (exponential)", async () => {
    const { sdk, pumps } = makeSdk();
    const delays: number[] = [];
    const errors: Error[] = [];
    const bridge = buildBridge({
      sdk,
      eventStore: store,
      workspaceId: "ws-1",
      initialBackoffMs: 10,
      maxBackoffMs: 80,
      maxReconnects: 5,
      heartbeatTimeoutMs: 1_000_000,
    });
    bridge.on("reconnect", (info) => delays.push(info.delayMs));
    bridge.on("error", (err: Error) => errors.push(err));

    await bridge.start();
    await waitFor(() => pumps.length >= 1);

    // Force 3 errors back-to-back.
    for (let i = 0; i < 3; i++) {
      // Cast away the Abstract methods — these are bridges/pumps, just need
      // .error to be called.
      pumps[i].error(new Error(`fail-${i}`));
      await waitFor(() => pumps.length > i + 1, 2000);
    }
    await bridge.stop();

    expect(delays.length).toBeGreaterThanOrEqual(3);
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(delays[0]).toBeGreaterThanOrEqual(8); // initial - jitter
    expect(delays[1]).toBeGreaterThanOrEqual(delays[0]);
  });

  it("reconnects when no events arrive within the heartbeat window", async () => {
    const { sdk, pumps } = makeSdk();
    const bridge = buildBridge({
      sdk,
      eventStore: store,
      workspaceId: "ws-1",
      initialBackoffMs: 5,
      maxBackoffMs: 20,
      maxReconnects: 2,
      heartbeatTimeoutMs: 60, // aggressive so the test finishes quickly
    });

    const errors: Error[] = [];
    bridge.on("error", (err: Error) => errors.push(err));

    await bridge.start();
    await waitFor(() => pumps.length >= 1);
    pumps[0].push(sampleSessionEvent("server.connected", {}));

    await waitFor(
      () => errors.some((e) => /heartbeat/i.test(e.message)),
      500,
    );
    const timeoutErrors = errors.filter((e) => /heartbeat/i.test(e.message));
    expect(timeoutErrors.length).toBeGreaterThanOrEqual(1);
    expect(bridge.getMetrics().heartbeatTimeouts).toBeGreaterThanOrEqual(1);

    await bridge.stop();
  });

  it("stops cleanly mid-stream and does not append after stop()", async () => {
    const { sdk, pumps } = makeSdk();
    const bridge = buildBridge({
      sdk,
      eventStore: store,
      workspaceId: "ws-1",
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      maxReconnects: 99,
    });

    await bridge.start();
    await waitFor(() => pumps.length >= 1);
    pumps[0].push(sampleSessionEvent("session.idle", { sessionID: "ses_stop" }));

    await waitFor(() => store.getEvents("ses_stop").length === 1);
    expect(bridge.getState()).toBe("running");

    await bridge.stop();
    expect(bridge.getState()).toBe("stopped");

    // Push another event after stop — must NOT be appended.
    pumps[0].push(sampleSessionEvent("session.idle", { sessionID: "ses_stop" }));
    await tick(50);

    const events = store.getEvents("ses_stop");
    expect(events.length).toBe(1);
  });
});
