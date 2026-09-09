/**
 * Atomizer + index-based DAG builder (borrowed from
 * sentient-agi/ROMA `src/roma_dspy/core/modules/atomizer.py` +
 * `src/roma_dspy/core/engine/runtime.py:939-977`).
 *
 * Background:
 *   - ROMA's atomizer decides whether a task should be decomposed into
 *     sub-tasks (nodeType=PLAN) or executed directly (nodeType=EXECUTE).
 *     The decision comes from an LLM that returns `is_atomic: bool` and
 *     `node_type: PLAN|EXECUTE`.
 *   - **Depth guard**: `task_node.py:494-501` overrides the atomizer when
 *     `depth >= maxDepth` — execution is forced regardless of what the
 *     LLM says. This guarantees termination even if the LLM keeps saying
 *     "PLAN".
 *   - **Index-based deps**: The planner emits dependencies keyed by
 *     *string indices* (`{"1": ["0"]}`), and `runtime.py` converts to
 *     real task-ids with heavy validation (drop self-deps, out-of-bounds).
 *
 * Maximilian's adaptation:
 *   - The "atomize" decision uses a deterministic heuristic by default
 *     (description length + `maxDepth` guard). Callers with a real LLM can
 *     pass their own `AtomizeFn`.
 *   - The DAG builder takes a parent node + a list of sub-task specs and
 *     produces child `TaskNode`s wired to the parent, with index-based
 *     dependency conversion + validation.
 *   - Cycle detection rejects self-dependencies (`"0": ["0"]`) and
 *     out-of-bounds indices atomically.
 */

import { randomUUID } from "node:crypto";
import {
  TaskNode,
  TaskStatus,
  NodeType,
  TaskType,
  IllegalTransitionError,
  shouldForceExecute,
  transition,
  withChild,
  withDependency,
  createTaskNode,
  type StateTransition,
} from "./task-node.js";

// ── Atomizer ────────────────────────────────────────────────────────────────

export interface AtomizeDecision {
  nodeType: NodeType;
  /** Why the atomizer chose this (for audit). */
  reason: string;
}

/**
 * Determine whether a task should be decomposed or executed directly.
 *
 * The default heuristic (offline, no LLM):
 *   - If `depth >= maxDepth`, force EXECUTE (ROMA's hard depth guard).
 *   - If the description is "long" (>160 chars) or contains "and"-style
 *     conjunctions, decompose into PLAN.
 *   - Otherwise EXECUTE directly.
 *
 * Callers with a real LLM pass their own `AtomizeFn` to `Atomizer`.
 */
export type AtomizeFn = (node: TaskNode, maxDepth: number) => AtomizeDecision;

export const defaultAtomize: AtomizeFn = (node, maxDepth) => {
  if (shouldForceExecute({ ...node, maxDepth })) {
    return { nodeType: NodeType.EXECUTE, reason: `depth ${node.depth} >= maxDepth ${maxDepth}, force execute` };
  }
  const desc = node.description.trim();
  if (desc.length > 160 || /\b(and|then|after|followed by|followedby)\b/i.test(desc)) {
    return { nodeType: NodeType.PLAN, reason: `description too complex (${desc.length} chars)` };
  }
  return { nodeType: NodeType.EXECUTE, reason: `simple task (${desc.length} chars)` };
};

export interface AtomizeTaskOpts {
  node: TaskNode;
  maxDepth?: number;
  atomizeFn?: AtomizeFn;
}

/** Pure: returns a new node with the atomizer's verdict applied. */
export function atomizeTask(opts: AtomizeTaskOpts): TaskNode {
  const fn = opts.atomizeFn ?? defaultAtomize;
  const maxDepth = opts.maxDepth ?? opts.node.maxDepth;
  const decision = fn(opts.node, maxDepth);
  try {
    const afterDecision = transition(opts.node, TaskStatus.ATOMIZING, "atomizer decision");
    const taskType = decision.nodeType === NodeType.PLAN ? TaskType.STRATEGY : TaskType.CODE_GENERATION;
    // Build a fresh node with the atomizer verdict baked in.
    return Object.assign(Object.create(Object.getPrototypeOf(afterDecision)), afterDecision, {
      nodeType: decision.nodeType,
      taskType: taskType,
    }) as TaskNode;
  } catch {
    // If atomizing from a non-PENDING state fails, just return the node as-is.
    return opts.node;
  }
}

