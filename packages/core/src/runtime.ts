/**
 * Agent Runtime — the single entry point for executing agents.
 *
 * Responsibilities:
 *   - Accept a Plan + Agent factories
 *   - Resolve dependencies and execute independent tasks concurrently
 *   - Call Agent.receiveTask → execute → submitResult
 *   - Emit progress events for the UI
 *   - Persist results to a sink (Workspace)
 */

import { randomUUID } from "node:crypto";
import { Agent, type AgentContext } from "./agent.js";
import { withSpan, getLogger } from "@max/telemetry";

const log = getLogger("core:runtime");
import { runToolLoop, type ToolEnabledProvider } from "./tool-integration.js";
import type { ChatMessage } from "@max/providers";
import type {
  AgentRole,
  Plan,
  Result,
  Task,
  Workspace,
  WorkspaceStatus,
} from "./types.js";
import {
  NeverTermination,
  type TerminationCondition,
  type TerminationContext,
  type TerminationVerdict,
} from "./termination.js";
import {
  appendLedger,
  extendLedger,
  freshLedger,
  type Ledger,
  type LedgerEntry,
} from "./ledger.js";
import { matchSkillsForModel, renderSkillSummary } from "./skills.js";
import {
  ModelRouter,
  deriveTaskCharacteristics,
  type TaskCharacteristics,
} from "./model-router.js";
import {
  PermissionAuditLog,
  type PermissionAuditEntry,
  type PermissionAuditQuery,
} from "./permission-audit.js";

/**
 * Long-term memory store interface.
 * Mirrors AgentMemoryStore from @max/evolution but kept as an interface
 * to avoid hard coupling.
 */
export interface AgentMemoryStorePort {
  getMemory(role: AgentRole): { userFeedback: string[]; reviewSuggestions: string[]; commonErrors: string[]; goodExamples: string[]; totalEntries: number };
  recordSuccess(role: AgentRole, record: { taskId: string; reviewScore?: number }, snippet?: string): Promise<void>;
  recordFailure(role: AgentRole, record: { taskId: string; reviewScore?: number; error?: string }): Promise<void>;
  toPrelude(role: AgentRole): string;
}

/**
 * Model selector interface for dynamic provider selection.
 * Mirrors ModelSelector from @max/evolution.
 */
export interface ModelSelectorPort {
  select(role: AgentRole): { provider: string; model: string; score: number; reason: string } | null;
}

export type ApprovalDecision = "approve" | "reject";

export interface ApprovalResponse {
  decision: ApprovalDecision;
  comment?: string;
}

/** Result of resolving a parked approval. The API translates `reason` into
 *  a status code so the client can show a useful error instead of guessing
 *  from a generic 404. */
export type ApprovalResolveResult =
  | { ok: true }
  | { ok: false; reason: "unknown" | "comment_required" };

export type RuntimeEvent =
  | { type: "plan"; workspaceId: string; plan: Plan }
  | { type: "task-start"; workspaceId: string; taskId: string; agentRole: AgentRole }
  | { type: "task-complete"; workspaceId: string; taskId: string; result: Result }
  | { type: "task-failed"; workspaceId: string; taskId: string; error: string }
  | { type: "task-skipped"; workspaceId: string; taskId: string; reason: string }
  | { type: "tool-start"; workspaceId: string; taskId: string; toolName: string; input?: unknown }
  | { type: "tool-end"; workspaceId: string; taskId: string; toolName: string; ok: boolean; durationMs: number; error?: string }
  | { type: "ledger"; workspaceId: string; ledger: Ledger }
  | { type: "workspace-status"; workspaceId: string; status: WorkspaceStatus }
  | { type: "done"; workspaceId: string; workspace: Workspace }
  | {
      type: "permission-request"
      workspaceId: string
      taskId: string
      /** Stable id from `PermissionRequestError.requestId` — used by the
       *  API route to correlate the user response back to the parked task. */
      requestId: string
      tool: string
      target: string
    }
  | {
      type: "permission-resolved"
      workspaceId: string
      taskId: string
      requestId: string
      decision: "allow" | "deny"
    }
  | {
      type: "approval-request"
      workspaceId: string
      taskId: string
      requestId: string
      prompt: string
      requireComment: boolean
      reason?: string
    }
  | {
      type: "approval-resolved"
      workspaceId: string
      taskId: string
      requestId: string
      decision: ApprovalDecision
      comment?: string
    };

export type RuntimeListener = (event: RuntimeEvent) => void;

