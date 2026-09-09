/**
 * Tests for SessionPool.
 *
 * Covers:
 *   - getOrCreate returns the same session for repeated calls with the same workspaceId
 *   - getOrCreate issues exactly one POST /api/session per workspace
 *   - Concurrent getOrCreate calls coalesce
 *   - LRU eviction when maxSessions is exceeded
 *   - release drops the entry without a server call
 *   - destroy issues DELETE and drops the entry
 *   - shutdown destroys all cached sessions
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { OpencodeHttpClient } from "../src/client.js";
import { SessionPool } from "../src/session-pool.js";
import type { Session } from "../src/types.js";

function mockSession(id: string, title = "t"): Session {
  return {
    id,
    title,
    projectID: "p",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    parentID: undefined,
    agent: undefined,
    model: undefined,
    location: undefined,
    subpath: undefined,
    revert: undefined,
  };
}

interface PoolMock {
  client: OpencodeHttpClient;
  responses: Array<{ body?: unknown; status?: number }>;
  captured: Array<{ method: string; path: string; body: unknown }>;
}

function makePoolMock(): PoolMock {
  const captured: PoolMock["captured"] = [];
  const responses: PoolMock["responses"] = [];
  globalThis.fetch = vi.fn((url, init) => {
    const u = typeof url === "string" ? url : url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = undefined;
    if (init?.body) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }
    captured.push({ method, path: u.replace(/^https?:\/\/[^/]+/, ""), body });

    const next = responses.shift();
    const status = next?.status ?? 200;
    const text = JSON.stringify(next?.body ?? {});
    const respInit: ResponseInit = {
      status,
      headers: { "Content-Type": "application/json" },
    };
    return Promise.resolve(
      status === 204 ? new Response(null, respInit) : new Response(text, respInit),
    );
  }) as unknown as typeof fetch;
  return {
    client: new OpencodeHttpClient({ baseUrl: "http://api.test" }),
    responses,
    captured,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SessionPool — getOrCreate", () => {
  it("creates a session on first call and caches it for subsequent calls", async () => {
    const m = makePoolMock();
    m.responses.push({ body: { data: mockSession("ses_1") } });
    const pool = new SessionPool(m.client);

    const a = await pool.getOrCreate("ws-a");
    const b = await pool.getOrCreate("ws-a");
    expect(a.session.id).toBe("ses_1");
    expect(b.session.id).toBe("ses_1");
    // Only one POST /api/session across both calls.
    expect(m.captured.filter((c) => c.path === "/api/session")).toHaveLength(1);
    await pool.shutdown();
  });

  it("creates distinct sessions per workspaceId", async () => {
    const m = makePoolMock();
    m.responses.push({ body: { data: mockSession("ses_1") } });
    m.responses.push({ body: { data: mockSession("ses_2") } });
    const pool = new SessionPool(m.client);

    const a = await pool.getOrCreate("ws-a");
    const b = await pool.getOrCreate("ws-b");
    expect(a.session.id).toBe("ses_1");
    expect(b.session.id).toBe("ses_2");
    expect(pool.size()).toBe(2);
    await pool.shutdown();
  });

  it("forwards session create opts as the POST body", async () => {
    const m = makePoolMock();
    m.responses.push({ body: { data: mockSession("ses_1") } });
    const pool = new SessionPool(m.client);
    await pool.getOrCreate("ws-a", { title: "My Task", agent: "build" });
    expect(m.captured[0]).toEqual({
      method: "POST",
      path: "/api/session",
      body: { title: "My Task", agent: "build" },
    });
    await pool.shutdown();
  });

  it("coalesces concurrent getOrCreate calls for the same workspaceId", async () => {
    const m = makePoolMock();
    // Single response — both concurrent calls must share it.
    m.responses.push({ body: { data: mockSession("ses_1") } });
    const pool = new SessionPool(m.client);

    const [a, b] = await Promise.all([
      pool.getOrCreate("ws-a"),
      pool.getOrCreate("ws-a"),
    ]);
    expect(a.session.id).toBe("ses_1");
    expect(b.session.id).toBe("ses_1");
    expect(m.captured.filter((c) => c.path === "/api/session")).toHaveLength(1);
    await pool.shutdown();
  });

  it(".touch() refreshes the LRU position", async () => {
    const m = makePoolMock();
    m.responses.push({ body: { data: mockSession("ses_1") } });
    const pool = new SessionPool(m.client);
    const entry = await pool.getOrCreate("ws-a");
    entry.touch();
    // No HTTP call is involved; size remains the same.
    expect(pool.size()).toBe(1);
    await pool.shutdown();
  });
});

describe("SessionPool — eviction and shutdown", () => {
  it("evicts the LRU entry once maxSessions is exceeded", async () => {
    const m = makePoolMock();
    // Three sequential workspaces (a, b, c) — pool max=2.
    m.responses.push({ body: { data: mockSession("ses_1") } });
    m.responses.push({ body: { data: mockSession("ses_2") } });
    m.responses.push({ body: { data: mockSession("ses_3") } });
    const pool = new SessionPool(m.client, { maxSessions: 2 });

    await pool.getOrCreate("a");
    await pool.getOrCreate("b");
    expect(pool.size()).toBe(2);
    await pool.getOrCreate("c");
    // The LRU ("a") is evicted; remaining entries are b + c.
    expect(pool.size()).toBe(2);
    const remaining = pool.list().map((s) => s.id).sort();
    expect(remaining).toEqual(["ses_2", "ses_3"].sort());
    await pool.shutdown();
  });

  it("release() drops the entry without a server call", async () => {
    const m = makePoolMock();
    m.responses.push({ body: { data: mockSession("ses_1") } });
    const pool = new SessionPool(m.client);
    await pool.getOrCreate("ws-a");
    pool.release("ws-a");
    expect(pool.size()).toBe(0);
    // No DELETE was issued.
    expect(m.captured.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });

  it("destroy() issues DELETE and drops the entry", async () => {
    const m = makePoolMock();
    m.responses.push({ body: { data: mockSession("ses_1") } }); // create
    m.responses.push({}, 204); // delete
    const pool = new SessionPool(m.client);
    await pool.getOrCreate("ws-a");
    await pool.destroy("ws-a");
    expect(pool.size()).toBe(0);
    const deleteCalls = m.captured.filter((c) => c.method === "DELETE");
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toEqual({
      method: "DELETE",
      path: "/api/session/ses_1",
      body: undefined,
    });
  });

  it("shutdown() destroys every cached session", async () => {
    const m = makePoolMock();
    m.responses.push({ body: { data: mockSession("ses_1") } });
    m.responses.push({ body: { data: mockSession("ses_2") } });
    // Two DELETEs
    m.responses.push({}, 204);
    m.responses.push({}, 204);

    const pool = new SessionPool(m.client);
    await pool.getOrCreate("a");
    await pool.getOrCreate("b");
    await pool.shutdown();
    expect(pool.size()).toBe(0);
    const deletes = m.captured.filter((c) => c.method === "DELETE");
    expect(deletes).toHaveLength(2);
  });
});
