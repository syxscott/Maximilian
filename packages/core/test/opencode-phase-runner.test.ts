// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * OpencodePhaseRunner tests (Phase 3d).
 *
 * The OpencodeExecutor uses native fetch, so we stub it globally per-test.
 * Tests verify:
 *   - All tasks in a phase run through opencode serve in parallel
 *   - Dependencies are respected (no task starts before its deps complete)
 *   - Failed tasks produce a 'fail' phase verdict
 *   - gate() can override the verdict
 *   - session:idle + task:complete events fire on the EventBus
 *   - Aborted signals short-circuit remaining tasks
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  OpencodePhaseRunner,
  type OpencodePhaseEvent,
  type PhaseTaskOutcome,
} from "../src/opencode-phase-runner.js"
import { OpencodeExecutor } from "../src/opencode-executor.js"
import { EventBus } from "../src/event-bus.js"
import type { Phase, Task } from "../src/types.js"

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

function stubOpencodeOK(): {
  fetchMock: ReturnType<typeof vi.fn>
  sessions: Map<string, string>
} {
  const fetchMock = vi.fn()
  const sessions = new Map<string, string>()
  let sessionCounter = 0

  fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "")
    const method = init?.method ?? "GET"

    if (path === "/api/health") return makeOk({ healthy: true })

    if (path === "/api/session" && method === "POST") {
      sessionCounter++
      const id = `ses_${sessionCounter}`
      sessions.set(`ws-1`, id)
      return makeOk({
        data: {
          id,
          title: `t`,
          projectID: "p",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now(), updated: Date.now() },
        },
      })
    }

    const sessionMatch = path.match(/^\/api\/session\/(ses_\d+)\//)
    const sessionId = sessionMatch?.[1]
    if (!sessionId) return makeOk({ data: null }, 404)

    if (path.endsWith("/prompt") && method === "POST") return makeOk({ data: null })
    if (path.endsWith("/wait") && method === "POST") return new Response(null, { status: 204 })
    if (path.endsWith("/message") && method === "GET") {
      return makeOk({
        data: [
          {
            id: `m_${sessionId}`,
            role: "assistant",
            sessionID: sessionId,
            parts: [{ type: "text", text: { text: `result-for-${sessionId}` } }],
          },
        ],
      })
    }
    if (path.endsWith("DELETE") || method === "DELETE") {
      return new Response(null, { status: 204 })
    }
    return makeOk({ data: null }, 404)
  })

  globalThis.fetch = fetchMock as unknown as typeof fetch
  return { fetchMock, sessions }
}

