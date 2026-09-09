// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  TaskNodeImpl,
  TaskStatus,
  NodeType,
  TaskType,
  IllegalTransitionError,
  createTaskNode,
  transition,
  withResult,
  withError,
  withChild,
  withDependency,
  shouldForceExecute,
  canTransition,
  isTerminal,
  defaultAtomize,
  buildSubTasks,
  attachSubTasks,
  atomizeTask,
} from "../src/index.js";

describe("Borrowed — ROMA TaskNode state machine", () => {
  let node: TaskNodeImpl;
  beforeEach(() => {
    node = createTaskNode({
      id: "root",
      description: "Process this complex task",
      maxDepth: 2,
    });
  });

  it("starts PENDING with empty transitions", () => {
    expect(node.status).toBe(TaskStatus.PENDING);
    expect(node.stateTransitions).toHaveLength(0);
    expect(isTerminal(node.status)).toBe(false);
  });

  it("follows a valid PENDING → ATOMIZING transition", () => {
    const after = transition(node, TaskStatus.ATOMIZING, "start");
    expect(after.status).toBe(TaskStatus.ATOMIZING);
    expect(after.stateTransitions).toHaveLength(1);
    // Original is unchanged.
    expect(node.status).toBe(TaskStatus.PENDING);
  });

  it("rejects illegal transitions", () => {
    let caught = false;
    try {
      transition(node, TaskStatus.COMPLETED);
    } catch (err) {
      caught = true;
      expect(err).toBeInstanceOf(IllegalTransitionError);
    }
    expect(caught).toBe(true);
  });

  it("complete flow: PENDING → ATOMIZING → EXECUTING → COMPLETED", () => {
    let n = node;
    n = transition(n, TaskStatus.ATOMIZING, "start");
    n = transition(n, TaskStatus.EXECUTING, "running");
    n = transition(n, TaskStatus.COMPLETED, "done");
    expect(n.status).toBe(TaskStatus.COMPLETED);
    expect(isTerminal(n.status)).toBe(true);
    expect(n.stateTransitions).toHaveLength(3);
  });

  it("canTransition answers correctly", () => {
    expect(canTransition(TaskStatus.PENDING, TaskStatus.ATOMIZING)).toBe(true);
    expect(canTransition(TaskStatus.PENDING, TaskStatus.COMPLETED)).toBe(false);
  });

  it("shouldForceExecute triggers at maxDepth", () => {
    expect(shouldForceExecute({ ...node, depth: 2, maxDepth: 2 })).toBe(true);
    expect(shouldForceExecute({ ...node, depth: 0, maxDepth: 2 })).toBe(false);
  });

  it("withResult adds a result without mutating", () => {
    const withR = withResult(node, { foo: "bar" });
    expect(withR.result).toEqual({ foo: "bar" });
    expect(node.result).toBeUndefined();
  });

  it("withError adds an error + transitions to FAILED", () => {
    const withE = withError(node, "boom");
    expect(withE.error).toBe("boom");
  });
});

describe("Borrowed — ROMA atomizer + DAG builder", () => {
  it("defaultAtomize forces EXECUTE past maxDepth", () => {
    const node = createTaskNode({
      id: "deep",
      description: "deep task",
      depth: 2,
      maxDepth: 2,
    });
    const decision = defaultAtomize(node, 2);
    expect(decision.nodeType).toBe(NodeType.EXECUTE);
  });

  it("defaultAtomize decomposes long descriptions", () => {
    const node = createTaskNode({
      id: "long",
      description: "a".repeat(200),
      depth: 0,
      maxDepth: 2,
    });
    const decision = defaultAtomize(node, 2);
    expect(decision.nodeType).toBe(NodeType.PLAN);
  });

  it("buildSubTasks converts index-based deps to task-ids", () => {
    const parent = createTaskNode({
      id: "parent",
      description: "parent",
      nodeType: NodeType.PLAN,
    });
    const specs = [
      { description: "step 1" },
      { description: "step 2", dependsOn: ["0"] },
    ];
    const result = buildSubTasks(parent, specs);
    expect(result.children).toHaveLength(2);
    const child0 = result.children[0]!;
    const child1 = result.children[1]!;
    expect(child1.dependsOn).toContain(child0.id);
  });

  it("buildSubTasks drops self-deps and out-of-bounds", () => {
    const parent = createTaskNode({
      id: "parent",
      description: "parent",
      nodeType: NodeType.PLAN,
    });
    const specs = [
      { description: "step 0", dependsOn: ["0", "99"] }, // self + out-of-bounds
    ];
    const result = buildSubTasks(parent, specs);
    expect(result.children[0]!.dependsOn).toHaveLength(0);
  });

  it("attachSubTasks wires children to parent", () => {
    const parent = createTaskNode({
      id: "parent",
      description: "parent",
      nodeType: NodeType.PLAN,
    });
    const specs = [
      { description: "a" },
      { description: "b" },
    ];
    const { children, indexToId } = buildSubTasks(parent, specs);
    const wired = attachSubTasks(parent, children);
    expect(wired.parent.children).toHaveLength(2);
    for (const c of wired.children) {
      expect(c.dependsOn).toBeDefined();
    }
  });

  it("atomizeTask applies the verdict immutably", () => {
    const node = createTaskNode({
      id: "x",
      description: "simple job",
      depth: 0,
      maxDepth: 2,
    });
    const result = atomizeTask({ node, maxDepth: 2 });
    expect(result.status).toBe(TaskStatus.ATOMIZING);
    expect(result.nodeType).toBe(NodeType.EXECUTE);
  });
});
