/**
 * Regression test for the P1-C fix: a "round" in the Magentic-One ledger
 * is one scheduling wave (one pass over the dependency graph), not one task.
 * Tasks that run concurrently in the same wave must share the same round
 * number; tasks in a later wave must have a higher round number.
 */
import { describe, it, expect } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import { Agent, type AgentContext } from "../src/agent.js"
import type { AgentManifest, Plan, Result, Task, Workspace } from "../src/types.js"
import type { Provider, ChatMessage, ChatResponse } from "@max/providers"

const MANIFEST: AgentManifest = {
  role: "general",
  displayName: "x",
  goal: "x",
  systemPrompt: "x",
}

class SlowProvider implements Provider {
  id = "slow"
  name = "slow"
  defaultModel = "p-1"
  isConfigured(): boolean { return true }
  async chat(_m: ChatMessage[]): Promise<ChatResponse> {
    // Yield to ensure the scheduler can fan out concurrently.
    await new Promise((r) => setTimeout(r, 5))
    return {
      content: "ok",
      model: "p-1",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }
  }
  async *stream() { throw new Error("not used") }
}

class CountingAgent extends Agent {
  override readonly manifest = MANIFEST
  constructor(provider: Provider) { super(provider) }
  override async execute(task: Task, _ctx: AgentContext): Promise<Result> {
    return {
      id: `r-${task.id}`,
      taskId: task.id,
      agentRole: task.agentRole,
      output: "ok",
    }
  }
}

function makePlan(tasks: Array<Pick<Task, "id" | "dependsOn" | "description">>): Plan {
  return {
    tasks: tasks.map((t) => ({
      id: t.id,
      description: t.description ?? t.id,
      agentRole: "general" as const,
      dependsOn: t.dependsOn ?? [],
      status: "pending" as const,
    })),
    edges: [],
  }
}

function makeWorkspace(plan: Plan, id = "ws-1"): Workspace {
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

describe("Ledger round semantics (P1-C)", () => {
  it("two independent tasks in the same wave share the same round", async () => {
    const rt = new AgentRuntime(
      () => new CountingAgent(new SlowProvider()),
      makeSink(),
      { maxConcurrency: 5 },
    )
    const plan = makePlan([
      { id: "a", dependsOn: [], description: "a" },
      { id: "b", dependsOn: [], description: "b" },
    ])
    const ws = await rt.execute(makeWorkspace(plan))

    // Both tasks must share the SAME round number — they're in one wave.
    const ledger = rt.getLedger(ws.id)
    const observations = ledger?.entries.filter((e) => e.kind === "observation") ?? []
    const actions = ledger?.entries.filter((e) => e.kind === "action") ?? []
    const actionRounds = actions.map((e) => e.kind === "action" ? e.round : -1)
    const obsRounds = observations.map((e) => e.kind === "observation" ? e.round : -1)
    expect(new Set(actionRounds).size).toBe(1)
    expect(new Set(obsRounds).size).toBe(1)
  })

  it("a dependent task in a later wave has a higher round number", async () => {
    const rt = new AgentRuntime(
      () => new CountingAgent(new SlowProvider()),
      makeSink(),
      { maxConcurrency: 5 },
    )
    const plan = makePlan([
      { id: "a", dependsOn: [], description: "a" },
      { id: "b", dependsOn: ["a"], description: "b" },
    ])
    const ws = await rt.execute(makeWorkspace(plan))

    const ledger = rt.getLedger(ws.id)
    const actions = (ledger?.entries ?? []).filter((e) => e.kind === "action")
    const aRound = actions.find((e) => e.kind === "action" && e.agent === "general" && (e.input as { description?: string })?.description === "a")?.round
    const bRound = actions.find((e) => e.kind === "action" && e.agent === "general" && (e.input as { description?: string })?.description === "b")?.round
    expect(aRound).toBeDefined()
    expect(bRound).toBeDefined()
    // Wave 1 = "a" runs, wave 2 = "b" runs after "a" completes.
    expect((bRound as number) > (aRound as number)).toBe(true)
  })
})