export type AgentFactory = (role: AgentRole, preferredProvider?: string) => Agent | undefined;

export interface RuntimeSink {
  saveWorkspace(workspace: Workspace): Promise<void>;
  loadWorkspace(id: string): Promise<Workspace | undefined>;
}

export interface RuntimeOptions {
  /** Max concurrent LLM calls (default: 5) */
  maxConcurrency?: number;
  /** Optional long-term memory store for injecting lessons learned into agents. */
  memoryStore?: AgentMemoryStorePort;
  /** Optional model selector for dynamic provider selection per role. */
  modelSelector?: ModelSelectorPort;
  /**
   * Optional termination condition. When the predicate fires, the runtime
   * stops accepting new tasks, marks remaining ones as skipped, and emits a
   * done event with the stop reason.
   */
  termination?: TerminationCondition;
  /**
   * Optional counter for messages emitted by the orchestrator. The runtime
   * increments it whenever a `task-complete` event fires, and the
   * termination condition can read the latest value via `ctx.messagesEmitted`.
   */
  onTaskComplete?: (info: { workspaceId: string; taskId: string; agentRole: AgentRole }) => void;
  /**
   * When true, the runtime will route any agent that opts in via
   * `getToolProvider()` through `runToolLoop`. The loop's tool-start /
   * tool-end events are emitted through the runtime's normal emit path so
   * the API SSE stream and the new ScopedBus mirror them like any other
   * RuntimeEvent. Agents without a tool provider are unaffected.
   */
  enableToolLoop?: boolean;
  /**
   * Optional skill source. When provided, the runtime matches each task's
   * description against the returned skills' `triggers` and injects the
   * matching skill summaries as a per-task prelude. Mirrors hermes-agent's
   * SKILL.md progressive disclosure: only the matched skills' descriptions
   * are loaded, not the full body.
   */
  getSkills?: () => Promise<Array<{
    frontmatter: { name: string; description?: string; triggers?: string[] }
    body: string
  }>>;
  /**
   * Optional ModelRouter for task-aware model selection. When provided, the
   * runtime derives TaskCharacteristics from each task and uses the router
   * to select the optimal provider/model, then calls
   * `agent.setModelOverride()` so the agent can prefer it.
   */
  modelRouter?: ModelRouter;
  /**
   * Max retries for a failed task (default: 0 = no retry).
   * When > 0, failed tasks are re-queued with an incremented retry counter
   * instead of immediately marking them as failed. Retries are bounded so
   * a permanently broken task doesn't loop forever.
   */
  maxTaskRetries?: number;
}

/**
 * Async-safe semaphore. Pushes, the current counter, and drain() are all
 * synchronous within a single tick — Node's single-threaded execution means
 * we cannot be interrupted between `if (current < max)` and `current++`,
 * so no separate lock is needed. A previous implementation serialized
 * acquire/release through a Promise chain, which deadlocked: a release
 * got queued behind pending acquires that were themselves waiting for a
 * release.
 */
class Semaphore {
  private current = 0;
  private waiting: Array<() => void> = [];

  constructor(private max: number) {}

  acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.current++;
        resolve();
      });
      this.drain();
    });
  }

  release(): void {
    // Defensive: an extra release() shouldn't drive current below zero.
    if (this.current > 0) this.current--;
    this.drain();
  }

  private drain(): void {
    while (this.waiting.length > 0 && this.current < this.max) {
      const next = this.waiting.shift()!;
      next();
    }
  }
}

export class AgentRuntime {
  private listeners = new Set<RuntimeListener>();
  private runningWorkspaces = new Map<string, AbortController>();
  private ledgers = new Map<string, Ledger>();
  private maxConcurrency: number;
  private memoryStore?: AgentMemoryStorePort;
  private modelSelector?: ModelSelectorPort;
  private modelRouter?: ModelRouter;
  private termination: TerminationCondition;
  private enableToolLoop: boolean;
  private getSkills?: RuntimeOptions["getSkills"];
  private maxTaskRetries: number;
  /**
   * Pending permission requests. When the tool loop hits a `PermissionRequestError`,
   * the loop calls `awaitPermission(requestId)` and parks until the user
   * (via the API) calls `resolvePermission(requestId, decision)`.
   * Keyed by the requestId minted in `@max/tools/with-permission`.
   */
  private permissionResolvers = new Map<string, { resolve: (decision: "allow" | "deny") => void; reject: (err: Error) => void; meta: { workspaceId: string; taskId: string; tool: string; target: string; promptedAt: string } }>();
  private approvalResolvers = new Map<string, { resolve: (response: ApprovalResponse) => void; reject: (err: Error) => void; meta: { workspaceId: string; taskId: string; prompt: string; requireComment: boolean; reason?: string; promptedAt: string } }>();
  private permissionAudit = new PermissionAuditLog();

