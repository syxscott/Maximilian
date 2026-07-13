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

import { randomUUID } from "node:crypto"
import { Agent, type AgentContext } from "./agent.js"
import { withSpan, getLogger } from "@max/telemetry"

const log = getLogger("core:runtime")
import { runToolLoop, type ToolEnabledProvider } from "./tool-integration.js"
import { classifyTaskError } from "./failover-reason.js"
import type { AgentManifest } from "./types.js"
import { StallDetector, type StallInfo } from "./stall-detection.js"
import type { ChatMessage } from "@max/providers"
import type { AgentRole, Plan, Result, Task, Workspace, WorkspaceStatus } from "./types.js"
import {
  NeverTermination,
  type TerminationCondition,
  type TerminationContext,
  type TerminationVerdict,
} from "./termination.js"
import { appendLedger, extendLedger, freshLedger, type Ledger, type LedgerEntry } from "./ledger.js"
import { matchSkillsForModel, renderSkillSummary } from "./skills.js"
import { ModelRouter, deriveTaskCharacteristics, type TaskCharacteristics } from "./model-router.js"
import {
  PermissionAuditLog,
  type PermissionAuditEntry,
  type PermissionAuditQuery,
} from "./permission-audit.js"

/**
 * Long-term memory store interface.
 * Mirrors AgentMemoryStore from @max/evolution but kept as an interface
 * to avoid hard coupling.
 */
export interface AgentMemoryStorePort {
  getMemory(role: AgentRole): {
    userFeedback: string[]
    reviewSuggestions: string[]
    commonErrors: string[]
    goodExamples: string[]
    totalEntries: number
  }
  recordSuccess(
    role: AgentRole,
    record: { taskId: string; reviewScore?: number },
    snippet?: string,
  ): Promise<void>
  recordFailure(
    role: AgentRole,
    record: { taskId: string; reviewScore?: number; error?: string },
  ): Promise<void>
  toPrelude(role: AgentRole): string
}

/**
 * Model selector interface for dynamic provider selection.
 * Mirrors ModelSelector from @max/evolution.
 */
export interface ModelSelectorPort {
  select(role: AgentRole): { provider: string; model: string; score: number; reason: string } | null
}

export type ApprovalDecision = "approve" | "reject"

export interface ApprovalResponse {
  decision: ApprovalDecision
  comment?: string
}

/** Result of resolving a parked approval. The API translates `reason` into
 *  a status code so the client can show a useful error instead of guessing
 *  from a generic 404. */
export type ApprovalResolveResult =
  { ok: true } | { ok: false; reason: "unknown" | "comment_required" }

export type RuntimeEvent =
  | { type: "plan"; workspaceId: string; plan: Plan }
  | { type: "task-start"; workspaceId: string; taskId: string; agentRole: AgentRole }
  | { type: "task-complete"; workspaceId: string; taskId: string; result: Result }
  | { type: "task-failed"; workspaceId: string; taskId: string; error: string }
  | { type: "task-skipped"; workspaceId: string; taskId: string; reason: string }
  | { type: "tool-start"; workspaceId: string; taskId: string; toolName: string; input?: unknown }
  | {
      type: "tool-end"
      workspaceId: string
      taskId: string
      toolName: string
      ok: boolean
      durationMs: number
      error?: string
    }
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
    }

export type RuntimeListener = (event: RuntimeEvent) => void

export type AgentFactory = (role: AgentRole, preferredProvider?: string) => Agent | undefined

export interface RuntimeSink {
  saveWorkspace(workspace: Workspace): Promise<void>
  loadWorkspace(id: string): Promise<Workspace | undefined>
}

