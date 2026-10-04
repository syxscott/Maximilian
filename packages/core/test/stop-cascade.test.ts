// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Stop cascade — planning, partial-result reclaim, and the runtime wiring:
 * abort() must leave every task terminal, stopCascade() must reach every
 * derived workspace and report what it stopped and reclaimed.
 */
import { describe, expect, it } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import { Agent } from "../src/agent.js"
import {
  buildCascadeStopReport,
  cancelNonTerminalTasks,
  planStopCascade,
  reclaimPartialResults,
  settleWithin,
  type StopCascadeNode,
} from "../src/stop-cascade.js"
import type { AgentContext } from "../src/agent.js"
import type { Plan, Result, Task, Workspace } from "../src/types.js"

// ── Pure model ──────────────────────────────────────────────────────────────

describe("planStopCascade", () => {
  it("orders units parent-before-child with depth", () => {
    const nodes: StopCascadeNode[] = [
      { id: "root", parentId: null },
      { id: "a", parentId: "root" },
      { id: "b", parentId: "root" },
      { id: "a1", parentId: "a" },
    ]
    expect(planStopCascade(nodes, "root")).toEqual([
      { id: "root", parentId: null, depth: 0 },
      { id: "a", parentId: "root", depth: 1 },
      { id: "b", parentId: "root", depth: 1 },
      { id: "a1", parentId: "a", depth: 2 },
    ])
  })

  it("plans an unknown root instead of silently stopping nothing", () => {
    expect(planStopCascade([], "ghost")).toEqual([{ id: "ghost", parentId: null, depth: 0 }])
  })

  it("does not hang on cycles and stops each unit once", () => {
    const nodes: StopCascadeNode[] = [
      { id: "root", parentId: null },
      { id: "a", parentId: "root" },
      { id: "b", parentId: "a" },
      { id: "root", parentId: "b" }, // cycle back to the root
    ]
    const steps = planStopCascade(nodes, "root")
    const ids = steps.map((s) => s.id).sort()
    expect(new Set(ids)).toEqual(new Set(["root", "a", "b"]))
    expect(steps).toHaveLength(3)
  })
})

describe("reclaimPartialResults", () => {
  it("keeps plan order and skips units with nothing to reclaim", () => {
    const steps = planStopCascade(
      [
        { id: "root", parentId: null },
        { id: "a", parentId: "root" },
        { id: "empty", parentId: "root" },
      ],
      "root",
    )
    const snapshots = new Map<string, import("../src/stop-cascade.js").PartialResultSnapshot>([
      ["root", { id: "root", resultCount: 2, lastOutputPreview: "half done" }],
      ["empty", { id: "empty", resultCount: 0 }],
    ])
    expect(reclaimPartialResults(steps, snapshots)).toEqual([
      { id: "root", resultCount: 2, lastOutputPreview: "half done" },
    ])
  })
})

describe("buildCascadeStopReport", () => {
  it("requires an outcome for every planned step", () => {
    const steps = planStopCascade([{ id: "root", parentId: null }], "root")
    expect(() =>
      buildCascadeStopReport({
        rootId: "root",
        reason: "user stop",
        requestedAtMs: 1,
        steps,
        outcomes: [],
        reclaimed: [],
      }),
    ).toThrow(/missing outcome/)
  })

  it("lists timed-out units", () => {
    const report = buildCascadeStopReport({
      rootId: "root",
      reason: "user stop",
      requestedAtMs: 1,
      steps: [
        { id: "root", parentId: null, depth: 0 },
        { id: "a", parentId: "root", depth: 1 },
      ],
      outcomes: [
        { id: "root", status: "stopped" },
        { id: "a", status: "timeout" },
      ],
      reclaimed: [],
    })
    expect(report.timedOut).toEqual(["a"])
  })
})

describe("cancelNonTerminalTasks", () => {
  it("cancels only pending/running tasks, idempotently", () => {
    const task = (id: string, status: Task["status"]): Task => ({
      id,
      agentRole: "general",
      description: id,
      status,
      dependsOn: [],
    })
    const tasks = [
      task("p", "pending"),
      task("r", "running"),
      task("done", "completed"),
      task("fail", "failed"),
    ]
    const cancelled = cancelNonTerminalTasks(tasks, "stopped: user stop", "2026-01-01T00:00:00Z")
    expect(cancelled.map((t) => t.id)).toEqual(["p", "r"])
    expect(tasks.map((t) => t.status)).toEqual(["cancelled", "cancelled", "completed", "failed"])
    expect(tasks[0].error).toBe("stopped: user stop")
    expect(tasks[0].completedAt).toBe("2026-01-01T00:00:00Z")
    // Second pass: everything terminal, nothing left to cancel.
    expect(cancelNonTerminalTasks(tasks, "again", "2026-01-02T00:00:00Z")).toEqual([])
  })
})