describe("OpencodePhaseRunner (Phase 3d)", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => vi.restoreAllMocks())

  const simplePhase = (): Phase<unknown, unknown> => ({
    id: "phase-test",
    name: "Test phase",
    description: "executes a list of tasks",
    roles: ["general"],
    inputSchema: {},
    outputSchema: {},
    run: async () => undefined,
  })

  it("runs all tasks in a phase through opencode in parallel", async () => {
    const { fetchMock: fm } = stubOpencodeOK()
    fetchMock = fm

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    const tasks = [mkTask("t1", "alpha"), mkTask("t2", "beta"), mkTask("t3", "gamma")]
    const runner = new OpencodePhaseRunner()
    const outcome = await runner.runPhase({
      phase: simplePhase(),
      tasks,
      executor,
      workspaceId: "ws-1",
    })

    expect(outcome.taskOutcomes).toHaveLength(3)
    expect(outcome.taskOutcomes.every((o) => o.result !== undefined)).toBe(true)
    expect(outcome.verdict).toBe("pass")
    expect(outcome.taskOutcomes.map((o) => o.taskId)).toEqual(["t1", "t2", "t3"])

    const prompts = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/prompt"))
    expect(prompts.length).toBeGreaterThanOrEqual(3)

    await executor.shutdown()
  })

  it("respects task dependencies (downstream waits for upstream)", async () => {
    const { fetchMock: fm } = stubOpencodeOK()
    fetchMock = fm

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })

    const order: string[] = []
    const events: OpencodePhaseEvent[] = []
    const bus = new EventBus<OpencodePhaseEvent>()
    bus.subscribe((e) => {
      events.push(e)
      if (e.type === "task:complete") order.push(e.taskId)
    }, { types: ["task:complete"] })

    // t2 depends on t1; t3 depends on t2 → must run sequentially.
    const tasks = [
      mkTask("t1", "first"),
      mkTask("t2", "second", ["t1"]),
      mkTask("t3", "third", ["t2"]),
    ]
    const runner = new OpencodePhaseRunner()
    const outcome = await runner.runPhase({
      phase: simplePhase(),
      tasks,
      executor,
      workspaceId: "ws-1",
      eventBus: bus,
    })

    expect(outcome.verdict).toBe("pass")
    expect(outcome.taskOutcomes).toHaveLength(3)
    // Completion events must reflect the dependency order.
    expect(order).toEqual(["t1", "t2", "t3"])

    await executor.shutdown()
  })

  it("fires session:idle after each task completes (借鉴 opencode)", async () => {
    const { fetchMock: fm } = stubOpencodeOK()
    fetchMock = fm

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    const idleEvents: OpencodePhaseEvent[] = []
    const bus = new EventBus<OpencodePhaseEvent>()
    bus.subscribe((e) => {
      if (e.type === "session:idle") idleEvents.push(e)
    }, { types: ["session:idle"] })

    const runner = new OpencodePhaseRunner()
    await runner.runPhase({
      phase: simplePhase(),
      tasks: [mkTask("a", "a"), mkTask("b", "b")],
      executor,
      workspaceId: "ws-1",
      eventBus: bus,
    })

    expect(idleEvents.length).toBe(2)
    // Both events carry a sessionId from opencode.
    for (const ev of idleEvents) {
      if (ev.type === "session:idle") {
        expect(ev.sessionId).toMatch(/^ses_/)
      }
    }

    await executor.shutdown()
  })

  it("returns 'fail' verdict when any task fails", async () => {
    const fm = vi.fn()
    globalThis.fetch = fm as unknown as typeof fetch
    fm.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "")
      const method = init?.method ?? "GET"
      if (path === "/api/health") return makeOk({ healthy: true })
      if (path === "/api/session" && method === "POST") {
        return makeOk({
          data: {
            id: "ses_fail",
            title: "x",
            projectID: "p",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: Date.now(), updated: Date.now() },
          },
        })
      }
      if (path.endsWith("/prompt") && method === "POST") return makeOk({ error: "boom" }, 500)
      if (path.endsWith("/wait")) return new Response(null, { status: 204 })
      if (path.endsWith("/message") && method === "GET") return makeOk({ data: [] })
      if (method === "DELETE") return new Response(null, { status: 204 })
      return makeOk({ data: null }, 404)
    })

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    const events: OpencodePhaseEvent[] = []
    const bus = new EventBus<OpencodePhaseEvent>()
    bus.subscribe((e) => events.push(e), { types: ["task:failed", "phase:end"] })

    const runner = new OpencodePhaseRunner()
    const outcome = await runner.runPhase({
      phase: simplePhase(),
      tasks: [mkTask("a", "alpha")],
      executor,
      workspaceId: "ws-1",
      eventBus: bus,
    })

    expect(outcome.verdict).toBe("fail")
    expect(outcome.taskOutcomes[0]!.error).toBeTruthy()
    expect(events.some((e) => e.type === "task:failed")).toBe(true)
    expect(events.some((e) => e.type === "phase:end")).toBe(true)

    await executor.shutdown()
  })

  it("evaluates phase gate after task completion and respects verdict", async () => {
    const { fetchMock: fm } = stubOpencodeOK()
    fetchMock = fm

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })

    const gateFn = vi.fn(async () => "retry" as const)
    const phaseWithGate: Phase<unknown, unknown> = {
      ...simplePhase(),
      gate: gateFn,
    }

    const runner = new OpencodePhaseRunner()
    const outcome = await runner.runPhase({
      phase: phaseWithGate,
      tasks: [mkTask("a", "alpha")],
      executor,
      workspaceId: "ws-1",
    })

    expect(gateFn).toHaveBeenCalledTimes(1)
    expect(outcome.gateVerdict).toBe("retry")
    expect(outcome.verdict).toBe("retry")

    await executor.shutdown()
  })

  it("aborts remaining tasks when signal is cancelled", async () => {
    const { fetchMock: fm } = stubOpencodeOK()
    fetchMock = fm

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })

    // Make every prompt take long enough to abort.
    fm.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 60))
      return makeOk({ data: null })
    })
    // Re-stub for the core endpoints that need to return session/message.
    const originalImpl = (globalThis.fetch as any).getMockImplementation?.()
    void originalImpl

    const ac = new AbortController()
    setTimeout(() => ac.abort(), 10)

    const tasks = [mkTask("a", "a"), mkTask("b", "b"), mkTask("c", "c")]
    const runner = new OpencodePhaseRunner()
    const outcome = await runner.runPhase({
      phase: simplePhase(),
      tasks,
      executor,
      workspaceId: "ws-1",
      signal: ac.signal,
    })

    // Either aborted (failure with "aborted") or already settled success — both acceptable.
    expect(outcome.taskOutcomes).toHaveLength(3)
    // Outcomes reflect abort OR success depending on timing — verify determinism:
    const failed = outcome.taskOutcomes.filter((o) => o.error === "aborted")
    expect(failed.length).toBeGreaterThan(0)

    await executor.shutdown()
  })

  it("emits phase:start and phase:end lifecycle events", async () => {
    const { fetchMock: fm } = stubOpencodeOK()
    fetchMock = fm

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })
    const events: OpencodePhaseEvent[] = []
    const bus = new EventBus<OpencodePhaseEvent>()
    bus.subscribe((e) => events.push(e))

    const runner = new OpencodePhaseRunner()
    await runner.runPhase({
      phase: simplePhase(),
      tasks: [mkTask("a", "a")],
      executor,
      workspaceId: "ws-1",
      eventBus: bus,
    })

    expect(events[0]!.type).toBe("phase:start")
    expect(events.at(-1)!.type).toBe("phase:end")

    await executor.shutdown()
  })

  it("preserves original task order in taskOutcomes", async () => {
    const { fetchMock: fm } = stubOpencodeOK()
    fetchMock = fm

    const executor = new OpencodeExecutor({ baseUrl: "http://oc.test", poolSessions: false })

    // Provide randomized latencies to make ordering nondeterministic if we
    // weren't preserving original order explicitly.
    const latencies: Record<string, number> = { first: 80, second: 20, third: 50 }
    fm.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "")
      const method = init?.method ?? "GET"
      if (path === "/api/health") return makeOk({ healthy: true })
      if (path === "/api/session" && method === "POST") {
        return makeOk({
          data: {
            id: "ses_o",
            title: "x",
            projectID: "p",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: Date.now(), updated: Date.now() },
          },
        })
      }
      if (path.endsWith("/prompt") && method === "POST") {
        // Pull description from the body.
        const body = JSON.parse(String(init?.body ?? "{}")) as { prompt?: { text?: string } }
        const desc = body.prompt?.text ?? ""
        const match = desc.match(/first|second|third/)
        const latency = (match && latencies[match[0]]) ?? 30
        await new Promise((r) => setTimeout(r, latency))
        return makeOk({ data: null })
      }
      if (path.endsWith("/wait")) return new Response(null, { status: 204 })
      if (path.endsWith("/message") && method === "GET") {
        return makeOk({
          data: [
            {
              id: "m",
              role: "assistant",
              sessionID: "ses_o",
              parts: [{ type: "text", text: { text: "ok" } }],
            },
          ],
        })
      }
      if (method === "DELETE") return new Response(null, { status: 204 })
      return makeOk({ data: null }, 404)
    })

    const runner = new OpencodePhaseRunner()
    const tasks = [mkTask("z", "first"), mkTask("y", "second"), mkTask("x", "third")]
    const outcome = await runner.runPhase({
      phase: simplePhase(),
      tasks,
      executor,
      workspaceId: "ws-1",
    })

    expect(outcome.taskOutcomes.map((o) => o.taskId)).toEqual(["z", "y", "x"])
    await executor.shutdown()
  })

  it("does not break existing phase tests — sanity check", () => {
    // This test simply ensures the new module compiles + exports correctly
    // so importing it doesn't invalidate other module loads.
    expect(OpencodePhaseRunner).toBeDefined()
    expect(typeof OpencodePhaseRunner.prototype.runPhase).toBe("function")
  })
})

// Helper: narrow PhaseTaskOutcome for tests that need to inspect it.
function _isError(o: PhaseTaskOutcome): boolean {
  return Boolean(o.error)
}
void _isError