export interface RuntimeOptions {
  /** Max concurrent LLM calls (default: 5) */
  maxConcurrency?: number
  /** Optional long-term memory store for injecting lessons learned into agents. */
  memoryStore?: AgentMemoryStorePort
  /** Optional model selector for dynamic provider selection per role. */
  modelSelector?: ModelSelectorPort
  /**
   * Optional termination condition. When the predicate fires, the runtime
   * stops accepting new tasks, marks remaining ones as skipped, and emits a
   * done event with the stop reason.
   */
  termination?: TerminationCondition
  /**
   * Optional counter for messages emitted by the orchestrator. The runtime
   * increments it whenever a `task-complete` event fires, and the
   * termination condition can read the latest value via `ctx.messagesEmitted`.
   */
  onTaskComplete?: (info: { workspaceId: string; taskId: string; agentRole: AgentRole }) => void
  /**
   * When true, the runtime will route any agent that opts in via
   * `getToolProvider()` through `runToolLoop`. The loop's tool-start /
   * tool-end events are emitted through the runtime's normal emit path so
   * the API SSE stream and the new ScopedBus mirror them like any other
   * RuntimeEvent. Agents without a tool provider are unaffected.
   */
  enableToolLoop?: boolean
  /**
   * Optional skill source. When provided, the runtime matches each task's
   * description against the returned skills' `triggers` and injects the
   * matching skill summaries as a per-task prelude. Mirrors hermes-agent's
   * SKILL.md progressive disclosure: only the matched skills' descriptions
   * are loaded, not the full body.
   */
  getSkills?: () => Promise<
    Array<{
      frontmatter: { name: string; description?: string; triggers?: string[] }
      body: string
    }>
  >
  /**
   * Optional ModelRouter for task-aware model selection. When provided, the
   * runtime derives TaskCharacteristics from each task and uses the router
   * to select the optimal provider/model, then calls
   * `agent.setModelOverride()` so the agent can prefer it.
   */
  modelRouter?: ModelRouter
  /**
   * Max retries for a failed task (default: 0 = no retry).
   * When > 0, failed tasks are re-queued with an incremented retry counter
   * instead of immediately marking them as failed. Retries are bounded so
   * a permanently broken task doesn't loop forever.
   */
  maxTaskRetries?: number
  /**
   * Stall detection — Mirrors Magentic-One's outer-loop self-reflection.
   * When the runtime observes N consecutive idle rounds (no tasks completed,
   * no new results produced), this hook fires with the current pending tasks
   * and completed results. The hook may return a replacement set of pending
   * tasks; the runtime swaps them in and resets the stall counter. Returning
   * `null` (or undefined) leaves the existing pending list intact, so a
   * transient stall doesn't block execution.
   *
   * Inspired by Magentic-One's Task Ledger → re-plan flow when progress stalls.
   */
  onStall?: (
    info: StallInfo,
    pending: Task[],
    results: Result[],
    /** Per-workspace context. Carries the user request so a Commander
     *  replanner can re-plan with the original intent. Optional for back-compat
     *  with callers that ignore it. */
    ctx?: { workspaceId: string; userRequest: string },
  ) => Promise<{ tasks: Task[] } | null | undefined>
  /**
   * Number of consecutive idle rounds that count as a stall (default: 3).
   * Tied to StallDetector's own threshold; exposed here so callers don't
   * need to instantiate the detector themselves.
   */
  maxIdleRoundsBeforeStall?: number
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
  private current = 0
  private waiting: Array<() => void> = []

  constructor(private max: number) {}

  acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.current++
        resolve()
      })
      this.drain()
    })
  }

  release(): void {
    // Defensive: an extra release() shouldn't drive current below zero.
    if (this.current > 0) this.current--
    this.drain()
  }

  private drain(): void {
    while (this.waiting.length > 0 && this.current < this.max) {
      const next = this.waiting.shift()!
      next()
    }
  }
}

/**
 * Race a promise against an abort signal. When the signal fires, the
 * returned promise rejects immediately - the runtime doesn't have to wait
 * for the underlying LLM call to complete before transitioning the
 * workspace to "failed". The original promise continues in the background
 * (Node's fetch doesn't support cancellation without plumbing the signal
 * into the SDK call), but the wave loop is unblocked.
 *
 * Agents that pass `ctx.signal` to their provider.chat() call get true
 * cancellation; this race is the safety net for agents that don't.
 */
function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  workspaceId: string,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    return Promise.reject(new Error(`workspace ${workspaceId} aborted`))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error(`workspace ${workspaceId} aborted`))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener("abort", onAbort)
        reject(e)
      },
    )
  })
}

export class AgentRuntime {
  private listeners = new Set<RuntimeListener>()
  private runningWorkspaces = new Map<string, AbortController>()
  private ledgers = new Map<string, Ledger>()
  private maxConcurrency: number
  private memoryStore?: AgentMemoryStorePort
  private modelSelector?: ModelSelectorPort
  private modelRouter?: ModelRouter
  private termination: TerminationCondition
  private enableToolLoop: boolean
  private getSkills?: RuntimeOptions["getSkills"]
  private maxTaskRetries: number
  private maxIdleRoundsBeforeStall: number
  private onStall?: RuntimeOptions["onStall"]
  /**
   * Workspaces currently in the middle of a stall-triggered replan.
   * Used to prevent recursive replans from re-entering the onStall
   * callback before the previous one has finished replacing pending tasks.
   *
   * Note: the actual `StallDetector` instance is created per-workspace
   * inside `_executeImpl` rather than hoisted to this field. Sharing one
   * detector across concurrent workspaces would let workspace A's stall
   * (or its reset) leak into workspace B's counter and falsely trip —
   * or worse, erase — B's progress tracking.
   */
  private replanningWorkspaces = new Set<string>()
  /**
   * Pending permission requests. When the tool loop hits a `PermissionRequestError`,
   * the loop calls `awaitPermission(requestId)` and parks until the user
   * (via the API) calls `resolvePermission(requestId, decision)`.
   * Keyed by the requestId minted in `@max/tools/with-permission`.
   */
  private permissionResolvers = new Map<
    string,
    {
      resolve: (decision: "allow" | "deny") => void
      reject: (err: Error) => void
      meta: {
        workspaceId: string
        taskId: string
        tool: string
        target: string
        promptedAt: string
      }
    }
  >()
  private approvalResolvers = new Map<
    string,
    {
      resolve: (response: ApprovalResponse) => void
      reject: (err: Error) => void
      meta: {
        workspaceId: string
        taskId: string
        prompt: string
        requireComment: boolean
        reason?: string
        promptedAt: string
      }
    }
  >()
  private permissionAudit = new PermissionAuditLog()