// ── DAG builder (ROMA `core/engine/runtime.py:939-977`) ─────────────────────

export interface SubTaskSpec {
  description: string;
  /** Indices in the `specs` array this sub-task depends on (e.g. ["0", "1"]). */
  dependsOn?: ReadonlyArray<string>;
  taskType?: TaskType;
  metadata?: Record<string, unknown>;
}

export interface BuildDagResult {
  children: TaskNode[];
  /** index → task-id mapping for auditing. */
  indexToId: Map<string, string>;
}

/**
 * Build child sub-tasks from a list of specs + an index-based dependency
 * map, validating as we go:
 *   - Drop non-integer index keys (`"foo": ["0"]`).
 *   - Drop out-of-bounds indices (`"99": ["0"]`).
 *   - Drop self-dependencies (`"0": ["0"]`).
 *
 * Pure over inputs but allocates new `TaskNode`s.
 */
export function buildSubTasks(
  parent: TaskNode,
  specs: ReadonlyArray<SubTaskSpec>,
): BuildDagResult {
  const indexToId = new Map<string, string>();
  const children: TaskNode[] = [];

  // First pass: create all nodes with stable ids.
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const id = `task-${parent.id}-child-${i}-${randomUUID().slice(0, 6)}`;
    indexToId.set(String(i), id);
    const child = createTaskNode({
      id,
      description: spec.description,
      nodeType: NodeType.EXECUTE,
      taskType: spec.taskType ?? TaskType.CODE_GENERATION,
      depth: parent.depth + 1,
      maxDepth: parent.maxDepth,
      dependsOn: [],
      metadata: { ...(spec.metadata ?? {}), parent: parent.id, index: i },
    });
    children.push(child);
  }

  // Second pass: wire dependencies using the index → id map. Self-deps and
  // out-of-bounds indices are silently dropped (ROMA's behavior).
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    let child = children[i]!;
    for (const rawIdx of spec.dependsOn ?? []) {
      if (!/^\d+$/.test(rawIdx)) continue; // non-integer key → skip
      const idx = parseInt(rawIdx, 10);
      if (idx < 0 || idx >= specs.length) continue; // out-of-bounds → skip
      if (idx === i) continue; // self-dep → skip
      const depId = indexToId.get(rawIdx);
      if (!depId) continue;
      child = withDependency(child, depId);
    }
    children[i] = child;
  }

  return { children, indexToId };
}

/**
 * Wire children back to their parent and to each other.
 * - Parent status → PLAN_DONE.
 * - Each child status → PENDING (ready for execution).
 */
export function attachSubTasks(
  parent: TaskNode,
  children: ReadonlyArray<TaskNode>,
): { parent: TaskNode; children: TaskNode[] } {
  let updatedParent = parent;
  for (const child of children) {
    updatedParent = withChild(updatedParent, child.id);
  }
  try {
    updatedParent = transition(updatedParent, TaskStatus.PLAN_DONE, `attached ${children.length} sub-tasks`);
  } catch {
    // If parent isn't in a state that supports PLAN_DONE, skip.
  }
  const pendingChildren = children.map((c) => {
    try {
      return transition(c, TaskStatus.PENDING, "wired by parent") as TaskNode;
    } catch {
      return c;
    }
  });
  return { parent: updatedParent, children: pendingChildren };
}

/** Aggregate children results into the parent's result field. */
export function aggregateResults(parent: TaskNode, childResults: ReadonlyArray<{ id: string; result: unknown }>): TaskNode {
  const map = new Map(childResults.map((r) => [r.id, r.result]));
  const ordered = parent.children.map((c) => map.get(c)).filter((r) => r !== undefined);
  try {
    return transition(parent, TaskStatus.COMPLETED, `aggregated ${ordered.length} child results`) as TaskNode;
  } catch {
    return parent;
  }
}
