/**
 * Durable replay event-log + SSE handler tests.
 *
 * Two pieces under test:
 *   - `JsonlEventLog` (`src/event-log.ts`) — append-only JSONL store
 *     with a per-workspace seq counter and a mkdir-lock guard on
 *     concurrent appends.
 *   - `createSseHandler` (`src/sse-replay.ts`) — Hono handler that
 *     replays from `Last-Event-ID` then streams live events via an
 *     injectable event bus.
 *
 * The SSE handler returns a raw `Response` with `text/event-stream`
 * body, so we read the stream with a `ReadableStream` reader and
 * split on the SSE blank-line separator (`\n\n`).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";

import { JsonlEventLog, EventLogRegistry } from "../src/event-log";
import {
  createSseHandler,
  createEventBus,
  parseLastEventIdHeader,
  encodeLoggedEvent,
} from "../src/sse-replay";
import type { LoggedEvent } from "../src/event-log";

/**
 * Helper: build a minimal Hono app that mounts the replay handler on
 * `GET /workspaces/:id/stream`. We do this so `Context.req.param("id")`
 * works exactly as it does in production — avoids hand-rolling a fake
 * Context object.
 */
function buildReplayApp(opts: { registry: EventLogRegistry; withBus?: boolean }) {
  const app = new Hono();
  const bus = opts.withBus ? createEventBus() : undefined;
  const handler = createSseHandler(
    { forWorkspace: (id) => opts.registry.for(id) },
    bus ? { subscribe: (id, cb) => bus.subscribe(id, cb) } : {},
  );
  app.get("/workspaces/:id/stream", handler);
  return { app, bus };
}

async function readStream(res: Response): Promise<{ frames: string[]; lastSeq: number }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const frames: string[] = [];
  let lastSeq = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      frames.push(frame);
      buf = buf.slice(idx + 2);
      const idMatch = frame.match(/^id: (\d+)$/m);
      if (idMatch) lastSeq = Number.parseInt(idMatch[1]!, 10);
    }
  }
  return { frames, lastSeq };
}

function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "sse-replay-test-"));
}

describe("JsonlEventLog", () => {
  let dir: string;
  let log: JsonlEventLog;

  beforeEach(async () => {
    dir = await tmpDir();
    log = new JsonlEventLog("ws-1", dir);
    await log.initialize();
  });

  afterEach(async () => {
    await log.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("appends events and reads them back in order", async () => {
    const r1 = await log.append("task-start", { a: 1 });
    const r2 = await log.append("task-complete", { a: 2 });
    const r3 = await log.append("done", { a: 3 });

    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(2);
    expect(r3.seq).toBe(3);

    const all = await log.readAfter(0);
    expect(all.length).toBe(3);
    expect(all[0]!.type).toBe("task-start");
    expect(all[0]!.seq).toBe(1);
    expect(all[1]!.type).toBe("task-complete");
    expect(all[2]!.type).toBe("done");
  });

  it("readAfter returns only events after the given seq", async () => {
    await log.append("e1", { n: 1 });
    await log.append("e2", { n: 2 });
    await log.append("e3", { n: 3 });
    await log.append("e4", { n: 4 });

    const after2 = await log.readAfter(2);
    expect(after2.map((e) => e.seq)).toEqual([3, 4]);
    expect(after2.map((e) => e.payload)).toEqual([{ n: 3 }, { n: 4 }]);

    // After the latest seq — nothing.
    const after4 = await log.readAfter(4);
    expect(after4).toEqual([]);

    // Non-zero seq before the first event — return everything.
    const beforeAll = await log.readAfter(0);
    expect(beforeAll.length).toBe(4);
  });

  it("tail returns the last N events", async () => {
    for (let i = 1; i <= 10; i++) await log.append(`e${i}`, { i });

    const t3 = await log.tail(3);
    expect(t3.length).toBe(3);
    expect(t3.map((e) => e.payload)).toEqual([{ i: 8 }, { i: 9 }, { i: 10 }]);

    // Tail larger than total — return everything.
    const t100 = await log.tail(100);
    expect(t100.length).toBe(10);

    // Tail(0) — empty.
    const t0 = await log.tail(0);
    expect(t0).toEqual([]);
  });

  it("latestSeq is monotonic across appends", async () => {
    expect(log.latestSeq()).toBe(0);
    await log.append("a", {});
    expect(log.latestSeq()).toBe(1);
    await log.append("b", {});
    expect(log.latestSeq()).toBe(2);
  });

  it("restores seq counter after restart (file already populated)", async () => {
    await log.append("first", { x: 1 });
    await log.append("second", { x: 2 });
    await log.close();

    // New instance pointing at the same file.
    const reopened = new JsonlEventLog("ws-1", dir);
    await reopened.initialize();
    expect(reopened.latestSeq()).toBe(2);

    const r3 = await reopened.append("third", { x: 3 });
    expect(r3.seq).toBe(3);

    const all = await reopened.readAfter(0);
    expect(all.length).toBe(3);
    await reopened.close();
  });

  it("concurrent appends don't lose events", async () => {
    const N = 50;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => log.append("t", { i })),
    );
    // Every seq from 1..N must appear exactly once — no gaps, no dups.
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));

    const all = await log.readAfter(0);
    expect(all.length).toBe(N);
    expect(all.map((e) => e.seq)).toEqual(seqs);
  });
});

