/**
 * Regression test for the P0-A wiring: when the runtime has
 * `enableToolLoop: true` and an agent returns a tool-enabled provider from
 * `getToolProvider()`, the runtime routes the task through `runToolLoop` and
 * emits `tool-start` / `tool-end` events through the normal emit path. Agents
 * without a tool provider must continue to use the single-shot execute path
 * (no regression).
 */
import { describe, it, expect } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import { Agent, type AgentContext } from "../src/agent.js"
import { ToolEnabledProvider, createToolRegistry } from "../src/tool-integration.js"
import type { AgentManifest, Plan, Result, Task, Workspace, RuntimeEvent } from "../src/types.js"
import type { Provider, ChatMessage, ChatResponse } from "@max/providers"

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
  isConfigured(): boolean { return true }
  async chat(_messages: ChatMessage[]): Promise<ChatResponse> {
    return {
      // Include a tool block so `parseToolCalls` yields a non-empty list and
      // the loop emits `tool-start` before invoking the registry.
      content: "```tool\n{\"name\":\"echo\",\"input\":{\"x\":1}}\n```",
      model: "stub-1",
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    }
  }
  async *stream() { /* noop */ throw new Error("not used") }
}

class ToolAgent extends Agent {
  override readonly manifest = STUB_MANIFEST
  private readonly toolProvider: ToolEnabledProvider
  constructor() {
    super(new StubProvider())
    // Synchronous registry creation; empty by default. The stub's tool call
    // for `echo` will fail inside `executeTool`, but the `tool-start` event
    // fires before that — which is what this test asserts on.
    this.toolProvider = new ToolEnabledProvider(new StubProvider(), createToolRegistry())
  }
  override getToolProvider(): ToolEnabledProvider | undefined {
    return this.toolProvider
  }
  override async execute(_task: Task, _ctx: AgentContext): Promise<Result> {
    return {
      id: "should-not-be-called",
      taskId: _task.id,
      agentRole: _task.agentRole,
      output: "should-not-be-called",
    }
  }
}

class PlainAgent extends Agent {
  override readonly manifest = STUB_MANIFEST
  constructor() {
    super(new StubProvider())
  }
  override async execute(_task: Task, _ctx: AgentContext): Promise<Result> {
    return {
      id: `r-${Math.random().toString(36).slice(2, 8)}`,
      taskId: _task.id,
      agentRole: _task.agentRole,
      output: "ok",
    }
  }
}

function makeWorkspace(id: string, n: number): Workspace {
  const tasks: Task[] = Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    description: `task ${i}`,
    agentRole: "general",
    dependsOn: [],
    status: "pending",
  }))
  const plan: Plan = { tasks, edges: [] }
  return {
    id,
    userRequest: "x",
    plan,
    results: [],
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function makeSink() {
  return {
    workspaces: new Map<string, Workspace>(),
    async saveWorkspace(w: Workspace) { this.workspaces.set(w.id, w) },
    async loadWorkspace(id: string) { return this.workspaces.get(id) },
  }
}

describe("Runtime tool-loop integration (P0-A)", () => {
  it("emits tool-start when enableToolLoop is set and agent has a tool provider", async () => {
    const rt = new AgentRuntime(
      () => new ToolAgent(),
      makeSink(),
      { enableToolLoop: true, maxConcurrency: 1 },
    )

    const events: RuntimeEvent[] = []
    rt.on((e) => events.push(e))

    await rt.execute(makeWorkspace("ws-1", 1))

    const toolStarts = events.filter((e) => e.type === "tool-start")
    expect(toolStarts.length).toBeGreaterThan(0)
    // The tool-end event fires when the loop catches the "echo not found"
    // error from the empty registry, so we expect at least one tool-end too.
    const toolEnds = events.filter((e) => e.type === "tool-end")
    expect(toolEnds.length).toBeGreaterThan(0)
  })

  it("does not call execute() when tool loop handles the task", async () => {
    const rt = new AgentRuntime(
      () => new ToolAgent(),
      makeSink(),
      { enableToolLoop: true, maxConcurrency: 1 },
    )
    const ws = await rt.execute(makeWorkspace("ws-2", 1))
    // The tool path synthesizes a fresh id; the sentinel "should-not-be-called"
    // would only appear if execute() ran.
    expect(ws.results[0]?.id).not.toBe("should-not-be-called")
  })

  it("falls through to execute() when agent has no tool provider (back-compat)", async () => {
    const rt = new AgentRuntime(
      () => new PlainAgent(),
      makeSink(),
      { enableToolLoop: true, maxConcurrency: 1 },
    )
    const events: RuntimeEvent[] = []
    rt.on((e) => events.push(e))
    const ws = await rt.execute(makeWorkspace("ws-3", 1))
    expect(ws.results[0]?.output).toBe("ok")
    expect(events.some((e) => e.type === "tool-start")).toBe(false)
    expect(events.some((e) => e.type === "tool-end")).toBe(false)
  })
})