describe("settleWithin", () => {
  it("reports settlement and timeout without rejecting", async () => {
    await expect(settleWithin(Promise.resolve(7), 100)).resolves.toEqual({
      settled: true,
      value: 7,
    })
    await expect(settleWithin(Promise.reject(new Error("boom")), 100)).resolves.toEqual({
      settled: true,
      value: undefined,
    })
    const never = new Promise<never>(() => {})
    await expect(settleWithin(never, 10)).resolves.toEqual({ settled: false })
  })
})

// ── Runtime wiring ──────────────────────────────────────────────────────────

class BlockingAgent extends Agent {
  readonly manifest = {
    role: "general" as const,
    systemPrompt: "stub",
    name: "blocking",
    description: "blocks until aborted",
    capabilities: [],
    model: { provider: "stub", name: "stub-1" },
  }
  constructor() {
    super({
      id: "blocking",
      name: "blocking",
      defaultModel: "stub-1",
      isConfigured: () => true,
    } as never)
  }
  async execute(_task: Task, ctx: AgentContext): Promise<Result> {
    await new Promise<void>((_, reject) => {
      if (ctx.signal?.aborted) {
        reject(new Error("workspace aborted"))
        return
      }
      ctx.signal?.addEventListener("abort", () => reject(new Error("workspace aborted")), {
        once: true,
      })
    })
    throw new Error("unreachable")
  }
}

class InstantAgent extends Agent {
  readonly manifest = {
    role: "general" as const,
    systemPrompt: "stub",
    name: "instant",
    description: "finishes immediately",
    capabilities: [],
    model: { provider: "stub", name: "stub-1" },
  }
  constructor(private readonly outputs: string[]) {
    super({
      id: "instant",
      name: "instant",
      defaultModel: "stub-1",
      isConfigured: () => true,
    } as never)
  }
  async execute(task: Task): Promise<Result> {
    return {
      id: `r-${task.id}`,
      taskId: task.id,
      agentRole: task.agentRole,
      output: this.outputs[0] ?? "ok",
      metadata: { usage: { input: 1, output: 1 } },
    }
  }
}

interface Harness {
  runtime: AgentRuntime
  saved: Map<string, Workspace>
}

function makeHarness(agent: Agent): Harness {
  const saved = new Map<string, Workspace>()
  const runtime = new AgentRuntime(() => agent, {
    async saveWorkspace(w: Workspace) {
      saved.set(w.id, structuredClone(w))
    },
    async loadWorkspace(id: string) {
      return saved.get(id)
    },
  })
  return { runtime, saved }
}

