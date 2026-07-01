/**
 * Regression test for the P1-D integration: when the runtime has a
 * `getSkills` source, the runtime matches each task's description against
 * the skills' triggers and injects a skills prelude into the agent's
 * system prompt. Agents with no matching trigger get an empty prelude.
 */
import { describe, it, expect } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import { Agent, type AgentContext } from "../src/agent.js"
import type { AgentManifest, Plan, Result, Task, Workspace, RuntimeEvent } from "../src/types.js"
import type { Provider, ChatMessage, ChatResponse } from "@max/providers"

const MANIFEST: AgentManifest = {
  role: "general",
  displayName: "Probe",
  goal: "probe",
  systemPrompt: "PROBE_SYSTEM",
}

class CapturingProvider implements Provider {
  id = "capturing"
  name = "capturing"
  defaultModel = "p-1"
  isConfigured(): boolean { return true }
  captured: ChatMessage[][] = []
  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    this.captured.push(messages)
    return {
      content: "ok",
      model: "p-1",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }
  }
  async *stream() { /* noop */ throw new Error("not used") }
}

class CaptureAgent extends Agent {
  override readonly manifest = MANIFEST
  constructor(provider: Provider) { super(provider) }
  override async execute(task: Task, ctx: AgentContext): Promise<Result> {
    // Force buildMessages() to run so the prelude is composed with the
    // skills + memory sections before the chat call.
    this.buildMessages(task.description)
    const messages = this.buildChatMessages(task, ctx)
    const capturing = this.provider as CapturingProvider
    const response = await capturing.chat(messages)
    return {
      id: `r-${Math.random().toString(36).slice(2, 8)}`,
      taskId: task.id,
      agentRole: task.agentRole,
      output: response.content,
    }
  }
}

function makeWorkspace(id: string, n: number, description: string): Workspace {
  const tasks: Task[] = Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    description,
    agentRole: "general",
    dependsOn: [],
    status: "pending",
  }))
  const plan: Plan = { tasks, edges: [] }
  return {
    id,
    userRequest: description,
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

describe("Runtime skills prelude integration (P1-D)", () => {
  it("injects matching skill summaries into the system prompt", async () => {
    const provider = new CapturingProvider()
    const rt = new AgentRuntime(
      () => new CaptureAgent(provider),
      makeSink(),
      {
        maxConcurrency: 1,
        getSkills: async () => [
          {
            frontmatter: { name: "web-search", description: "Search the web.", triggers: ["search:"] },
            body: "ignored",
          },
          {
            frontmatter: { name: "summarize", description: "Summarize text.", triggers: ["summarize:"] },
            body: "ignored",
          },
        ],
      },
    )
    await rt.execute(makeWorkspace("ws-1", 1, "search: cats"))
    const sysMsg = provider.captured[0]?.[0]
    expect(sysMsg?.role).toBe("system")
    expect(sysMsg?.content).toContain("PROBE_SYSTEM")
    expect(sysMsg?.content).toContain("web-search")
    expect(sysMsg?.content).toContain("Search the web.")
    expect(sysMsg?.content).not.toContain("summarize")
  })

  it("emits an empty prelude when no triggers match", async () => {
    const provider = new CapturingProvider()
    const rt = new AgentRuntime(
      () => new CaptureAgent(provider),
      makeSink(),
      {
        maxConcurrency: 1,
        getSkills: async () => [
          { frontmatter: { name: "web-search", triggers: ["search:"] }, body: "" },
        ],
      },
    )
    await rt.execute(makeWorkspace("ws-2", 1, "do math"))
    const sysMsg = provider.captured[0]?.[0]
    expect(sysMsg?.content).not.toContain("# Skills that may apply")
  })

  it("skips skill loading entirely when no getSkills source is configured", async () => {
    const provider = new CapturingProvider()
    const rt = new AgentRuntime(
      () => new CaptureAgent(provider),
      makeSink(),
      { maxConcurrency: 1 },
    )
    await rt.execute(makeWorkspace("ws-3", 1, "search: anything"))
    const sysMsg = provider.captured[0]?.[0]
    expect(sysMsg?.content).toBe("PROBE_SYSTEM")
  })
})