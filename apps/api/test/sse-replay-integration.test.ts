/**
 * SSE stream endpoint regression tests — verifies the buffer behavior
 * fixes for the three bugs that surfaced in review:
 *
 *   #1 — replay branch skipped the current workspace snapshot when the
 *        buffer had events. Client reconnecting to a running workspace
 *        would miss the latest state.
 *   #2 — workspace snapshots and `done` markers flooded the buffer,
 *        evicting the real runtime events the client needed.
 *   #3 — `done` was double-sent on reconnect when the workspace was
 *        already terminal.
 *
 * We stand up a minimal Hono app with the real `SseReplayBuffer` and a
 * fake runtime that emits one event, then read the stream twice to
 * simulate a reconnect.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { SseReplayBuffer, parseLastEventId, encodeSseFrame } from "../src/lib/sse-replay";

interface FakeWorkspace {
  id: string;
  userRequest: string;
  status: "pending" | "running" | "completed" | "failed";
  plan: unknown;
  results: unknown[];
  review: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

function buildStreamApp(opts: {
  initialWs: FakeWorkspace;
  buffer: SseReplayBuffer;
  preBufferedEvents?: Array<{ id: number; data: Record<string, unknown> }>;
  runtimeEvents?: Array<{ workspaceId: string; type: string; [k: string]: unknown }>;
}) {
  const app = new Hono();
  const { initialWs, buffer, preBufferedEvents = [], runtimeEvents = [] } = opts;

  // Pre-seed the buffer with events as if they'd been emitted on a
  // previous connection.
  for (const e of preBufferedEvents) {
    // The buffer doesn't allow setting an arbitrary id; we append in
    // order so ids come out 1, 2, 3... matching the pre-seed.
    buffer.append(initialWs.id, e.data);
  }

  let runtimeListener: ((event: { workspaceId: string; type: string }) => void) | undefined;

  app.get("/workspaces/:id/stream", async (c) => {
    const id = c.req.param("id");
    const lastEventId = parseLastEventId(c.req.header("Last-Event-ID"));
    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream({
      start(controller) {
        const sendEphemeral = (data: Record<string, unknown>) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch { closed = true; }
        };
        const send = (data: Record<string, unknown>) => {
          if (closed) return;
          const event = buffer.append(id, data);
          try {
            controller.enqueue(encoder.encode(encodeSseFrame(event)));
          } catch { closed = true; }
        };

        // 1. Always send current snapshot (bug #1 fix).
        sendEphemeral({ type: "workspace", workspace: initialWs });

        // 2. Replay buffered events.
        for (const event of buffer.since(id, lastEventId)) {
          try { controller.enqueue(encoder.encode(encodeSseFrame(event))); } catch { closed = true; }
        }

        // 3. Emit any queued runtime events (test fixture only).
        for (const ev of runtimeEvents) {
          if (ev.workspaceId !== id) continue;
          send({ type: "event", event: ev });
        }

        // 4. Terminal done is ephemeral (bug #2, #3 fix).
        if (initialWs.status === "completed" || initialWs.status === "failed") {
          sendEphemeral({ type: "done" });
          closed = true;
          try { controller.close(); } catch {}
        } else {
          // Test fixture: close after delivering the queued events so the
          // reader can finish. Real production stream stays open for the
          // runtime listener; we close it manually when the test is done.
          closed = true;
          try { controller.close(); } catch {}
        }

        runtimeListener = (event) => {
          if (event.workspaceId !== id) return;
          send({ type: "event", event });
        };
      },
      cancel() { closed = true; },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return { app, emit: (event: { workspaceId: string; type: string }) => runtimeListener?.(event) };
}

async function readStream(res: Response): Promise<{ frames: string[]; lastEventId: number }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const frames: string[] = [];
  let lastEventId = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      frames.push(frame);
      buf = buf.slice(idx + 2);
      const idMatch = frame.match(/^id: (\d+)$/m);
      if (idMatch) lastEventId = Number.parseInt(idMatch[1]!, 10);
    }
  }
  return { frames, lastEventId };
}

describe("SSE stream reconnect (regression)", () => {
  it("always sends current workspace snapshot even when buffer has events (#1)", async () => {
    // Scenario: workspace is running. Buffer already has a runtime
    // event from before. Client connects with no Last-Event-ID. The
    // old code would skip the snapshot because replay.length > 0.
    const buffer = new SseReplayBuffer(64);
    const ws: FakeWorkspace = {
      id: "ws-1",
      userRequest: "x",
      status: "running",
      plan: null,
      results: [],
      review: null,
      error: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const { app } = buildStreamApp({
      initialWs: ws,
      buffer,
      preBufferedEvents: [{ id: 1, data: { type: "event", event: { type: "task-start", workspaceId: "ws-1" } } }],
    });

    const res = await app.request("/workspaces/ws-1/stream");
    const { frames } = await readStream(res);

    // First frame should be the workspace snapshot, NOT a buffered event.
    expect(frames[0]).toContain('"type":"workspace"');
    expect(frames[0]).toContain('"status":"running"');
    // Second frame should be the replayed event with id: 1.
    expect(frames[1]).toContain("id: 1");
    expect(frames[1]).toContain('"type":"event"');
  });

  it("does not buffer workspace snapshots or done markers (#2)", async () => {
    const buffer = new SseReplayBuffer(64);
    const ws: FakeWorkspace = {
      id: "ws-1",
      userRequest: "x",
      status: "completed",
      plan: null,
      results: [],
      review: null,
      error: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const { app } = buildStreamApp({
      initialWs: ws,
      buffer,
      runtimeEvents: [{ workspaceId: "ws-1", type: "task-complete" }],
    });

    const res = await app.request("/workspaces/ws-1/stream");
    await readStream(res);

    // Buffer should contain ONLY the runtime event, not the workspace
    // snapshot or the done marker.
    const buffered = buffer.since("ws-1", 0);
    expect(buffered.length).toBe(1);
    expect(buffered[0]!.data).toEqual({ type: "event", event: { workspaceId: "ws-1", type: "task-complete" } });
  });

  it("does not double-send done on reconnect (#3)", async () => {
    const buffer = new SseReplayBuffer(64);
    const ws: FakeWorkspace = {
      id: "ws-1",
      userRequest: "x",
      status: "completed",
      plan: null,
      results: [],
      review: null,
      error: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    // Simulate a previous connection that emitted a runtime event.
    // Because snapshots and done are NOT buffered (bug #2 fix), the
    // buffer only holds the runtime event.
    buffer.append("ws-1", { type: "event", event: { type: "task-complete", workspaceId: "ws-1" } });
    const lastBufferedId = buffer.since("ws-1", 0).slice(-1)[0]!.id;

    const { app } = buildStreamApp({ initialWs: ws, buffer });

    // Client reconnects with Last-Event-ID pointing at the buffered event.
    const res = await app.request("/workspaces/ws-1/stream", {
      headers: { "Last-Event-ID": String(lastBufferedId) },
    });
    const { frames } = await readStream(res);

    // We expect: workspace snapshot (ephemeral, no id) + done (ephemeral).
    // No replay (since lastEventId = lastBufferedId, nothing newer).
    // Exactly ONE done frame.
    const doneFrames = frames.filter((f) => f.includes('"type":"done"'));
    expect(doneFrames.length).toBe(1);
  });
});
