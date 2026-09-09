/**
 * routes/opencode.ts — REST + SSE surface for the opencode bridge.
 *
 * 借鉴 opencode: mirrors the opencode SDK's read endpoints
 * (`GET /session`, `GET /session/:id`) and its SSE stream
 * (`GET /event?since=...`). We don't proxy the upstream server directly —
 * Maximilian keeps a local projection of session state so the UI works
 * even when the upstream opencode process is restarting.
 *
 * Endpoints (mounted under both `/api/` and `/api/v1/`):
 *   GET /api/opencode/sessions               — list active sessions
 *   GET /api/opencode/sessions/:id           — session details (events included)
 *   GET /api/opencode/health                 — supervisor + bridge health
 *   GET /api/opencode/events?since=<seq>     — SSE stream of session updates
 *
 * State source: `OpencodeStateStore` (singleton) — kept in sync by callers
 * feeding `applyEvent()` from the EventBridge (Phase 4b wires this up).
 */

import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { getLogger } from "@max/telemetry";
import type { Supervisor } from "@max/core-thin-sdk";
import { ErrorSchema, IdParamsSchema } from "../schemas.js";
import {
  getOpencodeStateStore,
  type OpencodeSessionState,
  type OpencodeSessionsSnapshot,
} from "../opencode-state-store.js";

const log = getLogger("opencode-route");

// ── OpenAPI route definitions ─────────────────────────────────────────────

export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  aggregateId: z.string(),
  status: z.string(),
  messageCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  lastEventAt: z.string(),
  lastEventType: z.string(),
  lastError: z.string().optional(),
});

export const SessionListResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  generatedAt: z.string(),
  sessions: z.array(SessionSummarySchema),
});

export const SessionDetailSchema = SessionSummarySchema.extend({
  recent: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      timestamp: z.string(),
      seq: z.number().int(),
      data: z.unknown(),
    }),
  ),
});

export const HealthStatusSchema = z.object({
  supervisor: z.enum(["not_configured", "stopped", "running", "starting", "errored", "fatal"]),
  healthy: z.boolean(),
  port: z.number().int().nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  restartCount: z.number().int().nonnegative().optional(),
  uptimeMs: z.number().int().nonnegative().optional(),
  lastError: z.string().nullable().optional(),
  bridge: z.object({
    state: z.string(),
    metrics: z.object({
      eventsReceived: z.number().int().nonnegative(),
      eventsMapped: z.number().int().nonnegative(),
      eventsAppended: z.number().int().nonnegative(),
      eventsDropped: z.number().int().nonnegative(),
      reconnects: z.number().int().nonnegative(),
      heartbeatTimeouts: z.number().int().nonnegative(),
    }),
  }),
});

export const listOpencodeSessionsRoute = createRoute({
  method: "get",
  path: "/opencode/sessions",
  tags: ["opencode"],
  responses: {
    200: {
      content: { "application/json": { schema: SessionListResponseSchema } },
      description: "Active opencode sessions",
    },
  },
});

export const getOpencodeSessionRoute = createRoute({
  method: "get",
  path: "/opencode/sessions/{id}",
  tags: ["opencode"],
  request: { params: IdParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: SessionDetailSchema } },
      description: "Session detail with recent events",
    },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Session not found" },
  },
});

export const opencodeHealthRoute = createRoute({
  method: "get",
  path: "/opencode/health",
  tags: ["opencode"],
  responses: {
    200: {
      content: { "application/json": { schema: HealthStatusSchema } },
      description: "Supervisor + bridge health",
    },
  },
});

export const opencodeEventsRoute = createRoute({
  method: "get",
  path: "/opencode/events",
  tags: ["opencode"],
  responses: {
    200: {
      content: { "application/json": { schema: z.unknown() } },
      description: "SSE stream of session snapshot updates",
    },
  },
});

// ── wiring ─────────────────────────────────────────────────────────────────

export interface OpencodeRouteDeps {
  /** Optional supervisor — when absent the route reports `not_configured`. */
  supervisor?: Supervisor;
  /** Accessor for the bridge metrics — returns the same shape EventBridge emits. */
  bridgeSnapshot?: () => {
    state: string;
    metrics: {
      eventsReceived: number;
      eventsMapped: number;
      eventsAppended: number;
      eventsDropped: number;
      reconnects: number;
      heartbeatTimeouts: number;
    };
  };
}

/**
 * Convert the internal `OpencodeSessionState` to the public wire shape
 * (drops `recent` for the list endpoint to keep responses small).
 */
function toSummary(s: OpencodeSessionState): z.infer<typeof SessionSummarySchema> {
  return {
    sessionId: s.sessionId,
    aggregateId: s.aggregateId,
    status: s.status,
    messageCount: s.messageCount,
    toolCallCount: s.toolCallCount,
    lastEventAt: s.lastEventAt,
    lastEventType: s.lastEventType,
    ...(s.lastError !== undefined ? { lastError: s.lastError } : {}),
  };
}

function toDetail(s: OpencodeSessionState): z.infer<typeof SessionDetailSchema> {
  return {
    ...toSummary(s),
    recent: s.recent.map((e) => ({
      id: e.id,
      type: e.type,
      timestamp: e.timestamp,
      seq: e.seq,
      data: e.data,
    })),
  };
}