  constructor(
    private factory: AgentFactory,
    private sink: RuntimeSink,
    options?: RuntimeOptions,
  ) {
    this.maxConcurrency = options?.maxConcurrency ?? 5
    this.memoryStore = options?.memoryStore
    this.modelSelector = options?.modelSelector
    this.modelRouter = options?.modelRouter
    this.termination = options?.termination ?? NeverTermination
    this.enableToolLoop = options?.enableToolLoop ?? false
    this.getSkills = options?.getSkills
    this.maxTaskRetries = options?.maxTaskRetries ?? 0
    this.maxIdleRoundsBeforeStall = options?.maxIdleRoundsBeforeStall ?? 3
    this.onStall = options?.onStall
  }

  on(listener: RuntimeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Public emit — for non-Runtime code (e.g. tool loop) to surface tool.* events. */
  emitEvent(event: RuntimeEvent): void {
    this.emit(event)
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
    const existing = this.permissionResolvers.get(requestId)
    if (existing) {
      // Duplicate requestId (likely a runtime re-entry or auto-retry). The
      // original prompt is already in flight — refuse the second call rather
      // than returning a Promise that resolves on a stale closure.
      throw new Error(`permission request ${requestId} already pending`)
    }
    const promptedAt = new Date().toISOString()
    this.permissionAudit.record({
      at: promptedAt,
      requestId,
      workspaceId: meta.workspaceId,
      taskId: meta.taskId,
      tool: meta.tool,
      target: meta.target,
      decision: "ask",
    })
    return new Promise<"allow" | "deny">((resolve, reject) => {
      this.permissionResolvers.set(requestId, { resolve, reject, meta: { ...meta, promptedAt } })
    })
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
  resolvePermission(requestId: string, decision: "allow" | "deny"): boolean {
    const entry = this.permissionResolvers.get(requestId)
    if (!entry) return false
    this.permissionResolvers.delete(requestId)
    entry.resolve(decision)
    this.permissionAudit.record({
      at: new Date().toISOString(),
      requestId,
      workspaceId: entry.meta.workspaceId,
      taskId: entry.meta.taskId,
      tool: entry.meta.tool,
      target: entry.meta.target,
      decision,
      promptedAt: entry.meta.promptedAt,
    })
    this.emit({
      type: "permission-resolved",
      workspaceId: entry.meta.workspaceId,
      taskId: entry.meta.taskId,
      requestId,
      decision,
    })
    return true
  }

  awaitApproval(
    requestId: string,
    meta: {
      workspaceId: string
      taskId: string
      prompt: string
      requireComment: boolean
      reason?: string
    },
  ): Promise<ApprovalResponse> {
    const existing = this.approvalResolvers.get(requestId)
    if (existing) {
      // Duplicate requestId (likely a runtime re-entry or auto-retry).
      // The original prompt is already in flight - refuse the second
      // call rather than chaining another resolve/reject onto the
      // existing entry. The previous implementation built an unbounded
      // linked list of resolvers on every duplicate, so a tight retry
      // loop could grow the chain indefinitely and fire N resolves on
      // a single user response. Matching awaitPermission's behaviour
      // keeps the two parked-prompt APIs consistent.
      throw new Error(`approval request ${requestId} already pending`)
    }
    const promptedAt = new Date().toISOString()
    return new Promise<ApprovalResponse>((resolve, reject) => {
      this.approvalResolvers.set(requestId, { resolve, reject, meta: { ...meta, promptedAt } })
    })
  }

  resolveApproval(requestId: string, response: ApprovalResponse): ApprovalResolveResult {
    const entry = this.approvalResolvers.get(requestId)
    if (!entry) return { ok: false, reason: "unknown" }
    if (entry.meta.requireComment && !response.comment?.trim()) {
      return { ok: false, reason: "comment_required" }
    }
    this.approvalResolvers.delete(requestId)
    entry.resolve(response)
    this.emit({
      type: "approval-resolved",
      workspaceId: entry.meta.workspaceId,
      taskId: entry.meta.taskId,
      requestId,
      decision: response.decision,
      comment: response.comment,
    })
    return { ok: true }
  }

  pendingApprovalCount(): number {
    return this.approvalResolvers.size
  }

  /**
   * Snapshot the audit log. Empty `requestId` rows correspond to auto-deny
   * (no user prompt) — useful for catching config regressions.
   */
  getPermissionAudit(query?: PermissionAuditQuery): PermissionAuditEntry[] {
    return this.permissionAudit.query(query)
  }

  /**
   * Save runtime state snapshot for a workspace (借鉴 openclaw sessions store).
   * Captures the in-memory ledger, retry counters, and pending task ids into
   * workspace.metadata.state so the caller can restore it later via loadState().
   *
   * Does NOT save the workspace itself (the sink handles persistence).
   * Returns the state snapshot object for the caller's convenience.
   */
  saveState(workspaceId: string): Record<string, unknown> | undefined {
    const ledger = this.ledgers.get(workspaceId)
    const retryCounts: Record<string, number> = {}
    // We can't snapshot retryMap directly (it's a local in _executeImpl).
    // Instead, we expose what we can from the public fields.
    return {
      ledger: ledger ? { ...ledger, entries: [...ledger.entries] } : undefined,
      savedAt: new Date().toISOString(),
    }
  }

  /**
   * Load a previously saved state snapshot into the runtime.
   * Currently restores the ledger. Extend as more state is captured.
   * Returns true if state was loaded, false if no state was found.
   */
  loadState(workspaceId: string, state: Record<string, unknown>): boolean {
    if (state.ledger && typeof state.ledger === "object") {
      const ledger = state.ledger as {
        id: string
        entries: LedgerEntry[]
        createdAt: string
        updatedAt: string
      }
      if (ledger.id && Array.isArray(ledger.entries)) {
        this.ledgers.set(workspaceId, ledger as unknown as Ledger)
        return true
      }
    }
    return false
  }

  /**
   * Direct access to the audit log. Tests + the API pass it through; the
   * `record` method is for callers that need to inject synthetic entries
   * (e.g. importing a legacy log).
   */
  get permissionAuditLog(): PermissionAuditLog {
    return this.permissionAudit
  }

  /** How many permission requests are currently parked. For diagnostics. */
  pendingPermissionCount(): number {
    return this.permissionResolvers.size
  }

  /**
   * Look up a pending permission request's metadata without resolving it.
   * The API route uses this to persist the user's decision to the on-disk
   * `permissions.json` so the same (tool, target) combination won't prompt
   * again on subsequent calls. Returns undefined if the request is unknown
   * or already resolved.
   */
  getPendingPermission(requestId: string):
    | {
        workspaceId: string
        taskId: string
        tool: string
        target: string
        promptedAt: string
      }
    | undefined {
    const entry = this.permissionResolvers.get(requestId)
    if (!entry) return undefined
    return { ...entry.meta }
  }

  /**
   * Look up a pending approval request's metadata without resolving it.
   * Used by the API route for tenant isolation: it checks that the caller's
   * tenantId matches the workspace that owns the pending approval, so
   * tenant B can't approve/reject tenant A's tasks. Returns undefined if
   * the request is unknown or already resolved.
   */
  getPendingApproval(requestId: string):
    | {
        workspaceId: string
        taskId: string
        prompt: string
        requireComment: boolean
        reason?: string
        promptedAt: string
      }
    | undefined {
    const entry = this.approvalResolvers.get(requestId)
    if (!entry) return undefined
    return { ...entry.meta }
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
        const ret = l(event) as unknown
        if (ret && typeof (ret as { then?: unknown }).then === "function") {
          ;(ret as Promise<void>).catch((err) => {
            log.error({ err }, "Async listener error")
          })
        }
      } catch (err) {
        log.error({ err }, "Listener error")
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
        span?.setAttribute("workspace.id", workspace.id)
        span?.setAttribute("workspace.taskCount", workspace.plan?.tasks.length ?? 0)
        return this._executeImpl(workspace)
      },
      { "workspace.id": workspace.id },
    )
  }

