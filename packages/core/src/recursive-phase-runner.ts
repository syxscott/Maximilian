/**
 * RecursivePhaseRunner — ROMA-style recursive decomposition engine that
 * wraps the existing linear PhaseRunner (borrowed from
 * sentient-agi/ROMA `core/engine/solve.py:944-1005` + `core/modules/atomizer.py` +
 * `core/engine/runtime.py:1037-1047`).
 *
 * Background: ROMA's recursive engine decomposes a task into a nested DAG of
 * sub-tasks via an Atomizer decision at each level, then recurses into PLAN
 * sub-tasks and executes EXECUTE sub-tasks, aggregating results up the tree.
 * A hard depth guard guarantees termination regardless of what the atomizer
 * returns at deep levels.
 *
 * Maximilian's adaptation:
 *   - PLAN sub-tasks create child TaskNodes via `buildSubTasks` and recurse.
 *   - EXECUTE sub-tasks delegate to a single-phase linear `PhaseRunner`
 *     (reusing all existing phase machinery including gates, timeouts,
 *     abort controllers).
 *   - Aggregation is deterministic string concatenation of child results
 *     (MVP). A later phase can swap in LLM-driven aggregation.
 *
 * The linear `PhaseRunner` is still exported and used directly for fully
 * linear workloads. Opt-in to recursive via:
 *   const runner = new RecursivePhaseRunner({ workspaceId, buildPhase, eventBus });
 *   await runner.run(rootTaskNode);
 */

import { PhaseRunner } from "./phase.js";
import { EventBus } from "./event-bus.js";
import type { Phase, PhaseContext, PhaseResult } from "./phase.js";

export type { Phase, PhaseContext, PhaseResult };

import {
  TaskNode,
  TaskNodeImpl,
  TaskStatus,
  NodeType,
  createTaskNode,
  shouldForceExecute,
  transition,
  withResult,
} from "./task-node.js";
export { TaskNodeImpl, TaskStatus, NodeType } from "./task-node.js";
export type { TaskNode } from "./task-node.js";

import {
  defaultAtomize,
  buildSubTasks,
  attachSubTasks,
  type AtomizeFn,
  type SubTaskSpec,
} from "./atomizer.js";

// ── Event type ──────────────────────────────────────────────────────────────

export type RecursiveRunnerEvent =
  | { type: "task:start"; workspaceId: string; taskId: string; depth: number }
  | { type: "task:decomposed"; workspaceId: string; taskId: string; childCount: number }
  | { type: "task:executed"; workspaceId: string; taskId: string }
  | { type: "task:failed"; workspaceId: string; taskId: string; error: string }
  | { type: "task:completed"; workspaceId: string; taskId: string }
  | { type: "runner:complete"; workspaceId: string; stats: RecursiveStats };

// ── Public interface ────────────────────────────────────────────────────────

export interface RecursivePhaseDeps<S> {
  workspaceId: string;
  buildPhase: (node: TaskNode) => Phase<S, unknown>;
  atomizeFn?: AtomizeFn;
  maxDepth?: number;
  eventBus?: EventBus<RecursiveRunnerEvent>;
  buildSpecs?: (node: TaskNode) => SubTaskSpec[];
  aggregate?: (parent: TaskNode, childResults: ReadonlyArray<{ id: string; result: unknown }>) => unknown;
}

export interface RecursiveStats {
  totalTasks: number;
  decomposed: number;
  executed: number;
  failed: number;
  maxDepth: number;
}

export interface RecursiveRunResult {
  root: TaskNode;
  results: Map<string, PhaseResult>;
  stats: RecursiveStats;
}

// ── Runner ──────────────────────────────────────────────────────────────────

export class RecursivePhaseRunner<S = unknown> {
  private readonly workspaceId: string;
  private readonly buildPhase: (node: TaskNode) => Phase<S, unknown>;
  private readonly atomizeFn: AtomizeFn;
  private readonly maxDepth: number;
  private readonly eventBus: EventBus<RecursiveRunnerEvent>;
  private readonly buildSpecs: (node: TaskNode) => SubTaskSpec[];
  private readonly aggregate: (parent: TaskNode, childResults: ReadonlyArray<{ id: string; result: unknown }>) => unknown;

  private results = new Map<string, PhaseResult>();
  private stats: RecursiveStats = { totalTasks: 0, decomposed: 0, executed: 0, failed: 0, maxDepth: 0 };

  constructor(deps: RecursivePhaseDeps<S>) {
    this.workspaceId = deps.workspaceId;
    this.buildPhase = deps.buildPhase;
    this.atomizeFn = deps.atomizeFn ?? defaultAtomize;
    this.maxDepth = deps.maxDepth ?? 2;
    this.eventBus = deps.eventBus ?? new EventBus<RecursiveRunnerEvent>();
    this.buildSpecs = deps.buildSpecs ?? defaultBuildSpecs;
    this.aggregate = deps.aggregate ?? defaultAggregate;
  }

