// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Provider bundle freeze tests (borrowing; OpenAgentCore
 * contracts/agents-api/model-execution.md "Saved defaults" semantics).
 *
 * Verifies that a run binds its provider/model resolution at run start:
 * a selector/router verdict that CHANGES mid-run (hot config update,
 * provider-registry edit) must not affect the run in flight, and the
 * next run re-resolves against the then-current config. With
 * `providerBundleFreeze: false` the legacy per-task re-selection applies.
 */
import { describe, it, expect } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import { ModelRouter, type ModelSelection, type TaskCharacteristics } from "../src/model-router.js"
import { Agent, type AgentContext } from "../src/agent.js"
import type { AgentManifest, Plan, Result, Task, Workspace } from "../src/types.js"

const STUB_MANIFEST: AgentManifest = {
  role: "general",
  displayName: "Stub",
  goal: "stub",
  systemPrompt: "stub",
}

class StubAgent extends Agent {
  override readonly manifest = STUB_MANIFEST
  /** The preferredProvider the runtime's factory call passed in. */
  capturedPreferredProvider?: string
  /** The model override the runtime set (router verdict). */
  capturedOverride?: { provider: string; model: string }
  /** Optional hook invoked when execute runs (models mid-run events). */
  onExecute?: () => void

  override setModelOverride(provider: string, model: string): void {
    super.setModelOverride(provider, model)
    this.capturedOverride = { provider, model }
  }

  override async execute(task: Task, _ctx: AgentContext): Promise<Result> {
    this.onExecute?.()
    return {
      id: `r-${task.id}`,
      taskId: task.id,
      agentRole: task.agentRole,
      output: "ok",
    }
  }
}

/**
 * Selector whose verdict "changes in the registry" after the first call —
 * the stand-in for a mid-run provider-registry edit.
 */
class ShiftingSelector {
  calls = 0
  select(_role: string): { provider: string; model: string; score: number; reason: string } | null {
    this.calls++
    return this.calls <= 1
      ? { provider: "p1", model: "m1", score: 1, reason: "first resolution" }
      : { provider: "p2", model: "m2", score: 1, reason: "edited registry" }
  }
}

/**
 * Router whose verdict shifts once `editRegistry()` is called — the
 * stand-in for a mid-run registry edit. (The eager run-start snapshot
 * consumes one call per planned task BEFORE anything executes, so a
 * call-count shift cannot model a mid-run change.)
 */
class ShiftingRouter extends ModelRouter {
  selectModelCalls = 0
  private edited = false
  editRegistry(): void {
    this.edited = true
  }
  override selectModel(_task: TaskCharacteristics): ModelSelection {
    this.selectModelCalls++
    return this.edited ? { provider: "r2", model: "m2" } : { provider: "r1", model: "m1" }
  }
}

function makeWorkspace(
  id: string,
  tasks: Array<{ id: string; role: string; desc: string; dependsOn?: string[] }>,
): Workspace {
  const ts: Task[] = tasks.map((t) => ({
    id: t.id,
    description: t.desc,
    agentRole: t.role as Task["agentRole"],
    dependsOn: t.dependsOn ?? [],
    status: "pending",
  }))
  const plan: Plan = { tasks: ts, edges: [] }
  return {
    id,
    userRequest: "test",
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
    async saveWorkspace(w: Workspace) {
      this.workspaces.set(w.id, w)
    },
    async loadWorkspace(id: string) {
      return this.workspaces.get(id)
    },
  }
}