describe("JsonlEventLog security", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mx-evlog-sec-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects workspaceId with path-traversal characters", () => {
    expect(() => new JsonlEventLog("..", dir)).toThrow(/Invalid workspaceId/);
    expect(() => new JsonlEventLog("../../etc/passwd", dir)).toThrow(/Invalid workspaceId/);
    expect(() => new JsonlEventLog("foo/bar", dir)).toThrow(/Invalid workspaceId/);
    expect(() => new JsonlEventLog("foo bar", dir)).toThrow(/Invalid workspaceId/);
  });

  it("rejects workspaceId that escapes the events dir", () => {
    // A path-traversal slug that passes the regex but still escapes.
    expect(() => new JsonlEventLog("..\\..\\windows", dir)).toThrow(/Invalid workspaceId/);
  });

  it("accepts valid slug-like workspaceIds", () => {
    expect(() => new JsonlEventLog("ws-123", dir)).not.toThrow();
    expect(() => new JsonlEventLog("my_workspace", dir)).not.toThrow();
    expect(() => new JsonlEventLog("acme-corp", dir)).not.toThrow();
  });

  it("resolves the file inside the events directory", () => {
    const log = new JsonlEventLog("valid-ws", dir);
    expect(log.file.startsWith(path.join(dir, "events"))).toBe(true);
    expect(path.basename(log.file)).toBe("valid-ws.jsonl");
  });
});