  async run(root: TaskNode): Promise<RecursiveRunResult> {
    const started = await this.recurse(root, 0);
    return { root: started, results: new Map(this.results), stats: { ...this.stats } };
  }

  private async recurse(node: TaskNode, depth: number): Promise<TaskNode> {
    this.stats.totalTasks++;
    this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);
    this.eventBus.publish({ type: "task:start", workspaceId: this.workspaceId, taskId: node.id, depth });

    const atomized = this.applyAtomize(node);
    if (atomized.nodeType === NodeType.EXECUTE) {
      this.stats.executed++;
      return await this.executeLeaf(atomized, depth);
    }

    this.stats.decomposed++;
    return await this.executePlan(atomized, depth);
  }

  private applyAtomize(node: TaskNode): TaskNode {
    // Depth guard ALWAYS takes precedence over the atomizer's vote —
    // this is ROMA's hard termination guarantee.
    const forced = node.depth >= this.maxDepth;
    const decision = forced
      ? { nodeType: NodeType.EXECUTE as const, reason: `depth ${node.depth} >= maxDepth ${this.maxDepth}` }
      : this.atomizeFn(node, this.maxDepth);
    try {
      const trans = transition(node, TaskStatus.ATOMIZING as any, `atomizer: ${decision.reason}`);
      return Object.assign(Object.create(Object.getPrototypeOf(trans)) as TaskNode, trans, {
        nodeType: decision.nodeType,
      });
    } catch {
      return node;
    }
  }

  private async executeLeaf(node: TaskNode, depth: number): Promise<TaskNode> {
    const phase = this.buildPhase(node);
    const ctx: PhaseContext<S> = {
      workspaceId: this.workspaceId,
      phaseId: node.id,
      role: node.nodeType,
      state: (node.input?.state as S) ?? ({} as S),
      artifacts: [],
      messages: [],
      startTime: new Date(),
      signal: new AbortController().signal,
    };

    try {
      const lineaBus = new EventBus<any>();
      const runner = new PhaseRunner<S>([phase], ctx, lineaBus);
      const results = await runner.run();
      const last = results[results.length - 1];
      const result: PhaseResult<any, any> = {
        phaseId: node.id,
        verdict: last?.verdict ?? "pass",
        output: last?.output,
        durationMs: last?.durationMs ?? 0,
        finalState: last?.finalState ?? ctx.state,
        artifacts: last?.artifacts ?? [],
        messages: last?.messages ?? [],
      };
      this.results.set(node.id, result);
      this.eventBus.publish({ type: "task:executed", workspaceId: this.workspaceId, taskId: node.id });
      return withResult(node, last?.output);
    } catch (err) {
      this.stats.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      this.eventBus.publish({ type: "task:failed", workspaceId: this.workspaceId, taskId: node.id, error: msg });
      this.results.set(node.id, {
        phaseId: node.id,
        verdict: "fail",
        output: undefined,
        durationMs: 0,
        finalState: ctx.state,
        artifacts: [],
        messages: [],
        phaseError: msg,
      });
      return node;
    }
  }

  private async executePlan(node: TaskNode, depth: number): Promise<TaskNode> {
    const specs = this.buildSpecs(node);
    if (specs.length === 0) {
      return this.executeLeaf(node, depth);
    }

    const { children } = buildSubTasks(node, specs);
    const wired = attachSubTasks(node, children);
    this.eventBus.publish({ type: "task:decomposed", workspaceId: this.workspaceId, taskId: node.id, childCount: wired.children.length });

    const childResults: Array<{ id: string; result: unknown }> = [];
    for (const child of wired.children) {
      const done = await this.recurse(child, depth + 1);
      childResults.push({ id: done.id, result: done.result });
    }

    const agg = this.aggregate(wired.parent, childResults);
    const resultNode = withResult(wired.parent, agg);
    this.eventBus.publish({ type: "task:completed", workspaceId: this.workspaceId, taskId: node.id });
    return resultNode;
  }
}

// ── Defaults ─────────────────────────────────────────────────────────────────

function defaultBuildSpecs(node: TaskNode): SubTaskSpec[] {
  const sentences = node.description
    .split(/\.\s+|\.\n|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) {
    return [{ description: node.description, dependsOn: [] }];
  }
  return sentences.map((desc, i) => ({
    description: desc + (desc.endsWith(".") ? "" : "."),
    dependsOn: i > 0 ? [String(i - 1)] : [],
  }));
}

function defaultAggregate(
  _parent: TaskNode,
  childResults: ReadonlyArray<{ id: string; result: unknown }>,
): unknown {
  return childResults
    .map((r) => (r.result == null ? "" : typeof r.result === "string" ? r.result : JSON.stringify(r.result)))
    .filter((s) => s.length > 0)
    .join("\n\n");
}
