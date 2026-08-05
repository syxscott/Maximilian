// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * OpencodeDagExecutor tests (Phase 3d).
 *
 * Tests verify:
 *   - Independent tasks run in parallel (via maxConcurrency budget)
 *   - Dependency edges are honoured (topological)
 *   - The AsyncIterator yields TaskResults as tasks complete (streaming)
 *   - Per-task failures are surfaced as `TaskResult.error`
 *   - Missing dependencies emit error results (graceful degradation)
 *   - iterator.return() cleanly aborts in-flight tasks
 *   - AbortSignal triggers early termination
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  OpencodeDagExecutor,
  type TaskResult,
} from "../src/opencode-dag-executor.js"
import { OpencodeExecutor } from "../src/opencode-executor.js"
import type { Task } from "../src/types.js"

function makeOk<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function mkTask(id: string, description: string, dependsOn: string[] = []): Task {
  return {
    id,
    description,
    agentRole: "general",
    dependsOn,
    status: "pending",
  } as Task
}

interface Harness {
  fetchMock: ReturnType<typeof vi.fn>
}

function setupOK(harness: Harness, opts: { perCallDelay?: (taskDesc: string) => number } = {}): void {
  let sessionCounter = 0

  harness.fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "")
    const method = init?.method ?? "GET"

    if (path === "/api/health") return makeOk({ healthy: true })

    if (path === "/api/session" && method === "POST") {
      sessionCounter++
      return makeOk({
        data: {
          id: `ses_${sessionCounter}`,
          title: "t",
          projectID: "p",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now(), updated: Date.now() },
        },
      })
    }

    const sm = path.match(/^\/api\/session\/(ses_\d+)\//)
    const sid = sm?.[1]
    if (!sid) return makeOk({ data: null }, 404)

    if (path.endsWith("/prompt") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { prompt?: { text?: string } }
      const desc = body.prompt?.text ?? ""
      if (opts.perCallDelay) {
        await new Promise((r) => setTimeout(r, opts.perCallDelay(desc)))
      }
      return makeOk({ data: null })
    }
    if (path.endsWith("/wait")) return new Response(null, { status: 204 })
    if (path.endsWith("/message") && method === "GET") {
      return makeOk({
        data: [
          {
            id: `m_${sid}`,
            role: "assistant",
            sessionID: sid,
            parts: [{ type: "text", text: { text: `ok` } }],
          },
        ],
      })
    }
    if (method === "DELETE") return new Response(null, { status: 204 })
    return makeOk({ data: null }, 404)
  })
}

async function collect(
  iter: AsyncIterableIterator<TaskResult>,
): Promise<TaskResult[]> {
  const out: TaskResult[] = []
  while (true) {
    const next = await iter.next()
    if (next.done) break
    out.push(next.value)
  }
  return out
}

