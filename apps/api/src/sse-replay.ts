/**
 * SSE endpoint with durable replay — wraps a `JsonlEventLog` so
 * `Last-Event-ID` reconnects are served from disk instead of a
 * bounded in-memory ring.
 *
 * The existing `SseReplayBuffer` (in `lib/sse-replay.ts`) keeps only
 * the last 64 events per workspace; a slow client or a long disconnect
 * will have missed events that the buffer has since evicted. This
 * module uses the append-only JSONL log (`event-log.ts`) which never
 * evicts — every event since the workspace was created is replay-able.
 *
 * Wire format is identical to `SseReplayBuffer` — `id:` header carrying
 * the seq, `data:` line holding the JSON-encoded payload, blank-line
 * separator — so the browser `EventSource` and the existing
 * `parseLastEventId` / `encodeSseFrame` helpers work unchanged.
 */

import type { Context } from "hono";
import { getLogger } from "@max/telemetry";
import { JsonlEventLog, type LoggedEvent } from "./event-log.js";

const log = getLogger("api/sse-replay");

/** Map a LoggedEvent to the SSE wire frame: `id: <seq>\ndata: {...}\n\n`. */
export function encodeLoggedEvent(event: LoggedEvent): string {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse the `Last-Event-ID` header into a non-negative integer.
 * Mirrors `parseLastEventId` in `lib/sse-replay.ts` for consistency
 * with the existing SSE endpoint; diverges only in where the value
 * lands (here we map it to a seq of the JSONL log, not the buffer id).
 */
export function parseLastEventIdHeader(value: string | undefined | null): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

/**
 * Options for the SSE handler: a way to push live events to the open
 * stream. We expose an in-process pub-sub bus (simple callback set)
 * so callers like the runtime event sink can forward fresh events
 * without us taking a dependency on the EventBus machinery in
 * `index.ts`. The bus replays nothing on its own — that's what the
 * JsonlEventLog is for.
 */
export interface SseReplayOptions {
  /**
   * Subscribe to live events for `workspaceId`. Returns an unsubscribe
   * function. Receives a JSON-serializable payload to forward to the
   * client as an SSE frame. Events are appended to the log *before*
   * being pushed so a reconnecting client replays them from disk.
   */
  subscribe?: (
    workspaceId: string,
    onEvent: (payload: unknown) => void,
  ) => () => void;
  /**
   * Hook invoked when a client connects — used to send a one-shot
   * "current state" snapshot that the client needs even if the log
   * is empty. Return null to skip.
   */
  onConnect?: (workspaceId: string) => Promise<Record<string, unknown> | null>;
}

/**
 * Create a Hono-compatible handler for `GET /api/workspaces/:id/stream`
 * backed by the given JsonlEventLog. Returns `(req: Request) => Response`
 * — the caller is responsible for mounting it on the Hono `app`.
 *
 * Protocol:
 *   1. Read `Last-Event-ID` header (seq of the last event the client saw).
 *   2. Append a "connected" event to the log (so reconnects mark when the
 *      last session ended).
 *   3. Replay all events in the log with `seq > lastEventId`.
 *   4. Stream new events as they arrive via `subscribe`.
 *  5. Send `: ping\n\n` every 25s to keep proxies from closing the connection.
 */
export function createSseHandler(
  registry: { forWorkspace(id: string): JsonlEventLog },
  opts: SseReplayOptions = {},
): (c: Context) => Response {
  return (c: Context): Response => {
    const workspaceId = c.req.param("id") ?? new URL(c.req.url).searchParams.get("id") ?? "";
    if (!workspaceId) {
      return new Response(JSON.stringify({ error: "missing id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const log_ = registry.forWorkspace(workspaceId);
    const encoder = new TextEncoder();
    let unsub: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    let lastSentSeq = 0;

    const lastEventId = parseLastEventIdHeader(c.req.header("Last-Event-ID"));

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = (bytes: Uint8Array): boolean => {
          if (closed) return false;
          try {
            controller.enqueue(bytes);
            return true;
          } catch {
            return false;
          }
        };
        const cleanup = () => {
          if (closed) return;
          closed = true;
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = undefined;
          }
          if (unsub) {
            try {
              unsub();
            } catch {
              /* ignore */
            }
            unsub = undefined;
          }
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        };

        // SSE connections get dropped silently by nginx/ALB after 60s
        // of idleness. Send a comment frame every 25s to keep the
        // connection alive.
        heartbeat = setInterval(() => {
          if (closed) return;
          if (!send(encoder.encode(": ping\n\n"))) cleanup();
        }, 25_000);

        // 1. Fire the onConnect hook to deliver a one-shot snapshot that
        //    the client always needs as a baseline.
        try {
          if (opts.onConnect) {
            const snapshot = await opts.onConnect(workspaceId);
            if (snapshot) {
              send(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
            }
          }
        } catch (err) {
          log.warn({ err, workspaceId }, "sse onConnect failed");
        }

        // 2. Replay all events the client hasn't seen. We use `tail(0)`
        //    semantics — return all events with seq > lastEventId. If
        //    the log is empty (fresh workspace), this is a no-op.
        try {
          const replayEvents = await log_.readAfter(lastEventId);
          for (const ev of replayEvents) {
            if (ev.seq > lastSentSeq) lastSentSeq = ev.seq;
            const ok = send(encoder.encode(encodeLoggedEvent(ev)));
            if (!ok) {
              cleanup();
              return;
            }
          }
        } catch (err) {
          log.warn({ err, workspaceId }, "sse replay failed");
        }

        // 3. Stream future events via the registered subscriber.
        if (opts.subscribe) {
          unsub = opts.subscribe(workspaceId, (payload) => {
            // Append to the log first, then forward. The subscriber
            // does NOT need to provide a seq — we assign one here.
            log_
              .append("event", payload)
              .then((result) => {
                const frame = `id: ${result.seq}\ndata: ${JSON.stringify(payload)}\n\n`;
                if (!send(encoder.encode(frame))) cleanup();
              })
              .catch((err) => {
                log.warn({ err, workspaceId }, "sse live-append failed");
              });
          });
        }

        // 4. When no subscriber is registered, there's nothing to stream
        //    live — emit a `stream-end` sentinel frame and close the
        //    controller so readers unblock cleanly. With a subscriber the
        //    stream stays open for the life of the connection.
        if (!opts.subscribe) {
          const done = () => {
            if (closed) return;
            try {
              send(
                encoder.encode(
                  `event: stream-end\ndata: ${JSON.stringify({ ok: true, latestSeq: log_.latestSeq() })}\n\n`,
                ),
              );
            } catch {
              /* controller already dead */
            }
            cleanup();
          };
          // Defer to the next microtask so the snapshot/replay frames are
          // flushed before the close (otherwise a fast test that cancels
          // immediately would race the in-flight enqueues).
          queueMicrotask(done);
        }
      },
      cancel() {
        // Client disconnected — stop pushing.
        if (closed) return;
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
        unsub?.();
        unsub = undefined;
      },
    });

    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  };
}

/**
 * Builder-style helper for callers that want a self-contained event bus
 * wired between the runtime event sink and the SSE handler. Returns a
 * `subscribe` function and a `publish` function. Events published via
 * `publish(workspaceId, payload)` are delivered to every SSE client
 * whose stream is open for that workspace.
 *
 * Event objects are JSON-serializable. We don't attach seqs here —
 * `createSseHandler` is the owner of the log.
 */
export interface EventBus {
  publish(workspaceId: string, payload: unknown): void;
  subscribe(
    workspaceId: string,
    onEvent: (payload: unknown) => void,
  ): () => void;
  /** Count of currently subscribed clients (per workspace, summed). */
  size(): number;
}

export function createEventBus(): EventBus {
  const subs = new Map<string, Set<(payload: unknown) => void>>();
  return {
    publish(workspaceId, payload) {
      const set = subs.get(workspaceId);
      if (!set) return;
      for (const cb of [...set]) {
        try {
          cb(payload);
        } catch (err) {
          log.warn({ err, workspaceId }, "event-bus subscriber error");
        }
      }
    },
    subscribe(workspaceId, onEvent) {
      let set = subs.get(workspaceId);
      if (!set) {
        set = new Set();
        subs.set(workspaceId, set);
      }
      set.add(onEvent);
      return () => {
        const cur = subs.get(workspaceId);
        if (!cur) return;
        cur.delete(onEvent);
        if (cur.size === 0) subs.delete(workspaceId);
      };
    },
    size() {
      let n = 0;
      for (const set of subs.values()) n += set.size;
      return n;
    },
  };
}

/**
 * Convenience constructor: wires a JsonlEventLog, an EventBus, and the
 * Hono handler into something the caller can mount without thinking
 * about the pieces. The runtime event sink should call
 * `bus.publish(workspaceId, payload)` to fan out to SSE clients.
 */
export async function createSseReplaySubsystem(opts: {
  rootDir: string;
  loader?: () => Promise<typeof import("./event-log.js")>;
}) {
  // Lazy-import so we avoid a top-level dependency cycle in environments
  // where modules load each other in unusual order. Tests can pass a
  // `loader` that returns a re-exported module object; production can
  // omit it and we'll `import()` the canonical module.
  const mod =
    opts.loader !== undefined
      ? await opts.loader()
      : await import("./event-log.js");
  const { EventLogRegistry } = mod;
  const registry = new EventLogRegistry(opts.rootDir);
  const bus = createEventBus();
  const handler = createSseHandler(
    { forWorkspace: (id) => registry.for(id) },
    { subscribe: (id, cb) => bus.subscribe(id, cb) },
  );
  return { registry, bus, handler };
}