  constructor(
    private factory: AgentFactory,
    private sink: RuntimeSink,
    options?: RuntimeOptions,
  ) {
    this.maxConcurrency = options?.maxConcurrency ?? 5;
    this.memoryStore = options?.memoryStore;
    this.modelSelector = options?.modelSelector;
    this.modelRouter = options?.modelRouter;
    this.termination = options?.termination ?? NeverTermination;
    this.enableToolLoop = options?.enableToolLoop ?? false;
    this.getSkills = options?.getSkills;
    this.maxTaskRetries = options?.maxTaskRetries ?? 0;
  }

  on(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Public emit — for non-Runtime code (e.g. tool loop) to surface tool.* events. */
  emitEvent(event: RuntimeEvent): void {
    this.emit(event);
  }

  /**
   * Park the current tool-loop iteration until the user (via the API)
   * answers a `PermissionRequestError`. The loop calls this after emitting
   * the `permission-request` event; the API calls `resolvePermission` once
   * the user picks allow/deny. Returns a promise that resolves with the
   * user's decision.
   *
   * If a request with the same id is awaited twice, the second call returns
   * the same promise — idempotent under retries from the loop.
   */
  awaitPermission(
    requestId: string,
    meta: { workspaceId: string; taskId: string; tool: string; target: string },
  ): Promise<"allow" | "deny"> {
    const existing = this.permissionResolvers.get(requestId);
    if (existing) return new Promise((resolve) => existing.resolve);
    const promptedAt = new Date().toISOString();
    this.permissionAudit.record({
      at: promptedAt,
      requestId,
      workspaceId: meta.workspaceId,
      taskId: meta.taskId,
      tool: meta.tool,
      target: meta.target,
      decision: "ask",
    });
    return new Promise<"allow" | "deny">((resolve, reject) => {
      this.permissionResolvers.set(requestId, { resolve, reject, meta: { ...meta, promptedAt } });
    });
  }

  /**
   * Resolve a pending permission request. Called by the API route when the
   * user answers the prompt. After resolution the loop re-attempts the
   * tool call (it will see the updated config and either pass through or
   * raise `PermissionDeniedError`).
   *
   * Every resolution is appended to the in-memory audit log so operators
   * can later review which prompts the user approved vs denied.
   */
  resolvePermission(
    requestId: string,
    decision: "allow" | "deny",
  ): boolean {
    const entry = this.permissionResolvers.get(requestId);
    if (!entry) return false;
    this.permissionResolvers.delete(requestId);
    entry.resolve(decision);
    this.permissionAudit.record({
      at: new Date().toISOString(),
      requestId,
      workspaceId: entry.meta.workspaceId,
      taskId: entry.meta.taskId,
      tool: entry.meta.tool,
      target: entry.meta.target,
      decision,
      promptedAt: entry.meta.promptedAt,
    });
    this.emit({
      type: "permission-resolved",
      workspaceId: entry.meta.workspaceId,
      taskId: entry.meta.taskId,
      requestId,
      decision,
    });
    return true;
  }

  awaitApproval(
    requestId: string,
    meta: { workspaceId: string; taskId: string; prompt: string; requireComment: boolean; reason?: string },
  ): Promise<ApprovalResponse> {
    const existing = this.approvalResolvers.get(requestId);
    if (existing) {
      return new Promise<ApprovalResponse>((resolve, reject) => {
        const prevResolve = existing.resolve;
        const prevReject = existing.reject;
        existing.resolve = (response) => {
          prevResolve(response);
          resolve(response);
        };
        existing.reject = (err) => {
          prevReject(err);
          reject(err);
        };
      });
    }
    const promptedAt = new Date().toISOString();
    return new Promise<ApprovalResponse>((resolve, reject) => {
      this.approvalResolvers.set(requestId, { resolve, reject, meta: { ...meta, promptedAt } });
    });
  }

  resolveApproval(requestId: string, response: ApprovalResponse): ApprovalResolveResult {
    const entry = this.approvalResolvers.get(requestId);
    if (!entry) return { ok: false, reason: "unknown" };
    if (entry.meta.requireComment && !response.comment?.trim()) {
      return { ok: false, reason: "comment_required" };
    }
    this.approvalResolvers.delete(requestId);
    entry.resolve(response);
    this.emit({
      type: "approval-resolved",
      workspaceId: entry.meta.workspaceId,
      taskId: entry.meta.taskId,
      requestId,
      decision: response.decision,
      comment: response.comment,
    });
    return { ok: true };
  }

  pendingApprovalCount(): number {
    return this.approvalResolvers.size;
  }

  /**
   * Snapshot the audit log. Empty `requestId` rows correspond to auto-deny
   * (no user prompt) — useful for catching config regressions.
   */
  getPermissionAudit(query?: PermissionAuditQuery): PermissionAuditEntry[] {
    return this.permissionAudit.query(query);
  }

  /**
   * Direct access to the audit log. Tests + the API pass it through; the
   * `record` method is for callers that need to inject synthetic entries
   * (e.g. importing a legacy log).
   */
  get permissionAuditLog(): PermissionAuditLog {
    return this.permissionAudit;
  }

  /** How many permission requests are currently parked. For diagnostics. */
  pendingPermissionCount(): number {
    return this.permissionResolvers.size;
  }

  /**
   * Append a ledger entry to the in-memory ledger for `workspaceId`.
   * Downstream consumers (evolution, telemetry) can read the ledger via
   * `getLedger()` or subscribe to the `ledger` runtime event.
   */
  appendLedgerEntry(workspaceId: string, entry: LedgerEntry): Ledger | undefined {
    const current = this.ledgers.get(workspaceId) ?? freshLedger(workspaceId)
    const next = appendLedger(current, entry)
    this.ledgers.set(workspaceId, next)
    this.emit({ type: "ledger", workspaceId, ledger: next })
    return next
  }

  /** Read the current ledger for a workspace (or undefined if not started). */
  getLedger(workspaceId: string): Ledger | undefined {
    return this.ledgers.get(workspaceId)
  }

  private emit(event: RuntimeEvent): void {
    for (const l of this.listeners) {
      // Listeners are declared as (event) => void but commonly return a Promise
      // (e.g. evolution.recordCompletion, metrics recording). If we don't
      // attach a catch, an in-flight rejection becomes an unhandled rejection.
      try {
        const ret = l(event) as unknown;
        if (ret && typeof (ret as { then?: unknown }).then === "function") {
          (ret as Promise<void>).catch((err) => {
            log.error({ err }, "Async listener error");
          });
        }
      } catch (err) {
        log.error({ err }, "Listener error");
      }
    }
  }

  /**
   * Execute a plan against the given workspace.
   * MVP: sequential execution following plan.task order.
   */
  async execute(workspace: Workspace): Promise<Workspace> {
    return withSpan(
      "workspace.execute",
      async (span) => {
        span?.setAttribute("workspace.id", workspace.id);
        span?.setAttribute("workspace.taskCount", workspace.plan?.tasks.length ?? 0);
        return this._executeImpl(workspace);
      },
      { "workspace.id": workspace.id },
    );
  }

  private async _executeImpl(workspace: Workspace): Promise<Workspace> {
    const controller = new AbortController();
    this.runningWorkspaces.set(workspace.id, controller);

    // Initialize the Magentic-One style ledger for this workspace.
    const initialLedger = freshLedger(workspace.id)
    this.ledgers.set(workspace.id, initialLedger)

    const updated: Workspace = {
      ...workspace,
      results: [...workspace.results],
      updatedAt: new Date().toISOString(),
    };

    if (!updated.plan) {
      updated.status = "failed";
      updated.error = "No plan attached to workspace";
      await this.sink.saveWorkspace(updated);
      this.emit({ type: "workspace-status", workspaceId: updated.id, status: "failed" });
      this.emit({ type: "done", workspaceId: updated.id, workspace: updated });
      return updated;
    }

    updated.status = "executing";
    await this.sink.saveWorkspace(updated);
    this.emit({ type: "workspace-status", workspaceId: updated.id, status: "executing" });
    this.emit({ type: "plan", workspaceId: updated.id, plan: updated.plan });

    // Seed the ledger with a high-level plan entry.
    const planSummary = `${updated.plan.tasks.length} tasks across ${new Set(updated.plan.tasks.map((t) => t.agentRole)).size} roles`
    const planEntry: LedgerEntry = {
      kind: "plan",
      round: 0,
      summary: planSummary,
      at: new Date().toISOString(),
    }
    const afterPlan = appendLedger(initialLedger, planEntry)
    this.ledgers.set(updated.id, afterPlan)
    this.emit({ type: "ledger", workspaceId: updated.id, ledger: afterPlan })

    // Concurrent execution respecting dependencies.
    const completed = new Set<string>();
    const failed = new Set<string>();
    const pending = [...updated.plan.tasks];
    const sem = new Semaphore(this.maxConcurrency);
    const startedAt = Date.now();
    // Task retry counter — persists across waves so retries are bounded.
    const retryMap = new Map<string, number>();
    // Per-workspace counters. Wrapped in objects so the helper method
    // (`runTask`) can mutate them via reference without us having to
    // capture this whole closure. Do NOT hoist these to instance fields —
    // shared state across concurrent workspaces would let workspace B
    // trip termination based on workspace A's progress.
    const messagesEmittedRef = { value: 0 };
    const tokensConsumedRef = { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 };
    const roundRef = { value: 0 };
    const counters = {
      completed,
      messagesEmittedRef,
      tokensConsumedRef,
      roundRef,
    };

    while (pending.length > 0) {
      if (controller.signal.aborted) {
        updated.status = "failed";
        updated.error = "Aborted";
        break;
      }

      // Bump the round counter ONCE per scheduling wave (i.e. once per
      // outer-loop iteration), not once per task. Magentic-One semantics:
      // a "round" is one full pass over the dependency graph; multiple
      // tasks may run concurrently within a single round. The earlier
      // implementation incremented inside `runTask`, so two tasks in the
      // same wave would be labelled r0 and r1, which makes the ledger
      // confusing to read and breaks any consumer that joins on round.
      roundRef.value += 1

      // TerminationCondition check (mirrors autogen's termination loop).
      // We compute the verdict before each round; if it fires, remaining
      // tasks are skipped and we exit cleanly with the reason attached.
      const termCtx: TerminationContext = {
        workspaceId: updated.id,
        messagesEmitted: messagesEmittedRef.value,
        tokensConsumed: { ...tokensConsumedRef },
        startedAt,
        now: Date.now(),
      }
      const verdict: TerminationVerdict = this.termination.check(termCtx)
      if (verdict.stop) {
        updated.status = "completed"
        updated.error = `terminated: ${verdict.reason}`
        for (const t of pending) {
          if (t.status === "pending" || t.status === "running") {
            t.status = "skipped" as Task["status"]
            t.error = `terminated: ${verdict.reason}`
            t.completedAt = new Date().toISOString()
            this.emit({
              type: "task-skipped",
              workspaceId: updated.id,
              taskId: t.id,
              reason: `terminated: ${verdict.reason}`,
            })
          }
        }
        pending.length = 0
        break
      }

      // Find ALL runnable tasks (all deps completed, none failed).
      const runnable: Task[] = [];
      const remaining: Task[] = [];
      const newlySkipped: Task[] = [];
      for (const t of pending) {
        if (t.dependsOn.some((d) => failed.has(d))) {
          // A dependency failed — skip this task
          if (t.status !== "skipped") {
            t.status = "skipped" as import("./types.js").Task["status"];
            t.error = "skipped: dependency failed";
            t.completedAt = new Date().toISOString();
            newlySkipped.push(t);
          }
          remaining.push(t);
        } else if (t.dependsOn.every((d) => completed.has(d))) {
          runnable.push(t);
        } else {
          remaining.push(t);
        }
      }
      // Emit a task-skipped event so UI/observability can show this
      // distinctly from "pending" — otherwise the UI displays a stuck
      // "pending" status for tasks that will never run.
      for (const t of newlySkipped) {
        this.emit({
          type: "task-skipped",
          workspaceId: updated.id,
          taskId: t.id,
          reason: "dependency failed",
        });
      }

      if (runnable.length === 0 && remaining.length > 0) {
        // No runnable tasks but still pending — unresolvable cycle or all blocked by failures
        updated.status = "failed";
        updated.error = "Unresolvable dependency cycle or all tasks blocked by failures";
        break;
      }

      // Execute runnable tasks concurrently
      const retriedTasks: Task[] = [];

      const results = await Promise.allSettled(
        runnable.map(async (task) => {
          await sem.acquire();
          try {
            await this.runTask(updated, task, counters);
            completed.add(task.id);
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            const retries = retryMap.get(task.id) ?? 0;
            if (retries < this.maxTaskRetries) {
              // Re-queue for retry
              retryMap.set(task.id, retries + 1);
              task.status = "pending";
              task.error = undefined;
              task.completedAt = undefined;
              retriedTasks.push(task);
              log.warn({ taskId: task.id, retry: retries + 1, maxRetries: this.maxTaskRetries }, "task failed, retrying");
              this.emit({ type: "task-failed", workspaceId: updated.id, taskId: task.id, error: `${error} (retry ${retries + 1}/${this.maxTaskRetries})` });
            } else {
              task.status = "failed";
              task.error = error;
              task.completedAt = new Date().toISOString();
              failed.add(task.id);
              this.emit({ type: "task-failed", workspaceId: updated.id, taskId: task.id, error });
              throw err;
            }
          } finally {
            sem.release();
          }
        }),
      );

      // Re-add retried tasks to remaining so they run in the next wave
      remaining.push(...retriedTasks);

      // Check if any (non-retried) task failed
      const firstFailure = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      if (firstFailure) {
        updated.status = "failed";
        updated.error = String(firstFailure.reason);
        break;
      }

      pending.length = 0;
      pending.push(...remaining);
    }

    if (updated.status === "executing") {
      updated.status = "completed";
    }
    updated.updatedAt = new Date().toISOString();
    await this.sink.saveWorkspace(updated);
    this.emit({ type: "workspace-status", workspaceId: updated.id, status: updated.status });
    this.emit({ type: "done", workspaceId: updated.id, workspace: updated });
    this.runningWorkspaces.delete(workspace.id);
    return updated;
  }

  private async runTask(
    workspace: Workspace,
    task: import("./types.js").Task,
    counters: {
      completed: Set<string>
      messagesEmittedRef: { value: number }
      tokensConsumedRef: {
        input: number
        output: number
        total: number
        cacheRead: number
        cacheCreation: number
      }
      roundRef: { value: number }
    }
  ): Promise<void> {
    const _completed = counters.completed
    const messagesRef = counters.messagesEmittedRef
    const tokensRef = counters.tokensConsumedRef
    const roundRef = counters.roundRef
    // Emit task-start BEFORE any preconditions that could throw, so listeners
    // that pair task-start with task-complete/task-failed (e.g. the Prometheus
    // activeTasks gauge) never see a task-failed without a matching start.
    task.status = "running";
    task.startedAt = new Date().toISOString();
    this.emit({
      type: "task-start",
      workspaceId: workspace.id,
      taskId: task.id,
      agentRole: task.agentRole,
    });

    if (task.metadata?.kind === "approval") {
      await this.runApprovalTask(workspace, task, roundRef.value);
      messagesRef.value += 1;
      return;
    }

    // Append an action entry to the ledger for the orchestrator record.
    const actionEntry: LedgerEntry = {
      kind: "action",
      round: roundRef.value,
      agent: task.agentRole,
      input: { description: task.description.slice(0, 200) },
      at: task.startedAt,
    }
    const afterAction = appendLedger(this.ledgers.get(workspace.id) ?? freshLedger(workspace.id), actionEntry)
    this.ledgers.set(workspace.id, afterAction)
    this.emit({ type: "ledger", workspaceId: workspace.id, ledger: afterAction })

    await withSpan(
      "task.execute",
      async (span) => {
        span?.setAttribute("task.id", task.id);
        span?.setAttribute("task.agentRole", task.agentRole);
        span?.setAttribute("workspace.id", workspace.id);
        span?.setAttribute("task.description", task.description.slice(0, 200));

        // Select best provider for this role if model selector is available.
        let preferredProvider: string | undefined;
        if (this.modelSelector) {
          const selection = this.modelSelector.select(task.agentRole);
          if (selection) {
            preferredProvider = selection.provider;
            span?.setAttribute("task.selectedProvider", selection.provider);
            span?.setAttribute("task.selectedModel", selection.model);
            span?.setAttribute("task.selectionReason", selection.reason);
          }
        }

        const agent = this.factory(task.agentRole, preferredProvider);
        if (!agent) {
          throw new Error(`No agent factory for role: ${task.agentRole}`);
        }

        // If a ModelRouter is configured, derive task characteristics and
        // set the model override on the agent so it can prefer the selected
        // provider/model when making LLM calls.
        if (this.modelRouter) {
          const taskChars = deriveTaskCharacteristics(task);
          const selection = this.modelRouter.selectModel(taskChars);
          agent.setModelOverride(selection.provider, selection.model);
          span?.setAttribute("task.modelRouter.provider", selection.provider);
          span?.setAttribute("task.modelRouter.model", selection.model);
        }

        // Inject long-term memory if available.
        if (this.memoryStore) {
          const prelude = this.memoryStore.toPrelude(task.agentRole);
          if (prelude) {
            agent.setMemoryPrelude(prelude);
          }
        }

        // Inject skills prelude if a skill source is configured. The match
        // is by trigger prefix against the task description — progressive
        // disclosure: only matched skills' summaries are loaded, not the
        // full SKILL.md bodies.
        if (this.getSkills) {
          const allSkills = await this.getSkills().catch(() => [])
          const matched = matchSkillsForModel(
            allSkills as Parameters<typeof matchSkillsForModel>[0],
            task.description,
          )
          if (matched.length > 0) {
            const summary = matched.map(renderSkillSummary).join("\n")
            agent.setSkillsPrelude(`\n# Skills that may apply\n${summary}\n`)
          } else {
            agent.setSkillsPrelude("")
          }
        }

        const ctx: AgentContext = {
          priorResults: workspace.results,
        };

        try {
          await agent.receiveTask(task, ctx);

          // P0-A wiring: when tool loop is enabled and the agent provides a
          // tool-enabled provider, route the chat call through `runToolLoop`.
          // The loop emits `tool-start` / `tool-end` events through
          // `this.emit`, so the API SSE stream + ScopedBus mirror them
          // alongside `task-start` / `task-complete`. Agents without a tool
          // provider fall through to the original single-shot execute path.
          const toolProvider: ToolEnabledProvider | undefined =
            this.enableToolLoop ? agent.getToolProvider() : undefined
          const final = toolProvider
            ? await runToolLoopAndSubmit(
                agent,
                task,
                ctx,
                toolProvider,
                workspace.id,
                this.emit.bind(this),
                (requestId, meta) => this.awaitPermission(requestId, meta),
              )
            : await agent.execute(task, ctx).then((r) => agent.submitResult(r))

          task.resultId = final.id;
          task.status = "completed";
          task.completedAt = new Date().toISOString();
          workspace.results.push(final);

          span?.setAttribute("task.resultId", final.id);

          this.emit({
            type: "task-complete",
            workspaceId: workspace.id,
            taskId: task.id,
            result: final,
          });

          // Append a Magentic-One observation to the ledger.
          const observation: LedgerEntry = {
            kind: "observation",
            round: roundRef.value,
            agent: task.agentRole,
            ok: true,
            output: final.output?.slice(0, 200),
            at: new Date().toISOString(),
          }
          const afterObs = appendLedger(this.ledgers.get(workspace.id) ?? freshLedger(workspace.id), observation)
          this.ledgers.set(workspace.id, afterObs)
          this.emit({ type: "ledger", workspaceId: workspace.id, ledger: afterObs })

          messagesRef.value += 1
          // Optional: aggregate token counts from the result metadata so
          // TokenUsageTermination can stop the workspace on a budget.
          const usage = (final.metadata?.usage as
            | { input?: number; output?: number; cacheRead?: number; cacheCreation?: number }
            | undefined)
          if (usage) {
            tokensRef.input += usage.input ?? 0
            tokensRef.output += usage.output ?? 0
            tokensRef.cacheRead += usage.cacheRead ?? 0
            tokensRef.cacheCreation += usage.cacheCreation ?? 0
            tokensRef.total = tokensRef.input + tokensRef.output
          }
          // roundRef is bumped per scheduling wave at the top of the
          // while-loop in `_executeImpl` — NOT here — so concurrent tasks
          // in the same wave share the same round number.

          // Update long-term memory on success.
          if (this.memoryStore) {
            const snippet = final.output.slice(0, 500);
            await this.memoryStore.recordSuccess(
              task.agentRole,
              { taskId: task.id, reviewScore: (final.metadata?.review as { score?: number })?.score },
              snippet,
            ).catch(() => {});
          }
        } catch (err) {
          task.status = "failed";
          task.error = err instanceof Error ? err.message : String(err);
          task.completedAt = new Date().toISOString();

          // Append a failed observation to the ledger.
          const failedObs: LedgerEntry = {
            kind: "observation",
            round: roundRef.value,
            agent: task.agentRole,
            ok: false,
            error: task.error,
            at: new Date().toISOString(),
          }
          const afterFailed = appendLedger(this.ledgers.get(workspace.id) ?? freshLedger(workspace.id), failedObs)
          this.ledgers.set(workspace.id, afterFailed)
          this.emit({ type: "ledger", workspaceId: workspace.id, ledger: afterFailed })

          // Update long-term memory on failure.
          if (this.memoryStore) {
            await this.memoryStore.recordFailure(
              task.agentRole,
              { taskId: task.id, error: task.error },
            ).catch(() => {});
          }

          throw err;
        }
      },
      { "task.id": task.id, "task.agentRole": task.agentRole, "workspace.id": workspace.id },
    );
  }

  private async runApprovalTask(workspace: Workspace, task: Task, round: number): Promise<void> {
    const approval = (task.metadata?.approval ?? {}) as {
      prompt?: string;
      requireComment?: boolean;
      reason?: string;
    };
    const prompt = approval.prompt ?? task.description;
    const requireComment = approval.requireComment ?? false;
    const requestId = `approval-${randomUUID().slice(0, 8)}`;

    const actionEntry: LedgerEntry = {
      kind: "action",
      round,
      agent: task.agentRole,
      input: { description: prompt.slice(0, 200), approval: true },
      at: task.startedAt ?? new Date().toISOString(),
    };
    const afterAction = appendLedger(this.ledgers.get(workspace.id) ?? freshLedger(workspace.id), actionEntry);
    this.ledgers.set(workspace.id, afterAction);
    this.emit({ type: "ledger", workspaceId: workspace.id, ledger: afterAction });
    const responsePromise = this.awaitApproval(requestId, {
      workspaceId: workspace.id,
      taskId: task.id,
      prompt,
      requireComment,
      reason: approval.reason,
    });

    this.emit({
      type: "approval-request",
      workspaceId: workspace.id,
      taskId: task.id,
      requestId,
      prompt,
      requireComment,
      reason: approval.reason,
    });

    const response = await responsePromise;

    if (response.decision === "reject") {
      throw new Error(response.comment?.trim() ? `approval rejected: ${response.comment}` : "approval rejected");
    }

    const result: Result = {
      id: `r-${randomUUID().slice(0, 8)}`,
      taskId: task.id,
      agentRole: task.agentRole,
      agentId: "human-approval",
      output: response.comment?.trim() ? `Approved: ${response.comment}` : "Approved by human",
      metadata: { approval: { decision: response.decision, comment: response.comment } },
      createdAt: new Date().toISOString(),
    };
    task.resultId = result.id;
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    workspace.results.push(result);
    this.emit({ type: "task-complete", workspaceId: workspace.id, taskId: task.id, result });

    const observation: LedgerEntry = {
      kind: "observation",
      round,
      agent: task.agentRole,
      ok: true,
      output: result.output.slice(0, 200),
      at: new Date().toISOString(),
    };
    const afterObs = appendLedger(this.ledgers.get(workspace.id) ?? freshLedger(workspace.id), observation);
    this.ledgers.set(workspace.id, afterObs);
    this.emit({ type: "ledger", workspaceId: workspace.id, ledger: afterObs });
  }

  abort(workspaceId: string): void {
    this.runningWorkspaces.get(workspaceId)?.abort();
  }
}

/**
 * Run the tool loop against an agent's tool-enabled provider, then
 * synthesize a `Result` from the final response so the rest of the runtime
 * (ledger, memory, event emission) is identical to the single-shot path.
 * The loop's `tool-start` / `tool-end` events flow through `emit` so the
 * API SSE stream and the ScopedBus mirror them like any other RuntimeEvent.
 */
async function runToolLoopAndSubmit(
  agent: Agent,
  task: import("./types.js").Task,
  ctx: AgentContext,
  toolProvider: ToolEnabledProvider,
  workspaceId: string,
  emit: (event: RuntimeEvent) => void,
  awaitPermission: (
    requestId: string,
    meta: { workspaceId: string; taskId: string; tool: string; target: string },
  ) => Promise<"allow" | "deny">,
): Promise<Result> {
  const messages = agent.buildChatMessages(task, ctx)
  const { response } = await runToolLoop(toolProvider, messages, {
    emitEvent: emit,
    workspaceId,
    taskId: task.id,
    awaitPermission,
  })
  const result: Result = {
    id: `r-${randomUUID().slice(0, 8)}`,
    taskId: task.id,
    agentRole: task.agentRole,
    agentId: agent.id,
    output: response.content,
    metadata: {
      model: response.model,
      usage: response.usage
        ? {
            input: response.usage.promptTokens,
            output: response.usage.completionTokens,
            total: response.usage.totalTokens,
            cacheRead: response.usage.cacheReadTokens,
            cacheCreation: response.usage.cacheCreationTokens,
          }
        : undefined,
    },
    createdAt: new Date().toISOString(),
    durationMs: undefined,
  }
  return agent.submitResult(result)
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}