describe("EventLogRegistry", () => {
  let dir: string;
  let registry: EventLogRegistry;

  beforeEach(async () => {
    dir = await tmpDir();
    registry = new EventLogRegistry(dir);
  });

  afterEach(async () => {
    await registry.closeAll().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("returns the same instance per workspace id", () => {
    const a = registry.for("ws-1");
    const b = registry.for("ws-1");
    const c = registry.for("ws-2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("writes are independent per workspace", async () => {
    const l1 = registry.for("ws-1");
    const l2 = registry.for("ws-2");
    await l1.append("e", { ws: 1 });
    await l2.append("e", { ws: 2 });
    expect((await l1.readAfter(0)).length).toBe(1);
    expect((await l2.readAfter(0)).length).toBe(1);
    expect((await l1.readAfter(0))[0]!.payload).toEqual({ ws: 1 });
    expect((await l2.readAfter(0))[0]!.payload).toEqual({ ws: 2 });
  });
});

describe("parseLastEventIdHeader + encodeLoggedEvent", () => {
  it("parses missing / invalid headers to 0", () => {
    expect(parseLastEventIdHeader(undefined)).toBe(0);
    expect(parseLastEventIdHeader(null)).toBe(0);
    expect(parseLastEventIdHeader("")).toBe(0);
    expect(parseLastEventIdHeader("   ")).toBe(0);
    expect(parseLastEventIdHeader("abc")).toBe(0);
    expect(parseLastEventIdHeader("-1")).toBe(0);
    // parseInt is permissive — "3.14" parses to 3 (matches the in-memory
    // buffer's parseLastEventId semantics in `src/lib/sse-replay.ts`).
    expect(parseLastEventIdHeader("3.14")).toBe(3);
  });

  it("parses a numeric id", () => {
    expect(parseLastEventIdHeader("42")).toBe(42);
    expect(parseLastEventIdHeader("0")).toBe(0);
    expect(parseLastEventIdHeader(" 7 ")).toBe(7);
  });

  it("encodeLoggedEvent produces id: and data: lines terminated by blank line", () => {
    const ev: LoggedEvent = { seq: 12, type: "t", payload: { a: 1 }, ts: "2026-01-01T00:00:00Z" };
    const frame = encodeLoggedEvent(ev);
    expect(frame).toContain("id: 12\n");
    expect(frame).toContain(`data: ${JSON.stringify(ev)}\n`);
    expect(frame.endsWith("\n\n")).toBe(true);
  });
});

describe("createSseHandler (Hono)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await tmpDir();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("Hono handler responds with Last-Event-ID replay", async () => {
    // Pre-populate a workspace's log so the handler has events to replay.
    const prep = new JsonlEventLog("ws-x", dir);
    await prep.initialize();
    await prep.append("task-start", { id: "s1" });
    await prep.append("task-complete", { id: "c1" });
    await prep.append("done", { id: "d1" });
    await prep.close();

    const registry = new EventLogRegistry(dir);
    const { app } = buildReplayApp({ registry });

    // Client connects without Last-Event-ID — should replay all 3.
    const res = await app.request("/workspaces/ws-x/stream");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const { frames, lastSeq } = await readStream(res);
    // 4 frames: 3 replayed events + 1 `stream-end` sentinel.
    expect(frames.length).toBe(4);
    expect(frames[0]).toContain('"seq":1');
    expect(frames[0]).toContain('"task-start"');
    expect(frames[1]).toContain('"seq":2');
    expect(frames[2]).toContain('"seq":3');
    expect(frames[3]).toContain("event: stream-end");
    // `stream-end` carries no `id:` line — lastSeq stays at 3.
    expect(lastSeq).toBe(3);

    await registry.closeAll();
  });

  it("Hono handler replays only events after Last-Event-ID", async () => {
    const prep = new JsonlEventLog("ws-y", dir);
    await prep.initialize();
    await prep.append("e1", {});
    await prep.append("e2", {});
    await prep.append("e3", {});
    await prep.close();

    const registry = new EventLogRegistry(dir);
    const { app } = buildReplayApp({ registry });

    const res = await app.request("/workspaces/ws-y/stream", {
      headers: { "Last-Event-ID": "1" },
    });
    const { frames } = await readStream(res);
    // seq>1 → e2 (seq=2) + e3 (seq=3) = 2 replay frames, plus 1 sentinel.
    expect(frames.length).toBe(3);
    expect(frames[0]).toContain('"seq":2');
    expect(frames[1]).toContain('"seq":3');
    expect(frames[2]).toContain("event: stream-end");

    await registry.closeAll();
  });

  it("Hono handler returns 400 when id is missing", async () => {
    const registry = new EventLogRegistry(dir);
    const { app } = buildReplayApp({ registry });

    // Empty id segment — Hono won't match the route, so we hit the
    // handler via a path that bypasses the param. Use a direct call
    // with a synthetic Context-like object that has an empty param.
    const handler = createSseHandler({ forWorkspace: (id) => registry.for(id) });
    const fakeReq = new Request("http://localhost/workspaces//stream");
    // Hono's Context is hard to construct by hand; instead we exercise
    // the 400 path by calling the handler with a Context whose param()
    // returns "". We build a minimal Context via the Hono request API.
    const c = {
      req: { param: () => "", header: () => undefined, url: fakeReq.url },
    } as unknown as Parameters<typeof handler>[0];
    const res = handler(c);
    expect(res.status).toBe(400);
    await registry.closeAll();
  });

  it("Hono handler calls onConnect hook and emits a snapshot frame", async () => {
    const registry = new EventLogRegistry(dir);
    const app = new Hono();
    const handler = createSseHandler(
      { forWorkspace: (id) => registry.for(id) },
      {
        onConnect: async () =>
          ({ type: "snapshot", foo: "bar" }) as Record<string, unknown>,
      },
    );
    app.get("/workspaces/:id/stream", handler);

    const res = await app.request("/workspaces/ws-z/stream");
    const { frames } = await readStream(res);
    // First frame is the onConnect snapshot (event:snapshot), second is the
    // internal "connect" tick event (event: default — omitted → message).
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]).toContain("event: snapshot");
    expect(frames[0]).toContain('"foo":"bar"');

    await registry.closeAll();
  });
});

describe("createEventBus", () => {
  it("delivers published events to per-workspace subscribers", () => {
    const bus = createEventBus();
    const received: unknown[] = [];
    const unsub = bus.subscribe("ws", (p) => received.push(p));
    bus.publish("ws", { a: 1 });
    bus.publish("ws", { a: 2 });
    expect(received).toEqual([{ a: 1 }, { a: 2 }]);

    unsub();
    bus.publish("ws", { a: 3 });
    expect(received).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("does not cross-contaminate workspaces", () => {
    const bus = createEventBus();
    const a: unknown[] = [];
    const b: unknown[] = [];
    bus.subscribe("ws-a", (p) => a.push(p));
    bus.subscribe("ws-b", (p) => b.push(p));
    bus.publish("ws-a", { ws: "a" });
    bus.publish("ws-b", { ws: "b" });
    expect(a).toEqual([{ ws: "a" }]);
    expect(b).toEqual([{ ws: "b" }]);
  });
});
