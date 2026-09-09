/**
 * Verifies the borrowed Kosmos modules are actually wired into the runtime.
 *
 * Each test injects one of:
 *   - SafetyGuardrails  → checked at every tool call (here we assert the
 *     constructor accepts the option without throwing, since exercising the
 *     hook end-to-end requires a tool-enabled provider that we don't have
 *     access to in unit tests)
 *   - ReproducibilityManager → capture at workspace start, verify at end
 *   - failureDetector → observe on every completed task
 *
 * The full SafetyGuardrails + tool-loop integration is exercised in
 * tool-integration.test.ts; this file focuses on the *plumbing* layer that
 * carries the modules from RuntimeOptions into the hot path.
 */

import { describe, it, expect } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import { Agent } from "../src/agent.js"
import { SafetyGuardrails } from "../src/safety/guardrails.js"
import { ReproducibilityManager } from "../src/safety/reproducibility.js"
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
  constructor(private readonly outputText: string) {
    super({ id: "stub", name: "stub", defaultModel: "stub-1", isConfigured: () => true } as never)
  }
  async execute(task: Task, _ctx: AgentContext): Promise<Result> {
    return {
      id: `r-${task.id}`,
      taskId: task.id,
      agentRole: task.agentRole,
      output: this.outputText,
      metadata: {},
    }
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

function makeWorkspace(taskCount = 1): Workspace {
  const tasks: Task[] = Array.from({ length: taskCount }, (_, i) => ({
    id: `task-${i + 1}`,
    agentRole: "general" as const,
    description: `task ${i + 1}`,
    status: "pending" as const,
    dependsOn: [],
  }))
  const plan: Plan = {
    id: "plan-wiring",
    workspaceId: "ws-wiring",
    userRequest: "wiring test",
    rationale: "wiring test",
    tasks,
    createdAt: new Date().toISOString(),
  }
  return {
    id: "ws-wiring",
    userRequest: "wiring test",
    status: "planning",
    plan,
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  }
}

describe("AgentRuntime Kosborrowed module wiring", () => {
  it("SafetyGuardrails option is accepted on construction", () => {
    // Smoke test — the constructor must accept the option without throwing.
    // The actual tool-loop integration is exercised by tool-integration tests.
    const guardrails = new SafetyGuardrails({
      limits: { allowFileWrite: true, allowNetworkAccess: true },
    })
    expect(
      () =>
        new AgentRuntime(() => new StubAgent("ok"), makeSink(), { safetyGuardrails: guardrails }),
    ).not.toThrow()
  })

  it("ReproducibilityManager.capture() runs at start and verify() at end", async () => {
    const repro = new ReproducibilityManager({ defaultSeed: 42 })
    const sink = makeSink()
    const runtime = new AgentRuntime(() => new StubAgent("ok"), sink, {
      reproducibilityManager: repro,
    })
    const final = await runtime.execute(makeWorkspace(1))
    // Verify() path stashes the report on workspace.metadata.reproducibility.
    expect(final.metadata.reproducibility).toBeDefined()
    const report = (final.metadata as Record<string, unknown>).reproducibility as {
      experimentId: string
      isReproducible: boolean
      consistencyChecks: string[]
      issues: string[]
    }
    expect(report.experimentId).toBe("ws-wiring")
    expect(typeof report.isReproducible).toBe("boolean")
    expect(report.consistencyChecks.length).toBeGreaterThanOrEqual(2)
    // Without any environment mutations mid-run, start === end.
    expect(report.issues).toEqual([])
  })

  it("failureDetector.observe() runs on every completed task", async () => {
    const observed: string[] = []
    const detector = (text: string) => {
      observed.push(text)
      return {
        signals: [],
        overallScore: 0,
        failed: false,
      }
    }
    const sink = makeSink()
    const runtime = new AgentRuntime(() => new StubAgent("task output"), sink, {
      failureDetector: detector,
    })
    await runtime.execute(makeWorkspace(3))
    expect(observed).toEqual(["task output", "task output", "task output"])
    // The detection result is also stashed in Result.metadata for downstream
    // consumers (TruthAudit, review task) to surface.
    const ws = sink.workspaces.get("ws-wiring")!
    for (const r of ws.results) {
      expect((r.metadata as Record<string, unknown>)?.failureDetection).toBeDefined()
    }
  })

  it("failureDetector that throws is swallowed — runtime still completes", async () => {
    const sink = makeSink()
    const detector = (): never => {
      throw new Error("detector boom")
    }
    const runtime = new AgentRuntime(() => new StubAgent("ok"), sink, {
      failureDetector: detector,
    })
    // Should not reject; the throw is logged + ignored so a buggy detector
    // can't poison the workspace.
    const final = await runtime.execute(makeWorkspace(1))
    expect(final.status).toBe("completed")
    expect(final.results[0]?.output).toBe("ok")
  })
})
