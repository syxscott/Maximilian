/**
 * Concurrent execution tests for AgentRuntime.
 *
 * Verifies that:
 *   - Independent tasks run concurrently (not serially).
 *   - A diamond-shaped dependency graph [A→{B,C}→D] is executed in the
 *     correct topological order and waves of parallelism are honored.
 *   - Failed dependencies properly skip their downstream tasks.
 */
import { describe, it, expect } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import { Agent } from "../src/agent.js"
import type { AgentContext } from "../src/agent.js"
import type { Plan, Workspace, Task, Result } from "../src/types.js"

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
      id: `r-${task.id}`,
      taskId: task.id,
      agentRole: task.agentRole,
      output: "ok",
      metadata: { usage: { input: 10, output: 5 } },
    }
  }
}

/**
 * Slow agent that records the wall-clock start/end of each task it runs.
 * Used to verify concurrency by checking whether independent tasks overlap
 * in time.
 */
class TimedAgent extends Agent {
  readonly manifest = {
    role: "general" as const,
    systemPrompt: "stub",
    name: "stub",
    description: "stub",
    capabilities: [],
    model: { provider: "stub", name: "stub-1" },
  }
  constructor(
    private readonly delayMs: number,
    private readonly events: Array<{ taskId: string; start: number; end: number }>,
  ) {
    super({ id: "stub", name: "stub", defaultModel: "stub-1", isConfigured: () => true } as never)
  }
  async execute(task: Task, _ctx: AgentContext): Promise<Result> {
    const start = Date.now()
    await new Promise((r) => setTimeout(r, this.delayMs))
    const end = Date.now()
    this.events.push({ taskId: task.id, start, end })
    return {
      id: `r-${task.id}`,
      taskId: task.id,
      agentRole: task.agentRole,
      output: "ok",
      metadata: { usage: { input: 10, output: 5 } },
    }
  }
}

function makeRuntimeWithAgent(makeAgent: () => Agent, maxConcurrency = 5) {
  const sink = {
    workspaces: new Map<string, Workspace>(),
    async saveWorkspace(w: Workspace) {
      this.workspaces.set(w.id, w)
    },
    async loadWorkspace(id: string) {
      return this.workspaces.get(id)
    },
  }
  return new AgentRuntime(makeAgent, sink, { maxConcurrency })
}

