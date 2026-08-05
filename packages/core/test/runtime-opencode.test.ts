/**
 * Phase 2 test: AgentRuntime routes tasks through OpencodeExecutor when configured.
 *
 * Mock-based — does not require a real opencode serve. The OpencodeExecutor
 * uses the native fetch, which we stub globally.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Agent, AgentRuntime, type AgentFactory, type AgentContext } from "../src/index.js"
import type { Provider, ChatMessage, ChatResponse, ChatOptions } from "@max/providers"
import type { AgentManifest, Plan, Result, Task, Workspace, WorkspaceStatus } from "../src/types.js"

const STUB_MANIFEST: AgentManifest = {
  role: "general",
  displayName: "Stub",
  goal: "stub",
  systemPrompt: "stub",
}

class StubProvider implements Provider {
  id = "stub"
  name = "stub"
  defaultModel = "stub-1"
  isConfigured(): boolean {
    return true
  }
  async chat(_messages: ChatMessage[], _opts?: ChatOptions): Promise<ChatResponse> {
    return {
      content: "ok",
      model: "stub-1",
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    }
  }
  async *stream() {
    throw new Error("not used")
  }
}

class StubAgent extends Agent {
  override readonly manifest = STUB_MANIFEST
  constructor(provider: Provider, opts: { throwOnExecute?: boolean } = {}) {
    super(provider)
    this.throwOnExecute = opts.throwOnExecute ?? false
  }
  private throwOnExecute: boolean
  override async execute(_task: Task, _ctx: AgentContext): Promise<Result> {
    if (this.throwOnExecute) {
      throw new Error("should NOT be called when opencode is configured")
    }
    return {
      id: `r-${_task.id}`,
      taskId: _task.id,
      agentRole: _task.agentRole,
      agentId: "stub",
      output: "ok",
      metadata: {},
      createdAt: new Date().toISOString(),
    }
  }
}

function makeWorkspace(id: string, taskId: string): Workspace {
  const task: Task = {
    id: taskId,
    description: "echo hello",
    agentRole: "general",
    dependsOn: [],
    status: "pending",
  } as Task
  const plan: Plan = {
    id: `plan-${id}`,
    workspaceId: id,
    userRequest: "test",
    rationale: "",
    tasks: [task],
    createdAt: new Date().toISOString(),
  }
  return {
    id,
    userRequest: "test",
    plan,
    results: [],
    status: "pending" as WorkspaceStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function makeSink() {
  return {
    workspaces: new Map<string, Workspace>(),
    async saveWorkspace(w: Workspace) {
      this.workspaces.set(w.id, w)
    },
    async loadWorkspace(id: string) {
      return this.workspaces.get(id)
    },
  }
}

function makeOk<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("AgentRuntime — opencode executor (Phase 2)", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => vi.restoreAllMocks())

  it("routes task through opencode when configured, never calls agent.execute", async () => {
    let sessionCreateCalled = false
    let promptCalled = false
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "")
      const method = init?.method ?? "GET"
      if (path === "/api/health") return makeOk({ healthy: true })
      if (path === "/api/session" && method === "POST" && !sessionCreateCalled) {
        sessionCreateCalled = true
        return makeOk({
          data: {
            id: "ses_opencode_1",
            title: "t",
            projectID: "p",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: Date.now(), updated: Date.now() },
          },
        })
      }
      if (path === "/api/session/ses_opencode_1/prompt" && method === "POST" && !promptCalled) {
        promptCalled = true
        return makeOk({ data: null })
      }
      if (path === "/api/session/ses_opencode_1/wait" && method === "POST") {
        return new Response(null, { status: 204 })
      }
      if (path === "/api/session/ses_opencode_1/message" && method === "GET") {
        return makeOk({
          data: [
            {
              id: "m1",
              role: "assistant",
              sessionID: "ses_opencode_1",
              parts: [{ type: "text", text: { text: "echo hello (via opencode)" } }],
            },
          ],
        })
      }
      return makeOk({ data: null }, 404)
    })

    const factory: AgentFactory = () => new StubAgent(new StubProvider(), { throwOnExecute: true })
    const sink = makeSink()
    const rt = new AgentRuntime(factory, sink, {
      maxConcurrency: 1,
      opencode: { baseUrl: "http://opencode.test" },
    })

    const ws = makeWorkspace("ws-opencode-1", "task-1")
    const out = await rt.execute(ws)

    // Verify the opencode SDK was called
    expect(sessionCreateCalled).toBe(true)
    expect(promptCalled).toBe(true)

    // Verify the in-process agent was NOT called (StubAgent.execute throws)
    expect(out.results).toHaveLength(1)
    expect(out.results[0].output).toBe("echo hello (via opencode)")
    expect(out.results[0].metadata).toMatchObject({ executor: "opencode" })
  })

  it("falls back to in-process when opencode option is NOT configured", async () => {
    const factory: AgentFactory = () => new StubAgent(new StubProvider()) // no throw flag
    const sink = makeSink()
    const rt = new AgentRuntime(factory, sink, {
      maxConcurrency: 1,
      // NO opencode option
    })
    const ws = makeWorkspace("ws-no-opencode", "task-1")
    const out = await rt.execute(ws)
    expect(out.results).toHaveLength(1)
    // in-process path runs StubAgent.execute → returns Result with output "ok"
    expect(out.results[0].output).toBe("ok")
  })
})