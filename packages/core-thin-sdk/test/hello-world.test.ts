import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Hello-world integration: end-to-end Maximilian → @max/core-thin-sdk → opencode flow.
 *
 * Mocks fetch() to simulate opencode server responses. Demonstrates the
 * non-streaming data path:
 *   1. OpencodeHttpClient — raw HTTP (auth, headers, error parsing)
 *   2. SDK methods — typed surface (health, createSession, sendPrompt)
 *   3. SessionPool — per-workspace caching + LRU eviction
 *
 * SSE/event-bridge integration is tested separately in event-bridge.test.ts.
 * This test is the smoke test for the Phase-1 PoC. Real opencode is not required.
 */
import { OpencodeHttpClient } from "../src/client.js"
import * as OpencodeSdk from "../src/sdk.js"
import { SessionPool } from "../src/session-pool.js"

function makeOk<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const mockSession = (id: string) => ({
  id,
  title: "demo",
  projectID: "p",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: Date.now(), updated: Date.now() },
  parentID: undefined,
  agent: undefined,
  model: undefined,
  location: undefined,
  subpath: undefined,
  revert: undefined,
})

describe("hello-world integration (Phase 1 PoC)", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => vi.restoreAllMocks())

  it("Maximilian → SDK → opencode: health, create session, send prompt", async () => {
    // ──── Mock opencode server ────
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "")
      const method = init?.method ?? "GET"

      if (path === "/api/health") return makeOk({ ok: true })
      if (path === "/api/session" && method === "POST") {
        return makeOk({ data: mockSession("ses_demo") })
      }
      if (path === "/api/session/ses_demo/prompt" && method === "POST") {
        return makeOk({
          data: {
            info: { id: "msg_1", role: "assistant", sessionID: "ses_demo" },
            parts: [{ type: "text", text: { text: "hello world" } }],
          },
        })
      }
      if (path === "/api/session/ses_demo/wait" && method === "POST") {
        return new Response(null, { status: 204 })
      }
      if (path === "/api/session/ses_demo/message" && method === "GET") {
        return makeOk({
          data: [
            {
              id: "msg_1",
              role: "user",
              sessionID: "ses_demo",
              parts: [{ type: "text", text: { text: "write hello world" } }],
            },
            {
              id: "msg_2",
              role: "assistant",
              sessionID: "ses_demo",
              parts: [{ type: "text", text: { text: "hello world" } }],
            },
          ],
        })
      }
      return makeOk({ data: null }, 404)
    })

    // ──── Maximilian-side wiring ────
    const client = new OpencodeHttpClient({ baseUrl: "http://opencode.test" })
    const pool = new SessionPool(client)

    // 1. Health check (supervisor-style)
    const healthy = await OpencodeSdk.health(client)
    expect(healthy.ok).toBe(true)

    // 2. Pool: create session for workspace
    const entry = await pool.getOrCreate("ws_demo")
    expect(entry.session.id).toBe("ses_demo")

    // 3. Pool: cache hit on second call (only 1 POST /api/session)
    const entry2 = await pool.getOrCreate("ws_demo")
    expect(entry2.session.id).toBe("ses_demo")
    expect(fetchMock.mock.calls.filter((c) => c[0].includes("/api/session")).length).toBe(1)

    // 4. Send prompt via SDK
    const result = await OpencodeSdk.sendPrompt(client, "ses_demo", {
      parts: [{ type: "text", text: "write hello world" }],
    })
    expect(result.info.role).toBe("assistant")

    // 5. Cleanup
    await pool.shutdown()
    expect(pool.size()).toBe(0)
  })

  it("multi-tenant: distinct workspaces get distinct sessions, LRU eviction works", async () => {
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "")
      const method = init?.method ?? "GET"
      if (path === "/api/session" && method === "POST") {
        const body = init?.body ? JSON.parse(init.body as string) : {}
        const id = `ses_${body.title ?? Math.random()}`
        return makeOk({ data: mockSession(id) })
      }
      return makeOk({ data: null }, 404)
    })

    const client = new OpencodeHttpClient({ baseUrl: "http://opencode.test" })
    const pool = new SessionPool(client, { maxSessions: 2 })

    await pool.getOrCreate("ws_a", { title: "a" })
    await pool.getOrCreate("ws_b", { title: "b" })
    expect(pool.size()).toBe(2)

    // Adding ws_c should evict ws_a (LRU)
    await pool.getOrCreate("ws_c", { title: "c" })
    expect(pool.size()).toBe(2)
    const remaining = pool.list().map((s) => s.id).sort()
    // ws_a (oldest) should be gone; ws_b and ws_c remain
    expect(remaining.every((id) => id.startsWith("ses_") && id !== "ses_a")).toBe(true)

    await pool.shutdown()
  })
})