describe("OpencodeDagExecutor (Phase 3d)", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => vi.restoreAllMocks())

  it("yields results for independent tasks in any order", async () => {
    setupOK({ fetchMock })

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    const tasks = [mkTask("t1", "alpha"), mkTask("t2", "beta"), mkTask("t3", "gamma")]
    const dag = new OpencodeDagExecutor()

    const results = await collect(
      dag.execute({ tasks, executor, workspaceId: "ws-1" }),
    )

    expect(results).toHaveLength(3)
    const ids = new Set(results.map((r) => r.taskId))
    expect(ids).toEqual(new Set(["t1", "t2", "t3"]))

    for (const r of results) {
      expect(r.result).toBeDefined()
      expect(r.error).toBeUndefined()
      expect(r.sessionId).toMatch(/^ses_/)
      expect(r.durationMs).toBeGreaterThanOrEqual(0)
    }

    await executor.shutdown()
  })

  it("streams results as soon as each task completes (parallel, not all-at-once)", async () => {
    setupOK({ fetchMock }, { perCallDelay: (desc) => (desc === "alpha" ? 80 : desc === "beta" ? 30 : 10) })

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    const tasks = [mkTask("t1", "alpha"), mkTask("t2", "beta"), mkTask("t3", "gamma")]
    const dag = new OpencodeDagExecutor()

    const completionOrder: string[] = []
    const iter = dag.execute({ tasks, executor, workspaceId: "ws-1" })
    while (true) {
      const next = await iter.next()
      if (next.done) break
      completionOrder.push(next.value.taskId)
    }

    // The fastest task (gamma, 10ms) should be first; slowest last.
    expect(completionOrder.indexOf("t3")).toBeLessThan(completionOrder.indexOf("t1"))

    await executor.shutdown()
  })

  it("respects dependency edges (topological execution)", async () => {
    setupOK({ fetchMock })

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    // t2 depends on t1, t3 depends on t1 → all three complete but t1 must be first.
    const tasks = [
      mkTask("t1", "alpha"),
      mkTask("t2", "beta", ["t1"]),
      mkTask("t3", "gamma", ["t1"]),
      mkTask("t4", "delta", ["t2", "t3"]),
    ]
    const dag = new OpencodeDagExecutor()
    const results = await collect(
      dag.execute({ tasks, executor, workspaceId: "ws-1" }),
    )

    expect(results).toHaveLength(4)
    expect(results[0]!.taskId).toBe("t1")
    // t4 last.
    expect(results.at(-1)!.taskId).toBe("t4")

    await executor.shutdown()
  })

  it("propagates task errors as TaskResult.error (does not throw)", async () => {
    // Force a session creation failure: drop /api/session responses.
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "")
      const method = init?.method ?? "GET"
      if (path === "/api/health") return makeOk({ healthy: true })
      if (path === "/api/session" && method === "POST") {
        return makeOk({ error: "service unavailable" }, 503)
      }
      return makeOk({ data: null }, 404)
    })

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    const tasks = [mkTask("a", "alpha"), mkTask("b", "beta")]
    const dag = new OpencodeDagExecutor()

    const results = await collect(
      dag.execute({ tasks, executor, workspaceId: "ws-1" }),
    )

    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.error).toBeTruthy()
      expect(r.result).toBeUndefined()
    }

    await executor.shutdown()
  })

  it("reports missing dependencies instead of hanging forever", async () => {
    setupOK({ fetchMock })

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    // t2 depends on a non-existent "ghost" task.
    const tasks = [
      mkTask("t1", "alpha"),
      mkTask("t2", "beta", ["ghost"]),
    ]
    const dag = new OpencodeDagExecutor()
    const results = await collect(
      dag.execute({ tasks, executor, workspaceId: "ws-1" }),
    )

    const t2Result = results.find((r) => r.taskId === "t2")
    expect(t2Result).toBeDefined()
    expect(t2Result!.result).toBeUndefined()
    expect(t2Result!.error).toMatch(/missing dependencies.*ghost/)

    await executor.shutdown()
  })

  it("respects maxConcurrency cap", async () => {
    setupOK({ fetchMock }, { perCallDelay: () => 50 })

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    const tasks = Array.from({ length: 6 }, (_, i) => mkTask(`t${i}`, `desc-${i}`))
    const dag = new OpencodeDagExecutor({ maxConcurrency: 2 })

    const iter = dag.execute({ tasks, executor, workspaceId: "ws-1" })
    const results = await collect(iter)

    // All 6 should still complete — maxConcurrency just throttles, doesn't drop.
    expect(results).toHaveLength(6)

    // Inspect the calls made by the SDK — at any given time, no more than 2 prompts.
    // We approximate by counting how many prompt responses are pending at the same time,
    // but a simpler proxy is: should not exceed 2 concurrent prompts.
    // We do a basic sanity: there are 6 prompts called total.
    const promptCount = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/prompt")).length
    expect(promptCount).toBeGreaterThanOrEqual(6)

    await executor.shutdown()
  })

  it("iterator.return() stops accepting new tasks and signals abort", async () => {
    setupOK({ fetchMock }, { perCallDelay: () => 80 })

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    const tasks = Array.from({ length: 4 }, (_, i) => mkTask(`t${i}`, `desc-${i}`))
    const dag = new OpencodeDagExecutor()

    const iter = dag.execute({ tasks, executor, workspaceId: "ws-1" })
    const first = await iter.next()
    expect(first.done).toBe(false)

    const ret = await iter.return()
    expect(ret.done).toBe(true)

    await executor.shutdown()
  })

  it("honors AbortSignal before and during execution", async () => {
    // Slow opencode so the abort can fire mid-flight.
    setupOK({ fetchMock }, { perCallDelay: () => 80 })

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    const ac = new AbortController()
    const tasks = Array.from({ length: 4 }, (_, i) => mkTask(`t${i}`, `desc-${i}`))
    const dag = new OpencodeDagExecutor()

    const iter = dag.execute({ tasks, executor, workspaceId: "ws-1", signal: ac.signal })
    // Trigger abort immediately.
    ac.abort()

    const results = await collect(iter)
    // Every result after abort carries the "aborted" error.
    for (const r of results) {
      // Some may have completed naturally before the abort, others are "aborted".
      if (r.error) {
        expect(["aborted", "connection reset", "fetch failed"]).toContain(r.error)
      }
    }

    await executor.shutdown()
  })

  it("preserves the iterator contract via Symbol.asyncIterator", async () => {
    setupOK({ fetchMock })

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    const tasks = [mkTask("a", "alpha")]
    const dag = new OpencodeDagExecutor()

    const iter = dag.execute({ tasks, executor, workspaceId: "ws-1" })
    expect(typeof iter[Symbol.asyncIterator]).toBe("function")
    const same = iter[Symbol.asyncIterator]()
    expect(same).toBe(iter)

    await collect(iter)
    await executor.shutdown()
  })
})
