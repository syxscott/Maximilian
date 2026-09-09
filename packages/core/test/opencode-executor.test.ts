import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { OpencodeExecutor } from "../src/opencode-executor.js"
import type { Task } from "../src/types.js"

const mkTask = (id: string, description: string): Task => ({
  id,
  description,
  agentRole: "general",
  dependsOn: [],
  status: "pending",
} as Task)

function makeOk<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("OpencodeExecutor (Phase 2)", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => vi.restoreAllMocks())

  it("routes a Maximilian task to opencode via SDK and returns Result", async () => {
    let created = false
    let prompted = false
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "")
      const method = init?.method ?? "GET"
      if (path === "/api/health") return makeOk({ healthy: true })
      if (path === "/api/session" && method === "POST" && !created) {
        created = true
        return makeOk({
          data: {
            id: "ses_x",
            title: "max-task1",
            projectID: "p",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: Date.now(), updated: Date.now() },
          },
        })
      }
      if (path === "/api/session/ses_x/prompt" && method === "POST" && !prompted) {
        prompted = true
        return makeOk({ data: null })
      }
      if (path === "/api/session/ses_x/wait" && method === "POST") {
        return new Response(null, { status: 204 })
      }
      if (path === "/api/session/ses_x/message" && method === "GET") {
        return makeOk({
          data: [
            {
              id: "msg_1",
              role: "assistant",
              sessionID: "ses_x",
              parts: [{ type: "text", text: { text: "task done by opencode" } }],
            },
          ],
        })
      }
      return makeOk({ data: null }, 404)
    })

    const ex = new OpencodeExecutor({ baseUrl: "http://opencode.test" })
    const out = await ex.executeTask(mkTask("task-001", "refactor auth"), "ws-1")

    expect(out.result.taskId).toBe("task-001")
    expect(out.result.agentRole).toBe("general")
    expect(out.result.output).toContain("task done by opencode")
    expect(out.sessionId).toBe("ses_x")
    expect(out.durationMs).toBeGreaterThan(0)

    // Verify the executor made the right HTTP calls
    const calls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(calls).toContain("http://opencode.test/api/session")
    expect(calls).toContain("http://opencode.test/api/session/ses_x/prompt")

    await ex.shutdown()
  })

  it("session pool reuses the same session for the same workspaceId", async () => {
    let sessionCreateCount = 0
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "")
      const method = init?.method ?? "GET"
      if (path === "/api/health") return makeOk({ healthy: true })
      if (path === "/api/session" && method === "POST") {
        sessionCreateCount++
        return makeOk({
          data: {
            id: `ses_${sessionCreateCount}`,
            title: "t",
            projectID: "p",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: Date.now(), updated: Date.now() },
          },
        })
      }
      if (path.startsWith("/api/session/ses_") && path.endsWith("/prompt") && method === "POST") {
        return makeOk({ data: null })
      }
      if (path.startsWith("/api/session/ses_") && path.endsWith("/wait") && method === "POST") {
        return new Response(null, { status: 204 })
      }
      if (path.startsWith("/api/session/ses_") && path.endsWith("/message") && method === "GET") {
        return makeOk({
          data: [
            {
              id: "m",
              role: "assistant",
              sessionID: "x",
              parts: [{ type: "text", text: { text: "ok" } }],
            },
          ],
        })
      }
      return makeOk({ data: null }, 404)
    })

    const ex = new OpencodeExecutor({ baseUrl: "http://opencode.test" })
    const r1 = await ex.executeTask(mkTask("t1", "task one"), "ws-A")
    const r2 = await ex.executeTask(mkTask("t2", "task two"), "ws-A")
    const r3 = await ex.executeTask(mkTask("t3", "task three"), "ws-B")

    expect(r1.sessionId).toBe("ses_1")
    expect(r2.sessionId).toBe("ses_1") // same workspace, same session
    expect(r3.sessionId).toBe("ses_2") // different workspace, new session
    expect(sessionCreateCount).toBe(2)

    await ex.shutdown()
  })

  it("ping() returns true when opencode is healthy", async () => {
    fetchMock.mockResolvedValue(makeOk({ healthy: true }))
    const ex = new OpencodeExecutor({ baseUrl: "http://opencode.test" })
    expect(await ex.ping()).toBe(true)
    await ex.shutdown()
  })

  it("ping() returns false when opencode is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))
    const ex = new OpencodeExecutor({ baseUrl: "http://opencode.test" })
    expect(await ex.ping()).toBe(false)
    await ex.shutdown()
  })

  it("shutdown() releases all pooled sessions", async () => {
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "")
      const method = init?.method ?? "GET"
      if (path === "/api/session" && method === "POST") {
        return makeOk({
          data: {
            id: "ses_z",
            title: "t",
            projectID: "p",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: Date.now(), updated: Date.now() },
          },
        })
      }
      if (path === "/api/session/ses_z" && method === "DELETE") {
        return new Response(null, { status: 204 })
      }
      if (path === "/api/session/ses_z/prompt" && method === "POST") {
        return makeOk({ data: null })
      }
      if (path === "/api/session/ses_z/wait" && method === "POST") {
        return new Response(null, { status: 204 })
      }
      if (path === "/api/session/ses_z/message" && method === "GET") {
        return makeOk({
          data: [
            {
              id: "m",
              role: "assistant",
              sessionID: "ses_z",
              parts: [{ type: "text", text: { text: "ok" } }],
            },
          ],
        })
      }
      return makeOk({ data: null }, 404)
    })
    const ex = new OpencodeExecutor({ baseUrl: "http://opencode.test" })
    await ex.executeTask(mkTask("t", "x"), "ws-1")
    await ex.shutdown()
    const deleteCalls = fetchMock.mock.calls.filter(
      (c) => String(c[0]).endsWith("/api/session/ses_z") && (c[1] as RequestInit)?.method === "DELETE",
    )
    expect(deleteCalls.length).toBe(1)
  })
})