function makeWorkspace(
  id: string,
  taskIds: string[],
  deps: Record<string, string[]> = {},
): Workspace {
  const tasks: Task[] = taskIds.map((id2) => ({
    id: id2,
    agentRole: "general",
    description: `task ${id2}`,
    dependsOn: deps[id2] ?? [],
    status: "pending",
  }))
  const plan: Plan = {
    id: `plan-${id}`,
    workspaceId: id,
    userRequest: "x",
    rationale: "",
    tasks,
    createdAt: new Date().toISOString(),
  }
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

describe("AgentRuntime abort — task-level cancellation", () => {
  it("marks a stopped workspace failed, cancels pending tasks, keeps partial results", async () => {
    const { runtime, saved } = makeHarness(new BlockingAgent())
    // t-pending depends on t-running, so it stays pending while t-running blocks.
    const workspace = makeWorkspace("ws-abort", ["t-running", "t-pending"], {
      "t-pending": ["t-running"],
    })
    const skipped: Array<{ taskId: string; reason: string }> = []
    runtime.on((event) => {
      if (event.type === "task-skipped")
        skipped.push({ taskId: event.taskId, reason: event.reason })
    })

    const run = runtime.execute(workspace)
    await new Promise((resolve) => setTimeout(resolve, 20))
    runtime.abort("ws-abort", "user stop")
    const stopped = await run

    expect(stopped.status).toBe("failed")
    expect(stopped.error).toBe("user stop")
    const statuses = Object.fromEntries(stopped.plan!.tasks.map((t) => [t.id, t.status]))
    expect(statuses["t-running"]).toBe("failed") // rejected through the abort race
    expect(statuses["t-pending"]).toBe("cancelled") // never started — still terminal
    expect(saved.get("ws-abort")?.plan!.tasks.every((t) => t.status !== "pending")).toBe(true)
    expect(skipped.some((s) => s.taskId === "t-pending" && s.reason === "user stop")).toBe(true)
  })
})

describe("AgentRuntime stopCascade", () => {
  it("stops the root, cascades to derived workspaces, cancels stale tasks, reclaims results", async () => {
    // Root is mid-run (blocking agent) with a partial result already banked;
    // children are derived but idle — the cascade must still terminate their
    // stale pending tasks.
    const { runtime, saved } = makeHarness(new BlockingAgent())
    runtime.registerDerivedWorkspace("root", "child-a")
    runtime.registerDerivedWorkspace("child-a", "grandchild")
    // An unrelated workspace must not be touched.
    runtime.registerDerivedWorkspace("unrelated", "child-a")

    const idleChild = makeWorkspace("child-a", ["c1", "c2"])
    const idleGrandchild = makeWorkspace("grandchild", ["g1"])
    saved.set("child-a", structuredClone(idleChild))
    saved.set("grandchild", structuredClone(idleGrandchild))

    const root = makeWorkspace("root", ["r1"])
    root.results.push({
      id: "r-partial",
      taskId: "seed",
      agentRole: "general",
      agentId: "seed",
      output: "partial root output",
      metadata: {},
      createdAt: new Date().toISOString(),
    })
    const events: Array<{ type: string }> = []
    runtime.on((event) => events.push({ type: event.type }))

    const run = runtime.execute(root)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const report = await runtime.stopCascade("root", "user stop", { settlementTimeoutMs: 2_000 })
    const stoppedRoot = await run

    expect(report.rootId).toBe("root")
    expect(report.steps.map((s) => s.id)).toEqual(["root", "child-a", "grandchild"])
    expect(report.outcomes.map((o) => o.status)).toEqual([
      "stopped",
      "already-terminal",
      "already-terminal",
    ])
    expect(report.timedOut).toEqual([])
    // Root's banked partial result was reclaimed, children had none.
    expect(report.reclaimed).toEqual([
      { id: "root", resultCount: 1, lastOutputPreview: "partial root output" },
    ])

    // Idle children's stale pending tasks are cancelled in the sink.
    const savedChild = saved.get("child-a")!
    expect(savedChild.plan!.tasks.map((t) => t.status)).toEqual(["cancelled", "cancelled"])
    expect(savedChild.plan!.tasks[0].error).toBe("cascade stop: user stop")
    expect(saved.get("grandchild")!.plan!.tasks[0].status).toBe("cancelled")
    // The root settled through the executor: all tasks terminal, not pending.
    expect(stoppedRoot.plan!.tasks.every((t) => t.status !== "pending")).toBe(true)

    expect(events.filter((e) => e.type === "cascade-stopped")).toHaveLength(1)
  })

  it("stops derived workspaces that are running too, in parent-first order", async () => {
    const blocking = new BlockingAgent()
    const { runtime } = makeHarness(blocking)
    runtime.registerDerivedWorkspace("parent", "child")
    const parent = makeWorkspace("parent", ["p1"])
    const child = makeWorkspace("child", ["c1"])

    const parentRun = runtime.execute(parent)
    // Give the parent's wave a beat, then start the child run.
    await new Promise((resolve) => setTimeout(resolve, 10))
    const childRun = runtime.execute(child)
    await new Promise((resolve) => setTimeout(resolve, 10))

    const report = await runtime.stopCascade("parent", "shutdown", { settlementTimeoutMs: 2_000 })
    await Promise.all([parentRun, childRun])

    expect(report.outcomes).toEqual([
      { id: "parent", status: "stopped" },
      { id: "child", status: "stopped" },
    ])
    expect(report.reclaimed).toEqual([])
  })

  it("reports a unit that never settles as timed out and leaves its record alone", async () => {
    const { runtime, saved } = makeHarness(new InstantAgent(["ok"]))
    const neverSettles = new Promise<Workspace>(() => {})
    // Simulate a workspace whose executor ignores the abort signal.
    saved.set("root", makeWorkspace("root", ["t1"]))
    runtime.registerDerivedWorkspace("root", "ghost")
    const intercepted = runtime as unknown as {
      workspaceRuns: Map<string, Promise<Workspace>>
      runningWorkspaces: Map<string, AbortController>
    }
    intercepted.workspaceRuns.set("root", neverSettles)
    intercepted.runningWorkspaces.set("root", new AbortController())

    const report = await runtime.stopCascade("root", "user stop", { settlementTimeoutMs: 20 })
    expect(report.timedOut).toEqual(["root"])
    // Timeout → the executor still owns the record: stale task untouched.
    expect(saved.get("root")!.plan!.tasks[0].status).toBe("pending")
  })
})