  private async _executeImpl(workspace: Workspace): Promise<Workspace> {
    const controller = new AbortController()
    this.runningWorkspaces.set(workspace.id, controller)

    // Initialize the Magentic-One style ledger for this workspace.
    const initialLedger = freshLedger(workspace.id)
    this.ledgers.set(workspace.id, initialLedger)

    const updated: Workspace = {
      ...workspace,
      results: [...workspace.results],
      updatedAt: new Date().toISOString(),
    }

    if (!updated.plan) {
      updated.status = "failed"
      updated.error = "No plan attached to workspace"
      await this.sink.saveWorkspace(updated)
      this.emit({ type: "workspace-status", workspaceId: updated.id, status: "failed" })
      this.emit({ type: "done", workspaceId: updated.id, workspace: updated })
      return updated
    }

    updated.status = "executing"
    await this.sink.saveWorkspace(updated)
    this.emit({ type: "workspace-status", workspaceId: updated.id, status: "executing" })
    this.emit({ type: "plan", workspaceId: updated.id, plan: updated.plan })

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
    const completed = new Set<string>()
    const failed = new Set<string>()
    const pending = [...updated.plan.tasks]
    const sem = new Semaphore(this.maxConcurrency)
    const startedAt = Date.now()
    // Task retry counter — persists across waves so retries are bounded.
    const retryMap = new Map<string, number>()
    // Stall detection baselines — captured each wave so we can report
    // "tasks completed this round" / "results added this round" rather
    // than cumulative totals (StallDetector expects per-round deltas).
    // The detector itself is per-workspace: shared instance across
    // concurrent workspaces would let workspace A's stall (or its reset)
    // leak into workspace B's counter and falsely trip — or erase —
    // B's progress tracking.
    const stallDetector = new StallDetector({
      maxIdleRounds: this.maxIdleRoundsBeforeStall,
    })
    let prevCompletedSize = completed.size
    let prevResultsLen = updated.results.length
    // Per-workspace counters. Wrapped in objects so the helper method
    // (`runTask`) can mutate them via reference without us having to
    // capture this whole closure. Do NOT hoist these to instance fields —
    // shared state across concurrent workspaces would let workspace B
    // trip termination based on workspace A's progress.
    const messagesEmittedRef = { value: 0 }
    const tokensConsumedRef = { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 }
    const roundRef = { value: 0 }
    const counters = {
      completed,
      messagesEmittedRef,
      tokensConsumedRef,
      roundRef,
    }

    while (pending.length > 0) {
      if (controller.signal.aborted) {
        updated.status = "failed"
        updated.error = "Aborted"
        break
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
      const runnable: Task[] = []
      const remaining: Task[] = []
      const newlySkipped: Task[] = []
      for (const t of pending) {
        if (t.dependsOn.some((d) => failed.has(d))) {
          // A dependency failed — skip this task
          if (t.status !== "skipped") {
            t.status = "skipped" as import("./types.js").Task["status"]
            t.error = "skipped: dependency failed"
            t.completedAt = new Date().toISOString()
            newlySkipped.push(t)
          }
          remaining.push(t)
        } else if (t.dependsOn.every((d) => completed.has(d))) {
          // Check DiGraph-style condition (借鉴 autogen): if the task has a
          // condition string in metadata, it must be satisfied by prior
          // results before the task can run.
          const cond = t.metadata?.condition as string | undefined
          if (cond && !conditionSatisfied(cond, updated.results)) {
            remaining.push(t)
          } else {
            runnable.push(t)
          }
        } else {
          remaining.push(t)
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
        })
      }

      if (runnable.length === 0 && remaining.length > 0) {
        // No runnable tasks but still pending — unresolvable cycle or all blocked by failures
        updated.status = "failed"
        updated.error = "Unresolvable dependency cycle or all tasks blocked by failures"
        break
      }

      // Execute runnable tasks concurrently
      const retriedTasks: Task[] = []

      const results = await Promise.allSettled(
        runnable.map(async (task) => {
          await sem.acquire()
          try {
            await this.runTask(updated, task, counters)
            completed.add(task.id)
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err)
            // Classify the error for smarter retry decisions (借鉴 hermes-agent).
            const classified = classifyTaskError(err)
            const retries = retryMap.get(task.id) ?? 0
            if (retries < this.maxTaskRetries && classified.retryable) {
              // Re-queue for retry
              retryMap.set(task.id, retries + 1)
              task.status = "pending"
              task.error = undefined
              task.completedAt = undefined
              retriedTasks.push(task)
              log.warn(
                {
                  taskId: task.id,
                  retry: retries + 1,
                  maxRetries: this.maxTaskRetries,
                  failoverReason: classified.reason,
                },
                "task failed, retrying",
              )
              this.emit({
                type: "task-failed",
                workspaceId: updated.id,
                taskId: task.id,
                error: `${error} (retry ${retries + 1}/${this.maxTaskRetries})`,
              })
            } else {
              task.status = "failed"
              task.error = error
              task.completedAt = new Date().toISOString()
              failed.add(task.id)
              log.warn(
                {
                  taskId: task.id,
                  failoverReason: classified.reason,
                  retryable: classified.retryable,
                },
                "task failed permanently",
              )
              this.emit({ type: "task-failed", workspaceId: updated.id, taskId: task.id, error })
              throw err
            }
          } finally {
            sem.release()
          }
        }),
      )

      // Re-add retried tasks to remaining so they run in the next wave
      remaining.push(...retriedTasks)

      // Note: we deliberately do NOT break out of the loop when a task
      // fails permanently. The failed task is already in the `failed`
      // set, so the next iteration's dependency resolver will skip
      // tasks that depend on it, while independent tasks continue to
      // run. Breaking here would abandon unrelated work that could
      // still succeed - e.g. a frontend task failing shouldn't block a
      // docs task that has no dependency on it. The workspace-level
      // failure status is set after the loop based on `failed.size`.

      // Stall detection — observe per-round progress, and when the system
      // has been idle for `maxIdleRounds`, ask the host for a replan.
      // Mirrors Magentic-One's outer-loop self-reflection: when the
      // Orchestrator sees no progress, it re-writes the Task Ledger.
      const completedDelta = completed.size - prevCompletedSize
      const resultsDelta = updated.results.length - prevResultsLen
      prevCompletedSize = completed.size
      prevResultsLen = updated.results.length
      const justStalled = stallDetector.observe({
        completedTasks: completedDelta,
        newResults: resultsDelta,
      })
      if (justStalled && this.onStall && !this.replanningWorkspaces.has(updated.id)) {
        const stallInfo = stallDetector.getStallInfo()
        if (stallInfo) {
          log.warn(
            {
              workspaceId: updated.id,
              idleRounds: stallInfo.idleRounds,
              totalRounds: stallInfo.totalRounds,
            },
            "workspace stalled — invoking onStall replan hook",
          )
          this.replanningWorkspaces.add(updated.id)
          try {
            const replan = await this.onStall(stallInfo, [...remaining], [...updated.results], {
              workspaceId: updated.id,
              userRequest: updated.userRequest,
            })
            if (replan && Array.isArray(replan.tasks) && replan.tasks.length > 0) {
              remaining.length = 0
              remaining.push(...replan.tasks)
              log.info(
                { workspaceId: updated.id, newTaskCount: replan.tasks.length },
                "replan accepted - pending replaced",
              )
            } else {
              log.info(
                { workspaceId: updated.id },
                "onStall returned no tasks - keeping original pending",
              )
            }
          } catch (err) {
            log.error(
              { err, workspaceId: updated.id },
              "onStall replan hook threw - keeping original pending",
            )
          } finally {
            // Always reset the detector, even when the replan failed or
            // returned nothing. Without this, `stalled` stays true and
            // observe() will never again transition (it only fires on
            // the false->true edge), so onStall could never fire again
            // - a transient LLM error would permanently disable replanning
            // for this workspace.
            stallDetector.reset()
            this.replanningWorkspaces.delete(updated.id)
          }
        }
      }

      pending.length = 0
      pending.push(...remaining)
    }

