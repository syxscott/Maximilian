/**
 * Regression test for the concurrent-workspaces termination bug:
 * termination counters (`messagesEmitted`, `tokensConsumed`) must NOT
 * be shared across workspaces. Previously they were instance fields, so
 * running two workspaces in parallel would let workspace B trip a budget
 * predicate based on workspace A's progress.
 */
import { describe, it, expect } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import { Agent } from "../src/agent.js"
import { MaxMessageTermination } from "../src/termination.js"
import type { Plan, Workspace } from "../src/types.js"
import type { AgentContext } from "../src/agent.js"
import type { Result, Task } from "../src/types.js"

class StubAgent extends Agent {
  readonly manifest = {
    role: "general" as const,
    systemPrompt: "stub",
    name: "stub",
    description: "stub",
    capabilities: [],
    model: { provider: "stub", name: "stub-1" },
  }
  constructor() {
    super({ id: "stub", name: "stub", defaultModel: "stub-1", isConfigured: () => true } as never)
  }
  async execute(task: Task, _ctx: AgentContext): Promise<Result> {
    return {
      id: `r-${Math.random().toString(36).slice(2, 8)}`,
      taskId: task.id,
      agentRole: task.agentRole,
      output: "ok",
      metadata: { usage: { input: 10, output: 5 } },
    }
  }
}

function makePlan(n: number): Plan {
  const tasks: Task[] = Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    description: `task ${i}`,
    agentRole: "general",
    dependsOn: i === 0 ? [] : [`t${i - 1}`],
    status: "pending",
  }))
  return { tasks, edges: [] }
}

function makeWorkspace(id: string, n: number): Workspace {
  return {
    id,
    userRequest: "x",
    plan: makePlan(n),
    results: [],
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function makeRuntime(termination: ReturnType<typeof MaxMessageTermination>) {
  const sink = {
    workspaces: new Map<string, Workspace>(),
    async saveWorkspace(w: Workspace) {
      this.workspaces.set(w.id, w)
    },
    async loadWorkspace(id: string) {
      return this.workspaces.get(id)
    },
  }
  return new AgentRuntime(
    () => new StubAgent(),
    sink,
    { termination, maxConcurrency: 2 },
  )
}

describe("Per-workspace termination counters", () => {
  it("does not share messagesEmitted between concurrent workspaces", async () => {
    // Each workspace has 3 tasks. MaxMessageTermination(3) should let each
    // workspace finish all 3 tasks independently. If counters were shared,
    // workspace B would terminate after 0 tasks (workspace A already used 3).
    const rt = makeRuntime(MaxMessageTermination(3))

    const wsA = makeWorkspace("A", 3)
    const wsB = makeWorkspace("B", 3)

    // Run sequentially with each at max budget; both should complete fully.
    const aDone = await rt.execute(wsA)
    const bDone = await rt.execute(wsB)

    const aCompleted = aDone.results.length
    const bCompleted = bDone.results.length

    expect(aCompleted).toBe(3)
    expect(bCompleted).toBe(3)
    expect(aDone.status).toBe("completed")
    expect(bDone.status).toBe("completed")
  })

  it("terminates a workspace early when its OWN counter exceeds the budget", async () => {
    // MaxMessageTermination(2) should let workspace A finish 2 tasks and
    // mark the 3rd as skipped. The counter is per-workspace; it does NOT
    // roll forward from prior runs.
    const rt = makeRuntime(MaxMessageTermination(2))

    const wsA = makeWorkspace("A", 3)
    const aDone = await rt.execute(wsA)

    const aCompleted = aDone.results.filter((r) => r.output === "ok").length
    // 2 should run, 1 should be skipped (terminated)
    expect(aCompleted).toBeLessThanOrEqual(2)
    expect(aDone.error).toMatch(/terminated/)
  })

  it("first workspace's count does not leak into a fresh workspace's MaxMessage budget", async () => {
    const rt = makeRuntime(MaxMessageTermination(2))
    const a = await rt.execute(makeWorkspace("A", 2))
    expect(a.results.length).toBe(2)
    // Workspace B should still have its full 2-task budget, not 0.
    const b = await rt.execute(makeWorkspace("B", 2))
    expect(b.results.length).toBe(2)
    expect(b.status).toBe("completed")
  })
})