export function opencodeRoutes(deps: OpencodeRouteDeps = {}) {
  const { supervisor, bridgeSnapshot } = deps;
  const store = getOpencodeStateStore();

  async function readSupervisorHealth(): Promise<z.infer<typeof HealthStatusSchema>> {
    if (!supervisor) {
      return {
        supervisor: "not_configured",
        healthy: false,
        bridge: bridgeSnapshot
          ? bridgeSnapshot()
          : {
              state: "not_configured",
              metrics: {
                eventsReceived: 0,
                eventsMapped: 0,
                eventsAppended: 0,
                eventsDropped: 0,
                reconnects: 0,
                heartbeatTimeouts: 0,
              },
            },
      };
    }

    const healthy = await supervisor.isHealthy.catch(() => false);
    const state = supervisor.running
      ? healthy
        ? "running"
        : "errored"
      : supervisor.restartCount > 0
        ? "errored"
        : "stopped";

    return {
      supervisor: state,
      healthy,
      port: supervisor.port ? await supervisor.port.catch(() => null) : null,
      baseUrl: supervisor.baseUrl ? await supervisor.baseUrl.catch(() => null) : null,
      restartCount: supervisor.restartCount,
      uptimeMs: supervisor.uptimeMs,
      lastError: supervisor.lastError ? supervisor.lastError.message : null,
      bridge: bridgeSnapshot
        ? bridgeSnapshot()
        : {
            state: "not_configured",
            metrics: {
              eventsReceived: 0,
              eventsMapped: 0,
              eventsAppended: 0,
              eventsDropped: 0,
              reconnects: 0,
              heartbeatTimeouts: 0,
            },
          },
    };
  }

  return {
    listSessions: async (c: Context) => {
      const snap = store.snapshot();
      return c.json({
        count: snap.sessions.length,
        generatedAt: snap.generatedAt,
        sessions: snap.sessions.map(toSummary),
      });
    },

    getSession: async (c: Context) => {
      const id = c.req.param("id");
      if (!id) return c.json({ error: "Missing session id" }, 400);
      const session = store.getSession(id);
      if (!session) return c.json({ error: "Session not found" }, 404);
      return c.json(toDetail(session));
    },

    health: async (c: Context) => {
      try {
        return c.json(await readSupervisorHealth());
      } catch (err) {
        log.warn({ err }, "opencode health probe failed");
        return c.json({ error: "health_probe_failed" }, 500);
      }
    },

    /**
     * SSE stream — pushes the latest `OpencodeSessionsSnapshot` whenever
     * any session changes. The wire format mirrors our other SSE endpoints:
     *   event: snapshot
     *   data: { ...JSON... }
     *   event: heartbeat
     *   data: {"ts":...}
     */
    events: async (c: Context) => {
      const sinceParam = c.req.query("since");
      const sinceSeq = sinceParam ? Number(sinceParam) : undefined;

      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const stream = new ReadableStream({
        start(controller) {
          const send = (event: string, data: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
              );
            } catch {
              closed = true;
            }
          };

          // Send current snapshot as the first frame so a freshly-mounted
          // client immediately has the list without waiting for the next
          // change. This is the standard replay-friendly SSE pattern used
          // by /api/events/bus and /api/workspaces/:id/stream.
          send("snapshot", filterSnapshot(store.snapshot(), sinceSeq));

          const onChange = (snap: OpencodeSessionsSnapshot) => {
            send("snapshot", snap);
          };
          store.on("change", onChange);
          unsubscribe = () => {
            store.off("change", onChange);
          };

          // 15s heartbeat — proxies drop idle SSE connections at ~60s.
          heartbeat = setInterval(() => {
            send("heartbeat", { ts: new Date().toISOString() });
          }, 15_000);
          const t = heartbeat as unknown as { unref?: () => void };
          t.unref?.();
        },
        cancel() {
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = undefined;
          unsubscribe?.();
          unsubscribe = undefined;
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    },
  };
}

/**
 * Filter a snapshot by minimum event seq. When the client passes `since=`,
 * only sessions whose most recent event has `seq >= since` are emitted;
 * each session's `recent` tail is also trimmed. Returns the same shape
 * the snapshot helper produces, so the SSE wire stays consistent.
 */
function filterSnapshot(
  snap: OpencodeSessionsSnapshot,
  sinceSeq: number | undefined,
): OpencodeSessionsSnapshot {
  if (sinceSeq === undefined || !Number.isFinite(sinceSeq)) return snap;
  const minSeq = Math.max(0, Math.floor(sinceSeq));
  const sessions = snap.sessions
    .map((s) => ({
      ...s,
      recent: s.recent.filter((e) => e.seq > minSeq),
    }))
    .filter((s) => {
      // Keep sessions that still have at least one recent event beyond
      // the cursor OR have a fresh lastEventAt timestamp — without the
      // latter filter, an idle session that produced nothing past the
      // cursor would silently disappear from the stream.
      if (s.recent.length > 0) return true;
      return s.messageCount + s.toolCallCount > 0;
    });
  return { sessions, generatedAt: snap.generatedAt };
}
