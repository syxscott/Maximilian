import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { OpencodeExecutor } from "../src/opencode-executor.js"
import { opencodeSessionsCreatedTotal } from "@max/telemetry"
import type { Task } from "../src/types.js"

const mkTask = (id: string): Task => ({
  id,
  description: `task ${id}`,
  agentRole: "general",
  dependsOn: [],
  status: "pending",
} as Task)

function makeOk<T>(body: T): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function newSession(id: string) {
  return {
    id,
    title: `max-${id}`,
    projectID: "p",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now(), updated: Date.now() },
  }
}

function wireFetchOnce(fetchMock: ReturnType<typeof vi.fn>, sessionId: string) {
  let created = false
  let prompted = false
  fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "")
    const method = init?.method ?? "GET"
    if (path === "/api/health") return makeOk({ healthy: true })
    if (path === "/api/session" && method === "POST" && !created) {
      created = true
      return makeOk({ data: newSession(sessionId) })
    }
    if (path === `/api/session/${sessionId}/prompt` && method === "POST" && !prompted) {
      prompted = true
      return makeOk({ data: null })
    }
    if (path === `/api/session/${sessionId}/wait` && method === "POST") {
      return new Response(null, { status: 204 })
    }
    if (path === `/api/session/${sessionId}/message` && method === "GET") {
      return makeOk({
        data: [
          {
            id: "msg_1",
            role: "assistant",
            sessionID: sessionId,
            parts: [{ type: "text", text: { text: "ok" } }],
          },
        ],
      })
    }
    return makeOk({ data: null }, 404)
  })
}

describe("OpencodeExecutor — Phase 9 SLO metric wiring", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => vi.restoreAllMocks())

  it("increments opencodeSessionsCreatedTotal on the first call (pool miss)", async () => {
    wireFetchOnce(fetchMock, "ses_metric1")
    const ex = new OpencodeExecutor({ baseUrl: "http://opencode.test" })
    const startVal = readCounter(opencodeSessionsCreatedTotal)
    await ex.executeTask(mkTask("t1"), "ws-metric-1")
    const endVal = readCounter(opencodeSessionsCreatedTotal)
    expect(endVal - startVal).toBe(1)
    // Pool should now have a cached entry for this workspace
    expect(ex.leakedSessionsOnAbort("ws-metric-1")).toBe(1)
    expect(ex.leakedSessionsOnAbort("ws-other")).toBe(0)
  })

  it("does NOT increment opencodeSessionsCreatedTotal on a pool hit (same workspace, 2nd call)", async () => {
    wireFetchOnce(fetchMock, "ses_metric2")
    const ex = new OpencodeExecutor({ baseUrl: "http://opencode.test" })

    // First call creates the session
    await ex.executeTask(mkTask("t1"), "ws-metric-2")
    const afterFirst = readCounter(opencodeSessionsCreatedTotal)

    // Second call on the same workspace — pool should reuse
    await ex.executeTask(mkTask("t2"), "ws-metric-2")
    const afterSecond = readCounter(opencodeSessionsCreatedTotal)
    expect(afterSecond - afterFirst).toBe(0)
  })
})

// ── Counter inspection helper ───────────────────────────────────────────────

interface InternalCounter {
  hashMap: Record<string, { value: number }>
}

/**
 * Read the raw counter value. prom-client stores the current value
 * in `hashMap[""].value` (plain object, not a Map). We avoid the
 * public `get()` API because it returns the rate over a 1s window
 * which is unhelpful in a synchronous assertion.
 */
function readCounter(counter: unknown): number {
  const internal = counter as InternalCounter
  return internal.hashMap[""]?.value ?? 0
}