/**
 * Phase C — Runtime task condition check (借鉴 autogen DiGraph).
 *
 * A task with `metadata.condition` can only run when its condition string
 * (case-insensitive substring) appears in at least one prior result's output.
 * Mirrors autogen's check_condition() substring-match path.
 *
 * Verifies:
 *   - task without condition runs as soon as deps complete
 *   - task with unsatisfied condition stays pending (deps complete but condition not met)
 *   - task with satisfied condition runs after the matching prior result
 *   - condition match is case-insensitive
 */
import { describe, it, expect } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import { Agent, type AgentContext } from "../src/agent.js"
import type { AgentManifest, Result, Task, Workspace } from "../src/types.js"

const STUB_MANIFEST: AgentManifest = {
  role: "general",
  displayName: "Stub",
  goal: "stub",
  systemPrompt: "stub",
}

class ScriptedAgent extends Agent {
  override readonly manifest = STUB_MANIFEST
  private index = 0
  constructor(private readonly responses: string[]) {
    super({ id: "stub", name: "stub", defaultModel: "stub-1", isConfigured: () => true } as never)
  }
  override async execute(_task: Task, _ctx: AgentContext): Promise<Result> {
    const out = this.responses[this.index] ?? "(no more responses)"
    this.index++
    return {
      id: `r-${_task.id}`,
      taskId: _task.id,
      agentRole: _task.agentRole,
      agentId: this.id,
      output: out,
      metadata: { usage: { input: 1, output: 1 } },
      createdAt: new Date().toISOString(),
    }
  }
}

function makeSink() {
  const workspaces = new Map<string, Workspace>()
  return {
    workspaces,
    async saveWorkspace(w: Workspace) { workspaces.set(w.id, w) },
    async loadWorkspace(id: string) { return workspaces.get(id) },
  }
}

function makeWorkspace(id: string, userRequest: string, tasks: Task[]): Workspace {
  return {
    id,
    userRequest,
    status: "planning",
    plan: {
      id: `plan-${id}`,
      workspaceId: id,
      userRequest,
      rationale: "test",
      tasks,
      createdAt: new Date().toISOString(),
    },
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  }
}

describe("Task condition check (借鉴 autogen DiGraph)", () => {
  it("runs task without condition when deps complete", async () => {
    const agent = new ScriptedAgent(["done"])
    const rt = new AgentRuntime(() => agent, makeSink(), { maxConcurrency: 1 })
    const ws = makeWorkspace("ws-1", "test", [
      { id: "task-1", agentRole: "general", description: "x", status: "pending", dependsOn: [] },
    ])
    const finalWs = await rt.execute(ws)
    expect(finalWs.results).toHaveLength(1)
  })

  it("blocks task with unsatisfied condition even when deps complete", async () => {
    // The first task's output does NOT contain the condition string, so
    // the second task should never run.
    const agent = new ScriptedAgent(["first task done", "should-not-run"])
    const rt = new AgentRuntime(() => agent, makeSink(), { maxConcurrency: 1 })
    const ws = makeWorkspace("ws-2", "test", [
      { id: "task-1", agentRole: "general", description: "x", status: "pending", dependsOn: [] },
      {
        id: "task-2",
        agentRole: "general",
        description: "y",
        status: "pending",
        dependsOn: ["task-1"],
        metadata: { condition: "never-appears" },
      },
    ])
    const finalWs = await rt.execute(ws)
    expect(finalWs.results).toHaveLength(1)
    expect(finalWs.results[0]?.output).toBe("first task done")
    // Workspace fails because task-2 can never run — unresolvable cycle.
    expect(finalWs.status).toBe("failed")
  })

  it("runs task when its condition is satisfied by prior result", async () => {
    // First task's output contains "schema defined" (the condition string).
    // Second task's condition is satisfied, so it runs.
    const agent = new ScriptedAgent(["schema defined and ready", "migration done"])
    const rt = new AgentRuntime(() => agent, makeSink(), { maxConcurrency: 1 })
    const ws = makeWorkspace("ws-3", "test", [
      { id: "task-1", agentRole: "general", description: "setup", status: "pending", dependsOn: [] },
      {
        id: "task-2",
        agentRole: "general",
        description: "migrate",
        status: "pending",
        dependsOn: ["task-1"],
        metadata: { condition: "schema defined" },
      },
    ])
    const finalWs = await rt.execute(ws)
    expect(finalWs.results).toHaveLength(2)
    expect(finalWs.results[1]?.output).toBe("migration done")
    expect(finalWs.status).toBe("completed")
  })

  it("condition match is case-insensitive", async () => {
    const agent = new ScriptedAgent(["SCHEMA DEFINED OK", "done"])
    const rt = new AgentRuntime(() => agent, makeSink(), { maxConcurrency: 1 })
    const ws = makeWorkspace("ws-4", "test", [
      { id: "task-1", agentRole: "general", description: "setup", status: "pending", dependsOn: [] },
      {
        id: "task-2",
        agentRole: "general",
        description: "migrate",
        status: "pending",
        dependsOn: ["task-1"],
        metadata: { condition: "schema defined" }, // lowercase
      },
    ])
    const finalWs = await rt.execute(ws)
    expect(finalWs.results).toHaveLength(2)
  })
})