describe("Concurrent task execution", () => {
  it("runs 3 independent tasks concurrently (not serially)", async () => {
    const events: Array<{ taskId: string; start: number; end: number }> = []
    const TASK_MS = 80
    const rt = makeRuntimeWithAgent(() => new TimedAgent(TASK_MS, events))

    const tasks: Task[] = [
      { id: "t1", description: "t1", agentRole: "general", dependsOn: [], status: "pending" },
      { id: "t2", description: "t2", agentRole: "general", dependsOn: [], status: "pending" },
      { id: "t3", description: "t3", agentRole: "general", dependsOn: [], status: "pending" },
    ]
    const workspace: Workspace = {
      id: "ws-concurrent",
      userRequest: "x",
      plan: { tasks, edges: [] },
      results: [],
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const wallStart = Date.now()
    const done = await rt.execute(workspace)
    const wallEnd = Date.now()
    const wallMs = wallEnd - wallStart

    // If serial, wall time would be ~240ms (3 * 80). With concurrency,
    // it should be roughly one task's worth (~80-150ms in practice).
    expect(wallMs).toBeLessThan(TASK_MS * 2.5)
    expect(done.results).toHaveLength(3)
    expect(done.status).toBe("completed")

    // Verify temporal overlap: the start of the 2nd task should be
    // before the end of the 1st task. If they ran serially, every
    // start would be >= every previous end.
    const sorted = [...events].sort((a, b) => a.start - b.start)
    const t1End = sorted[0]!.end
    const t2Start = sorted[1]!.start
    const t3Start = sorted[2]!.start
    // Allow tiny clock skew; the key invariant is at least one later task
    // started before the first one finished.
    expect(t2Start < t1End || t3Start < t1End).toBe(true)
  })

  it("diamond dependency graph [A→B, A→C, B+C→D] executes in correct order", async () => {
    const events: Array<{ taskId: string; start: number; end: number }> = []
    const TASK_MS = 50
    const rt = makeRuntimeWithAgent(() => new TimedAgent(TASK_MS, events))

    // A must complete before B and C; B and C must complete before D.
    // Expected wave structure: {A} → {B,C} in parallel → {D}
    const tasks: Task[] = [
      { id: "A", description: "root", agentRole: "general", dependsOn: [], status: "pending" },
      { id: "B", description: "left", agentRole: "general", dependsOn: ["A"], status: "pending" },
      { id: "C", description: "right", agentRole: "general", dependsOn: ["A"], status: "pending" },
      {
        id: "D",
        description: "join",
        agentRole: "general",
        dependsOn: ["B", "C"],
        status: "pending",
      },
    ]
    const workspace: Workspace = {
      id: "ws-diamond",
      userRequest: "x",
      plan: { tasks, edges: [] },
      results: [],
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const done = await rt.execute(workspace)

    expect(done.results).toHaveLength(4)
    expect(done.status).toBe("completed")

    // Verify topological order: A's end < B.start, A's end < C.start,
    // and (B.end < D.start AND C.end < D.start).
    const ev = (id: string) => events.find((e) => e.taskId === id)!
    const aEnd = ev("A").end
    const bStart = ev("B").start
    const cStart = ev("C").start
    const dStart = ev("D").start
    const bEnd = ev("B").end
    const cEnd = ev("C").end

    // Allow tiny clock skew via ≥ comparison since wall-clock at ms
    // resolution can report equal values for tasks that effectively
    // ran in order.
    expect(aEnd).toBeLessThanOrEqual(bStart)
    expect(aEnd).toBeLessThanOrEqual(cStart)
    expect(bEnd).toBeLessThanOrEqual(dStart)
    expect(cEnd).toBeLessThanOrEqual(dStart)
  })

  it("skips downstream tasks when a dependency fails", async () => {
    class FailingAgent extends Agent {
      readonly manifest = {
        role: "general" as const,
        systemPrompt: "stub",
        name: "stub",
        description: "stub",
        capabilities: [],
        model: { provider: "stub", name: "stub-1" },
      }
      constructor(private readonly failFor: string) {
        super({
          id: "stub",
          name: "stub",
          defaultModel: "stub-1",
          isConfigured: () => true,
        } as never)
      }
      async execute(task: Task, _ctx: AgentContext): Promise<Result> {
        if (task.id === this.failFor) {
          throw new Error("intentional failure")
        }
        return {
          id: `r-${task.id}`,
          taskId: task.id,
          agentRole: task.agentRole,
          output: "ok",
          metadata: { usage: { input: 10, output: 5 } },
        }
      }
    }

    const sink = {
      workspaces: new Map<string, Workspace>(),
      async saveWorkspace(w: Workspace) {
        this.workspaces.set(w.id, w)
      },
      async loadWorkspace(id: string) {
        return this.workspaces.get(id)
      },
    }
    const rt = new AgentRuntime(() => new FailingAgent("A"), sink, { maxTaskRetries: 0 })

    const tasks: Task[] = [
      { id: "A", description: "fails", agentRole: "general", dependsOn: [], status: "pending" },
      {
        id: "B",
        description: "downstream",
        agentRole: "general",
        dependsOn: ["A"],
        status: "pending",
      },
    ]
    const workspace: Workspace = {
      id: "ws-skip",
      userRequest: "x",
      plan: { tasks, edges: [] },
      results: [],
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const done = await rt.execute(workspace)
    expect(done.status).toBe("failed")
    // When A fails, the runtime marks B (which depends on A) as "skipped"
    // rather than leaving it "pending" forever - this lets the UI show
    // distinctly that B will never run, instead of a stuck "pending" status.
    const aTask = done.plan!.tasks.find((t) => t.id === "A")!
    const bTask = done.plan!.tasks.find((t) => t.id === "B")!
    expect(aTask.status).toBe("failed")
    expect(aTask.error).toBeTruthy()
    expect(bTask.status).toBe("skipped")
    expect(bTask.startedAt).toBeUndefined()
    // No results should have been recorded for either task.
    expect(done.results).toHaveLength(0)
  })
})