describe("provider bundle freeze per run (borrowing)", () => {
  it("a mid-run registry edit does not change the run's provider (default freeze on)", async () => {
    const selector = new ShiftingSelector()
    const agents: StubAgent[] = []
    const rt = new AgentRuntime(
      (_role, preferredProvider) => {
        const agent = new StubAgent()
        agent.capturedPreferredProvider = preferredProvider
        agents.push(agent)
        return agent
      },
      makeSink(),
      {
        // The port surface is structural; the runtime only calls select().
        modelSelector: selector as unknown as import("../src/runtime.js").ModelSelectorPort,
        maxConcurrency: 1,
      },
    )

    await rt.execute(
      makeWorkspace("ws-freeze-1", [
        { id: "t1", role: "general", desc: "first task" },
        { id: "t2", role: "general", desc: "second task", dependsOn: ["t1"] },
      ]),
    )

    // The run-start snapshot resolved the role ONCE; both tasks (the
    // second executed after the "registry edit") used that verdict.
    expect(selector.calls).toBe(1)
    expect(agents).toHaveLength(2)
    expect(agents[0].capturedPreferredProvider).toBe("p1")
    expect(agents[1].capturedPreferredProvider).toBe("p1")
  })

  it("the next run re-resolves and sees the edited registry", async () => {
    const selector = new ShiftingSelector()
    const agents: StubAgent[] = []
    const rt = new AgentRuntime(
      (_role, preferredProvider) => {
        const agent = new StubAgent()
        agent.capturedPreferredProvider = preferredProvider
        agents.push(agent)
        return agent
      },
      makeSink(),
      {
        modelSelector: selector as unknown as import("../src/runtime.js").ModelSelectorPort,
        maxConcurrency: 1,
      },
    )

    await rt.execute(makeWorkspace("ws-runs-1", [{ id: "t1", role: "general", desc: "run one" }]))
    await rt.execute(makeWorkspace("ws-runs-2", [{ id: "t2", role: "general", desc: "run two" }]))

    // Each run snapshots independently: run two observes the edit.
    expect(selector.calls).toBe(2)
    expect(agents[0].capturedPreferredProvider).toBe("p1")
    expect(agents[1].capturedPreferredProvider).toBe("p2")
  })

  it("freezes the router verdict per task for the whole run", async () => {
    const router = new ShiftingRouter()
    const agents: StubAgent[] = []
    const rt = new AgentRuntime(
      () => {
        const agent = new StubAgent()
        // Simulate the registry edit happening DURING the run: the first
        // task's execution flips the router's verdict.
        if (agents.length === 0) agent.onExecute = () => router.editRegistry()
        agents.push(agent)
        return agent
      },
      makeSink(),
      { modelRouter: router, maxConcurrency: 1 },
    )

    await rt.execute(
      makeWorkspace("ws-router-1", [
        { id: "t1", role: "general", desc: "first task" },
        { id: "t2", role: "general", desc: "second task", dependsOn: ["t1"] },
      ]),
    )

    // One selectModel call per planned task, all at run start BEFORE the
    // first task executed; the second task's override still carries the
    // run-start verdict even though the "registry" changed mid-run.
    expect(router.selectModelCalls).toBe(2)
    expect(agents[0].capturedOverride).toEqual({ provider: "r1", model: "m1" })
    expect(agents[1].capturedOverride).toEqual({ provider: "r1", model: "m1" })
  })

  it("providerBundleFreeze: false restores per-task re-selection", async () => {
    const selector = new ShiftingSelector()
    const agents: StubAgent[] = []
    const rt = new AgentRuntime(
      (_role, preferredProvider) => {
        const agent = new StubAgent()
        agent.capturedPreferredProvider = preferredProvider
        agents.push(agent)
        return agent
      },
      makeSink(),
      {
        modelSelector: selector as unknown as import("../src/runtime.js").ModelSelectorPort,
        providerBundleFreeze: false,
        maxConcurrency: 1,
      },
    )

    await rt.execute(
      makeWorkspace("ws-nofreeze-1", [
        { id: "t1", role: "general", desc: "first task" },
        { id: "t2", role: "general", desc: "second task", dependsOn: ["t1"] },
      ]),
    )

    // Legacy behaviour: every task re-selects and observes the shift.
    expect(selector.calls).toBe(2)
    expect(agents[0].capturedPreferredProvider).toBe("p1")
    expect(agents[1].capturedPreferredProvider).toBe("p2")
  })
})