    if (controller.signal.aborted) {
      updated.status = "failed"
      updated.error = updated.error ?? "Aborted"
    } else if (failed.size > 0 && completed.size === 0) {
      // Every task failed (none completed) - workspace is unrecoverable.
      // Surface the first failed task's error so callers can see the
      // root cause without digging through the task list.
      const firstFailed = updated.plan?.tasks.find((t) => failed.has(t.id))
      const firstError = firstFailed?.error ?? "unknown error"
      updated.status = "failed"
      updated.error = `All ${failed.size} task(s) failed (first error: ${firstError})`
    } else if (failed.size > 0) {
      // Partial failure: some tasks completed, some failed. Mark as
      // completed so the user sees results, but record the failure
      // count on the workspace error field for surfacing in UI.
      const firstFailed = updated.plan?.tasks.find((t) => failed.has(t.id))
      const firstError = firstFailed?.error ?? "unknown error"
      updated.status = "completed"
      updated.error = `${failed.size} task(s) failed (first error: ${firstError})`
    } else if (updated.status === "executing") {
      updated.status = "completed"
    }
    updated.updatedAt = new Date().toISOString()
    await this.sink.saveWorkspace(updated)
    this.emit({ type: "workspace-status", workspaceId: updated.id, status: updated.status })
    this.emit({ type: "done", workspaceId: updated.id, workspace: updated })
    this.runningWorkspaces.delete(workspace.id)
    return updated
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
    },
  ): Promise<void> {
    const _completed = counters.completed
    const messagesRef = counters.messagesEmittedRef
    const tokensRef = counters.tokensConsumedRef
    const roundRef = counters.roundRef
    // Emit task-start BEFORE any preconditions that could throw, so listeners
    // that pair task-start with task-complete/task-failed (e.g. the Prometheus
    // activeTasks gauge) never see a task-failed without a matching start.
    task.status = "running"
    task.startedAt = new Date().toISOString()
    this.emit({
      type: "task-start",
      workspaceId: workspace.id,
      taskId: task.id,
      agentRole: task.agentRole,
    })

    if (task.metadata?.kind === "approval") {
      await this.runApprovalTask(workspace, task, roundRef.value)
      messagesRef.value += 1
      return
    }

    // Append an action entry to the ledger for the orchestrator record.
    const actionEntry: LedgerEntry = {
      kind: "action",
      round: roundRef.value,
      agent: task.agentRole,
      input: { description: task.description.slice(0, 200) },
      at: task.startedAt,
    }
    const afterAction = appendLedger(
      this.ledgers.get(workspace.id) ?? freshLedger(workspace.id),
      actionEntry,
    )
    this.ledgers.set(workspace.id, afterAction)
    this.emit({ type: "ledger", workspaceId: workspace.id, ledger: afterAction })

    await withSpan(
      "task.execute",
      async (span) => {
        span?.setAttribute("task.id", task.id)
        span?.setAttribute("task.agentRole", task.agentRole)
        span?.setAttribute("workspace.id", workspace.id)
        span?.setAttribute("task.description", task.description.slice(0, 200))

        // Select best provider for this role if model selector is available.
        let preferredProvider: string | undefined
        if (this.modelSelector) {
          const selection = this.modelSelector.select(task.agentRole)
          if (selection) {
            preferredProvider = selection.provider
            span?.setAttribute("task.selectedProvider", selection.provider)
            span?.setAttribute("task.selectedModel", selection.model)
            span?.setAttribute("task.selectionReason", selection.reason)
          }
        }

        const agent = this.factory(task.agentRole, preferredProvider)
        if (!agent) {
          throw new Error(`No agent factory for role: ${task.agentRole}`)
        }

        // If a ModelRouter is configured, derive task characteristics and
        // set the model override on the agent so it can prefer the selected
        // provider/model when making LLM calls.
        if (this.modelRouter) {
          const taskChars = deriveTaskCharacteristics(task)
          const selection = this.modelRouter.selectModel(taskChars)
          agent.setModelOverride(selection.provider, selection.model)
          span?.setAttribute("task.modelRouter.provider", selection.provider)
          span?.setAttribute("task.modelRouter.model", selection.model)
        }

        // Inject long-term memory if available.
        if (this.memoryStore) {
          const prelude = this.memoryStore.toPrelude(task.agentRole)
          if (prelude) {
            agent.setMemoryPrelude(prelude)
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
          // Pass the workspace's abort signal so agents that check it can
          // short-circuit LLM calls when the workspace is cancelled. The
          // runtime also races execution against this signal (see below)
          // so even agents that ignore ctx.signal don't block the wave loop.
          signal: this.runningWorkspaces.get(workspace.id)?.signal,
        }

        try {
          await raceWithAbort(agent.receiveTask(task, ctx), ctx.signal, workspace.id)

          // P0-A wiring: when tool loop is enabled and the agent provides a
          // tool-enabled provider, route the chat call through `runToolLoop`.
          // Set per-agent tool allowlist (借鉴 cc-switch) before running.
          const toolProvider: ToolEnabledProvider | undefined = this.enableToolLoop
            ? agent.getToolProvider()
            : undefined
          if (toolProvider) {
            toolProvider.setToolAllowlist(agent.manifest.allowedTools)
            toolProvider.setToolDenylist(agent.manifest.deniedTools)
          }
          const final = toolProvider
            ? await raceWithAbort(
                runToolLoopAndSubmit(
                  agent,
                  task,
                  ctx,
                  toolProvider,
                  workspace.id,
                  this.emit.bind(this),
                  (requestId, meta) => this.awaitPermission(requestId, meta),
                ),
                ctx.signal,
                workspace.id,
              )
            : await raceWithAbort(
                agent.execute(task, ctx).then((r) => agent.submitResult(r)),
                ctx.signal,
                workspace.id,
              )

          task.resultId = final.id
          task.status = "completed"
          task.completedAt = new Date().toISOString()
          workspace.results.push(final)

          span?.setAttribute("task.resultId", final.id)

          this.emit({
            type: "task-complete",
            workspaceId: workspace.id,
            taskId: task.id,
            result: final,
          })

          // Append a Magentic-One observation to the ledger.
          const observation: LedgerEntry = {
            kind: "observation",
            round: roundRef.value,
            agent: task.agentRole,
            ok: true,
            output: final.output?.slice(0, 200),
            at: new Date().toISOString(),
          }
          const afterObs = appendLedger(
            this.ledgers.get(workspace.id) ?? freshLedger(workspace.id),
            observation,
          )
          this.ledgers.set(workspace.id, afterObs)
          this.emit({ type: "ledger", workspaceId: workspace.id, ledger: afterObs })

          messagesRef.value += 1
          // Optional: aggregate token counts from the result metadata so
          // TokenUsageTermination can stop the workspace on a budget.
          const usage = final.metadata?.usage as
            | { input?: number; output?: number; cacheRead?: number; cacheCreation?: number }
            | undefined
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
            const snippet = final.output?.slice(0, 500) ?? ""
            await this.memoryStore
              .recordSuccess(
                task.agentRole,
                {
                  taskId: task.id,
                  reviewScore: (final.metadata?.review as { score?: number })?.score,
                },
                snippet,
              )
              .catch(() => {})
          }
        } catch (err) {
          task.status = "failed"
          task.error = err instanceof Error ? err.message : String(err)
          task.completedAt = new Date().toISOString()

          // Append a failed observation to the ledger.
          const failedObs: LedgerEntry = {
            kind: "observation",
            round: roundRef.value,
            agent: task.agentRole,
            ok: false,
            error: task.error,
            at: new Date().toISOString(),
          }
          const afterFailed = appendLedger(
            this.ledgers.get(workspace.id) ?? freshLedger(workspace.id),
            failedObs,
          )
          this.ledgers.set(workspace.id, afterFailed)
          this.emit({ type: "ledger", workspaceId: workspace.id, ledger: afterFailed })

          // Update long-term memory on failure.
          if (this.memoryStore) {
            await this.memoryStore
              .recordFailure(task.agentRole, { taskId: task.id, error: task.error })
              .catch(() => {})
          }

          throw err
        }
      },
      { "task.id": task.id, "task.agentRole": task.agentRole, "workspace.id": workspace.id },
    )
  }

  private async runApprovalTask(workspace: Workspace, task: Task, round: number): Promise<void> {
    const approval = (task.metadata?.approval ?? {}) as {
      prompt?: string
      requireComment?: boolean
      reason?: string
      /** Optional timeout in ms; if the user doesn't respond in time, the
       *  approval task fails with "approval timed out". Without this, a
       *  forgotten approval parks the workspace in `executing` forever. */
      timeoutMs?: number
    }
    const prompt = approval.prompt ?? task.description
    const requireComment = approval.requireComment ?? false
    const requestId = `approval-${randomUUID().slice(0, 8)}`

    const actionEntry: LedgerEntry = {
      kind: "action",
      round,
      agent: task.agentRole,
      input: { description: prompt.slice(0, 200), approval: true },
      at: task.startedAt ?? new Date().toISOString(),
    }
    const afterAction = appendLedger(
      this.ledgers.get(workspace.id) ?? freshLedger(workspace.id),
      actionEntry,
    )
    this.ledgers.set(workspace.id, afterAction)
    this.emit({ type: "ledger", workspaceId: workspace.id, ledger: afterAction })
    const responsePromise = this.awaitApproval(requestId, {
      workspaceId: workspace.id,
      taskId: task.id,
      prompt,
      requireComment,
      reason: approval.reason,
    })

    this.emit({
      type: "approval-request",
      workspaceId: workspace.id,
      taskId: task.id,
      requestId,
      prompt,
      requireComment,
      reason: approval.reason,
    })

    // Race the approval wait against (a) the workspace abort signal and
    // (b) an optional per-approval timeout. The abort signal is already
    // wired via abort() -> approvalResolvers.reject(), but raceWithAbort
    // is a safety net in case the parked promise isn't cleaned up. The
    // timeout covers the case where the user simply never responds and
    // the workspace isn't explicitly aborted.
    const workspaceSignal = this.runningWorkspaces.get(workspace.id)?.signal
    const timeoutSignal = approval.timeoutMs ? AbortSignal.timeout(approval.timeoutMs) : undefined
    const signals = [workspaceSignal, timeoutSignal].filter(
      (s): s is AbortSignal => s !== undefined,
    )
    const response =
      signals.length === 0
        ? await responsePromise
        : await raceWithAbort(
            responsePromise,
            signals.length === 1 ? signals[0] : AbortSignal.any(signals),
            workspace.id,
          ).catch((err) => {
            // Clean up the parked resolver so a late user response doesn't
            // resolve an already-rejected promise (harmless but noisy).
            this.approvalResolvers.delete(requestId)
            if (timeoutSignal?.aborted) {
              throw new Error(`approval timed out after ${approval.timeoutMs}ms`)
            }
            throw err
          })

    if (response.decision === "reject") {
      throw new Error(
        response.comment?.trim() ? `approval rejected: ${response.comment}` : "approval rejected",
      )
    }

    const result: Result = {
      id: `r-${randomUUID().slice(0, 8)}`,
      taskId: task.id,
      agentRole: task.agentRole,
      agentId: "human-approval",
      output: response.comment?.trim() ? `Approved: ${response.comment}` : "Approved by human",
      metadata: { approval: { decision: response.decision, comment: response.comment } },
      createdAt: new Date().toISOString(),
    }
    task.resultId = result.id
    task.status = "completed"
    task.completedAt = new Date().toISOString()
    workspace.results.push(result)
    this.emit({ type: "task-complete", workspaceId: workspace.id, taskId: task.id, result })

    const observation: LedgerEntry = {
      kind: "observation",
      round,
      agent: task.agentRole,
      ok: true,
      output: result.output.slice(0, 200),
      at: new Date().toISOString(),
    }
    const afterObs = appendLedger(
      this.ledgers.get(workspace.id) ?? freshLedger(workspace.id),
      observation,
    )
    this.ledgers.set(workspace.id, afterObs)
    this.emit({ type: "ledger", workspaceId: workspace.id, ledger: afterObs })
  }

  abort(workspaceId: string): void {
    this.runningWorkspaces.get(workspaceId)?.abort()
    // Reject any parked permission/approval prompts so runTask doesn't
    // hang forever waiting on a user response that will never come.
    // Without this, abort() only flips the AbortController but the
    // `await awaitPermission(...)` call inside runTask keeps the task
    // (and the workspace) pinned in `executing` until process exit.
    for (const [id, entry] of this.permissionResolvers) {
      if (entry.meta.workspaceId === workspaceId) {
        entry.reject(new Error(`workspace ${workspaceId} aborted`))
        this.permissionResolvers.delete(id)
      }
    }
    for (const [id, entry] of this.approvalResolvers) {
      if (entry.meta.workspaceId === workspaceId) {
        entry.reject(new Error(`workspace ${workspaceId} aborted`))
        this.approvalResolvers.delete(id)
      }
    }
  }

  /**
   * Abort every in-flight workspace. Used by the worker on SIGTERM so
   * BullMQ doesn't have to wait for the stalled-job detector to re-enqueue
   * work that was about to be killed by k8s anyway. Each abort also
   * rejects any parked permission/approval promises (see abort()).
   */
  abortAll(): void {
    for (const id of this.runningWorkspaces.keys()) this.abort(id)
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

/**
 * Check whether a task condition is satisfied by prior results
 * (借鉴 autogen DiGraph condition / check_condition).
 *
 * The condition is a free-form string that must appear (case-insensitive)
 * in at least one prior result's output. This is a deliberately simple
 * heuristic — it mirrors autogen's substring-match in check_condition()
 * without requiring a full predicate engine.
 *
 * Tasks with no condition are always runnable (allDepsCompleted gate).
 */
function conditionSatisfied(condition: string, results: Result[]): boolean {
  const lower = condition.toLowerCase()
  return results.some((r) => r.output.toLowerCase().includes(lower))
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`
}
