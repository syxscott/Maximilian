// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import { RecursivePhaseRunner, createTaskNode, NodeType, EventBus } from "../src/index.js";
import type { RecursiveRunnerEvent, Phase, PhaseContext } from "../src/index.js";

describe("Borrowed — RecursivePhaseRunner", () => {
  let events: RecursiveRunnerEvent[];
  let bus: EventBus<RecursiveRunnerEvent>;

  beforeEach(() => {
    events = [];
    bus = new EventBus<RecursiveRunnerEvent>();
    bus.subscribe((e) => events.push(e), { types: ["task:start", "task:decomposed", "task:executed", "task:failed"] });
  });

  function echoPhase(node: ReturnType<typeof createTaskNode>): Phase<any, string> {
    return {
      id: node.id,
      description: node.description,
      role: "test",
      run: async (_ctx: PhaseContext<any>) => {
        return `done: ${node.description}`;
      },
      gate: async () => "pass",
    };
  }

  it("executes a single EXECUTE node", async () => {
    const root = createTaskNode({ id: "root", description: "simple task", nodeType: NodeType.EXECUTE, maxDepth: 2 });
    const runner = new RecursivePhaseRunner({ workspaceId: "ws-1", buildPhase: echoPhase, eventBus: bus, maxDepth: 2 });
    const result = await runner.run(root);
    expect(result.stats.executed).toBe(1);
    expect(result.stats.decomposed).toBe(0);
    expect(result.root.result).toBe("done: simple task");
  });

  it("decomposes a PLAN node via custom atomizer and recurses", async () => {
    const root = createTaskNode({ id: "root", description: "complex task", maxDepth: 2 });
    const runner = new RecursivePhaseRunner({
      workspaceId: "ws-1",
      buildPhase: echoPhase,
      eventBus: bus,
      maxDepth: 2,
      atomizeFn: () => ({ nodeType: NodeType.PLAN, reason: "always-plan-test" }),
    });
    const result = await runner.run(root);
    // With always-PLAN atomizer + maxDepth=2: root (d=0) → PLAN, children
    // (d=1) → PLAN again (1 < 2), grandchildren (d=2) → forced EXECUTE.
    expect(result.stats.decomposed).toBeGreaterThanOrEqual(1);
    expect(result.stats.totalTasks).toBeGreaterThanOrEqual(3);
    expect(typeof result.root.result).toBe("string");
    expect((result.root.result as string).length).toBeGreaterThan(0);
  });

  it("respects maxDepth by forcing execution", async () => {
    const root = createTaskNode({ id: "root", description: "a".repeat(200), nodeType: NodeType.PLAN, depth: 2, maxDepth: 2 });
    const runner = new RecursivePhaseRunner({ workspaceId: "ws-1", buildPhase: echoPhase, eventBus: bus, maxDepth: 2 });
    const result = await runner.run(root);
    expect(result.stats.decomposed).toBe(0);
    expect(result.stats.executed).toBe(1);
  });

  it("counts failed leaf tasks", async () => {
    const root = createTaskNode({ id: "root", description: "will fail", nodeType: NodeType.EXECUTE, maxDepth: 2 });
    const runner = new RecursivePhaseRunner({
      workspaceId: "ws-1",
      buildPhase: () => ({
        id: "failing",
        description: "x",
        role: "test",
        run: async () => {
          throw new Error("boom");
        },
        gate: async () => "pass",
      }),
      eventBus: bus,
      maxDepth: 2,
    });
    const result = await runner.run(root);
    expect(result.stats.failed).toBe(1);
    expect(events.some((e) => e.type === "task:failed")).toBe(true);
  });

  it("aggregates child results deterministically", async () => {
    const root = createTaskNode({
      id: "root",
      description: "This is a very long and complex process that must be broken into three separate phases. First phase is setup. Second is execution. Third is verification.",
      maxDepth: 2,
    });
    const runner = new RecursivePhaseRunner({ workspaceId: "ws-1", buildPhase: echoPhase, eventBus: bus, maxDepth: 2 });
    const result = await runner.run(root);
    expect(result.stats.decomposed).toBeGreaterThanOrEqual(1);
    const aggregated = result.root.result as string;
    expect(aggregated).toContain("done:");
  });

  it("tracks maxDepth stat", async () => {
    const root = createTaskNode({ id: "root", description: "complex task", maxDepth: 4 });
    const runner = new RecursivePhaseRunner({
      workspaceId: "ws-1",
      buildPhase: echoPhase,
      eventBus: bus,
      maxDepth: 4,
      atomizeFn: () => ({ nodeType: NodeType.PLAN as const, reason: "test" }),
    });
    const result = await runner.run(root);
    expect(result.stats.maxDepth).toBeGreaterThanOrEqual(1);
  });

  it("emits start + executed events in order", async () => {
    const root = createTaskNode({ id: "root", description: "simple", nodeType: NodeType.EXECUTE, maxDepth: 2 });
    const runner = new RecursivePhaseRunner({ workspaceId: "ws-1", buildPhase: echoPhase, eventBus: bus, maxDepth: 2 });
    await runner.run(root);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("task:start");
    expect(events[1]!.type).toBe("task:executed");
  });
});
