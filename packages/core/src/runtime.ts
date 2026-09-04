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
import { withSpan, getLogger, opencodeSessionsLeakedTotal } from "@max/telemetry"
import { OpencodeExecutor } from "./opencode-executor.js"

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
import type { BaseCheckpointSaver } from "./checkpoint/saver.js"
import type { Checkpoint } from "./checkpoint/saver.js"
import { SelfCritique } from "./self-critique.js"
import { TaskPrioritizer } from "./task-prioritizer.js"
import { RuntimeInterrupt } from "./runtime-interrupt.js"
import type { TaskPriority } from "./types.js"
import type { ChannelValues, ConfigurableDict } from "./types.js"

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

/**
 * Runtime command for resuming from an interrupt (借鉴 LangGraph Command).
 * @see https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint/langgraph/checkpoint/base/__init__.py
 */
export type RuntimeCommand =
  | { kind: "resume"; value: unknown }
  | { kind: "update"; patch: Partial<ChannelValues> }
  | { kind: "goto"; nodeId: string }
  | { kind: "interrupt"; reason: string; payload?: unknown }

/**
 * Result of a self-critique observation (借鉴 AutoGPT self-critique).
 * @see https://github.com/Significant-Gravitas/AutoGPT/blob/master/autogpt/prompts/prompt.py
 */
export interface SelfCritiqueResult {
  useful: boolean
  /** Quality score 0-10. Scores < 3 trigger replan. */
  score: number
  /** Brief explanation of the score. */
  reason: string
  /** Up to 3 concrete suggestions for improvement. */
  suggestions?: string[]
  /** The text that was critiqued (passed to `observe`). */
  outputText?: string
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
      /** Raw tool call input (when known) — powers the dashboard's
       *  embedded diff preview on the approval card. */
      input?: unknown
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
  | {
      type: "steering-applied"
      workspaceId: string
      /** Steering messages drained at this wave boundary (pi borrowing). */
      messages: import("./steering.js").SteeringMessage[]
      /** Task ids whose instructions were augmented this wave. */
      taskIds: string[]
    }
  | {
      type: "followup-pending"
      workspaceId: string
      /** Followup messages left after the run finished — caller should start a new cycle. */
      messages: import("./steering.js").SteeringMessage[]
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
  /**
   * 借鉴 opencode - Use the opencode serve sidecar as the LLM/tool kernel.
   * When set, every agent task is submitted to opencode via
   * {@link OpencodeExecutor} instead of running in-process. Requires
   * a reachable `opencode serve` at `baseUrl` (see `@max/core-thin-sdk`
   * Supervisor for process management).
   */
  opencode?: {
    baseUrl: string
    /** Use a fixed workspaceId for all tasks (default: workspace.id) */
    workspaceId?: string
  }
  /**
   * Optional checkpoint saver for time-travel debugging and workspace forking.
   * When provided, the runtime snapshots state after each wave, enabling
   * getHistory(), rewindTo(), and forkFrom(). Without this, those methods
   * throw (checkpointing is a no-op).
   */
  checkpointSaver?: BaseCheckpointSaver
  /**
   * Optional self-critique module. When provided, the runtime observes
   * each tool-end event and uses the critique to inform stall detection
   * and re-planning. See SelfCritique class (借鉴 AutoGPT).
   */
  selfCritique?: SelfCritique
  /**
   * Optional task prioritizer for dynamic task re-ordering between waves.
   * When provided, each wave's end calls TaskPrioritizer.reRank() to
   * adapt the pending task order based on recent results (借鉴 AutoGPT).
   */
  taskPrioritizer?: TaskPrioritizer
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

/**
 * Read the preflight result stashed by `OpencodeDecomposer.decompose()`
 * on `task.metadata.preflightResult`. Returns `null` if the metadata
 * is absent or malformed; callers should treat `null` as "no cache hit,
 * run normally". The shape mirrors what `OpencodeExecutor.executeTask`
 * writes so the runtime can hydrate a `Result` from either source.
 */
interface PreflightCache {
  sessionId: string
  executor: string
  durationMs: number
  outputPreview: string
}
function readPreflightResult(metadata: unknown): PreflightCache | null {
  if (!metadata || typeof metadata !== "object") return null
  const m = metadata as Record<string, unknown>
  const r = m.preflightResult
  if (!r || typeof r !== "object") return null
  const obj = r as Record<string, unknown>
  if (
    typeof obj.sessionId !== "string" ||
    typeof obj.executor !== "string" ||
    typeof obj.durationMs !== "number" ||
    typeof obj.outputPreview !== "string"
  ) {
    return null
  }
  return {
    sessionId: obj.sessionId,
    executor: obj.executor,
    durationMs: obj.durationMs,
    outputPreview: obj.outputPreview,
  }
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
  private checkpointSaver?: BaseCheckpointSaver
  private selfCritique?: SelfCritique
  private taskPrioritizer?: TaskPrioritizer
  /** Per-workspace critique result history, cleared on each new workspace execution. */
  private critiqueHistory = new Map<string, SelfCritiqueResult[]>()
  /** Interrupt resolvers keyed by workspaceId. */
  private interruptResolvers = new Map<string, (command: RuntimeCommand) => void>()
  /** The currently active interrupt for a workspace (if interrupted). */
  private activeInterrupt = new Map<string, RuntimeInterrupt>()
  /**
   * 借鉴 opencode - When set, tasks are routed through opencode serve.
   * Lazily created from RuntimeOptions.opencode on first use.
   */
  private opencodeExecutor?: OpencodeExecutor
  /** Steering message queues per workspace (借鉴 pi). */
  private steeringQueues = new Map<string, import("@max/providers").ChatMessage[]>()
  /** Follow-up message queues per workspace (借鉴 pi). */
  private followUpQueues = new Map<string, import("@max/providers").ChatMessage[]>()

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
    this.checkpointSaver = options?.checkpointSaver
    this.selfCritique = options?.selfCritique
    this.taskPrioritizer = options?.taskPrioritizer
    if (options?.opencode) {
      this.opencodeExecutor = new OpencodeExecutor({
        baseUrl: options.opencode.baseUrl,
      })
    } else {
      // Phase 4a (in-process LLM removal) — surface a one-shot deprecation
      // warning so callers that haven't migrated to opencode see a
      // visible signal. The in-process paths below still work for now
      // (tests + legacy callers rely on them), but a future phase will
      // make `opencode.baseUrl` required and delete the `toolProvider` /
      // `agent.execute` branches.

      console.warn(
        "[AgentRuntime] RuntimeOptions.opencode is not set — running in " +
          "legacy in-process mode. This is deprecated and will be removed " +
          "in a future release. Configure `opencode: { baseUrl }` to migrate.",
      )
    }
  }

  on(listener: RuntimeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Public emit — for non-Runtime code (e.g. tool loop) to surface tool.* events. */
  emitEvent(event: RuntimeEvent): void {
    this.emit(event)
  }

  /** Steering hook: called before each tool-loop iteration to inject pending messages (借鉴 pi). */
  getSteeringMessages() {
    const queue = this.steeringQueues.get(this._currentWorkspaceId ?? "") ?? []
    this.steeringQueues.set(this._currentWorkspaceId ?? "", [])
    return queue
  }

  /** Follow-up hook: called after tool-loop natural exit to queue follow-up work (借鉴 pi). */
  getFollowUpMessages() {
    const queue = this.followUpQueues.get(this._currentWorkspaceId ?? "") ?? []
    this.followUpQueues.set(this._currentWorkspaceId ?? "", [])
    return queue
  }

  private _currentWorkspaceId?: string

  /**
   * Enqueue steering messages for a workspace (借鉴 pi outer/inner loop).
   * Call this while the agent is running to inject messages before the next turn.
   */
  enqueueSteeringMessages(
    workspaceId: string,
    messages: import("@max/providers").ChatMessage[],
  ): void {
    const existing = this.steeringQueues.get(workspaceId) ?? []
    this.steeringQueues.set(workspaceId, [...existing, ...messages])
  }

  /**
   * Enqueue follow-up messages for a workspace (借鉴 pi outer/inner loop).
   * Call this after the agent naturally stops to continue with additional work.
   */
  enqueueFollowUpMessages(
    workspaceId: string,
    messages: import("@max/providers").ChatMessage[],
  ): void {
    const existing = this.followUpQueues.get(workspaceId) ?? []
    this.followUpQueues.set(workspaceId, [...existing, ...messages])
  }

  /**
   * Park the current tool-loop iteration until the user (via the API)
   * answers a `PermissionRequestError`. The loop calls this after emitting
   * the `permission-request` event; the API calls `resolvePermission` once
   * the user picks allow/deny. Returns a promise that resolves with the
   * user's decision.
   *
   * If a request with the same id is awaited twice, the second call throws
   * — refusing the duplicate prevents an unbounded linked list of resolvers
   * from forming on tight retry loops. Matches `awaitApproval`'s contract.
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

  // ── Interrupt / Resume ────────────────────────────────────────────────────

  /**
   * Interrupt a workspace execution (借鉴 LangGraph interrupt).
   * Throws a RuntimeInterrupt that can be caught by the caller's outer loop.
   * Use `resume(workspaceId, command)` to continue execution.
   *
   * @param workspaceId - Target workspace
   * @param reason - Human-readable reason for the interrupt
   * @param payload - Optional opaque payload attached to the interrupt
   * @throws RuntimeInterrupt - always thrown; never returns normally
   */
  interrupt(workspaceId: string, reason: string, payload?: unknown): never {
    const interrupt_ = new RuntimeInterrupt(reason, payload)
    this.activeInterrupt.set(workspaceId, interrupt_)
    let resolvePromise: (command: RuntimeCommand) => void = () => {}
    const p = new Promise<RuntimeCommand>((resolve) => {
      resolvePromise = resolve
    })
    this.interruptResolvers.set(workspaceId, resolvePromise)
    p.catch(() => {}) // Avoid unhandled rejection in case resume is never called
    throw interrupt_
  }

  /**
   * Resume a workspace from an interrupt (借鉴 LangGraph resume).
   * The workspace must currently be in an interrupted state (i.e. a prior
   * call to `interrupt(workspaceId, ...)` was made and caught).
   *
   * @param workspaceId - Target workspace
   * @param command - The RuntimeCommand to apply on resume
   */
  async resume(workspaceId: string, command: RuntimeCommand): Promise<void> {
    // Verify the workspace is actually in an interrupted state
    if (!this.activeInterrupt.has(workspaceId)) {
      throw new Error(`workspace ${workspaceId} is not in an interrupted state`)
    }
    const resolver = this.interruptResolvers.get(workspaceId)
    if (!resolver) {
      // This shouldn't happen if activeInterrupt is set, but guard against it
      throw new Error(`workspace ${workspaceId} has no resolver (inconsistent state)`)
    }
    this.interruptResolvers.delete(workspaceId)
    this.activeInterrupt.delete(workspaceId)
    resolver(command)
  }

  // ── Checkpoint / Time-travel ──────────────────────────────────────────────

  /**
   * Get the checkpoint history for a workspace (借鉴 LangGraph getCBT).
   * Returns all checkpoints ordered newest-first. Useful for time-travel
   * debugging and displaying execution history in the UI.
   *
   * @param workspaceId - Workspace/thread to get history for
   * @returns Array of Checkpoint tuples (newest first), or empty if no checkpoints
   */
  async getHistory(workspaceId: string): Promise<Checkpoint[]> {
    if (!this.checkpointSaver) {
      throw new Error("checkpointSaver not configured")
    }
    const tuples = await this.checkpointSaver.list({ thread_id: workspaceId })
    return tuples.map((t) => t.checkpoint)
  }

  /**
   * Rewind a workspace to a previous checkpoint (借鉴 LangGraph rewind).
   * Loads the channel values from the target checkpoint and replaces the
   * current workspace state. Pending tasks are rebuilt from the checkpoint's
   * channel values if a `tasks` key is present.
   *
   * @param workspaceId - Workspace to rewind
   * @param checkpointId - Checkpoint to rewind to
   */
  async rewindTo(workspaceId: string, checkpointId: string): Promise<void> {
    if (!this.checkpointSaver) {
      throw new Error("checkpointSaver not configured")
    }
    const tuple = await this.checkpointSaver.get({
      thread_id: workspaceId,
      checkpoint_id: checkpointId,
    })
    if (!tuple) {
      throw new Error(`checkpoint ${checkpointId} not found for workspace ${workspaceId}`)
    }
    // Reload workspace state from checkpoint channel values
    const ws = await this.sink.loadWorkspace(workspaceId)
    // 修复 Bug11: explicit error when workspace or plan is missing
    if (!ws) {
      throw new Error(`rewindTo: workspace ${workspaceId} not found in sink`)
    }
    const updated: Workspace = {
      ...ws,
      results: (tuple.checkpoint.channelValues["results"] as Result[]) ?? ws.results,
      status: "executing",
      updatedAt: new Date().toISOString(),
    }
    // Restore plan tasks from checkpoint if present
    if (tuple.checkpoint.channelValues["tasks"]) {
      if (!updated.plan) {
        throw new Error(`rewindTo: workspace ${workspaceId} has no plan to restore`)
      }
      updated.plan = {
        ...updated.plan,
        tasks: tuple.checkpoint.channelValues["tasks"] as Task[],
      }
    }
    await this.sink.saveWorkspace(updated)
    // Clear critique history for this workspace since we're rewinding
    this.critiqueHistory.delete(workspaceId)
  }

  /**
   * Fork a workspace to a new workspace id (借鉴 LangGraph fork).
   * Copies the entire checkpoint history from the source to the destination.
   * The new workspace starts in the same state as the source but with a
   * fresh id, allowing parallel exploration of alternate execution paths.
   *
   * @param workspaceId - Source workspace to fork from
   * @param newWorkspaceId - Optional id for the new workspace (generated if omitted)
   * @returns The new workspace id
   */
  async forkFrom(workspaceId: string, newWorkspaceId?: string): Promise<string> {
    if (!this.checkpointSaver) {
      throw new Error("checkpointSaver not configured")
    }
    const forkId = newWorkspaceId ?? `fork-${randomUUID().slice(0, 8)}`
    // 修复 Bug12: create Workspace record in sink before copying checkpoints
    const source = await this.sink.loadWorkspace(workspaceId)
    if (!source) {
      throw new Error(`forkFrom: source workspace ${workspaceId} not found`)
    }
    const forked: Workspace = {
      ...source,
      id: forkId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await this.sink.saveWorkspace(forked)
    await this.checkpointSaver.copyThread({ thread_id: workspaceId }, { thread_id: forkId })
    return forkId
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
    // Guard against concurrent execution of the same workspace: a second
    // _executeImpl would overwrite this.runningWorkspaces[id] (losing the
    // first run's AbortController for abort()/ctx.signal) and both runs'
    // finally blocks would delete each other's bookkeeping. Callers must
    // await or abort() the first run before re-executing. Both production
    // call sites (API chat route, worker) already persist a `failed` state
    // when execute() throws, so the clear error surfaces instead of a
    // silent overwrite.
    if (this.runningWorkspaces.has(workspace.id)) {
      throw new Error(
        `workspace ${workspace.id} already executing — await or abort() the first run before re-executing`,
      )
    }
    this._currentWorkspaceId = workspace.id
    try {
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
        // 修复 Bug9: clean up runningWorkspaces before early return
        this.runningWorkspaces.delete(workspace.id)
        updated.status = "failed"
        updated.error = "No plan attached to workspace"
        await this.sink.saveWorkspace(updated)
        this.emit({ type: "workspace-status", workspaceId: updated.id, status: "failed" })
        this.emit({ type: "done", workspaceId: updated.id, workspace: updated })
        return updated // early return — caught by finally
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

        // Steering safe point (pi borrowing): fold queued mid-flight
        // messages into the still-pending tasks instead of interrupting
        // running ones. This covers tasks that never enter the tool loop —
        // tool-loop tasks are already injected per-iteration via
        // getSteeringMessages().
        {
          const raw = this.steeringQueues.get(updated.id)
          if (raw && raw.length > 0) {
            this.steeringQueues.set(updated.id, [])
            const steeringMsgs = raw.map((m) => ({
              text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
              at: new Date().toISOString(),
            }))
            const addendum = steeringMsgs.map((m) => `[steering] ${m.text}`).join("\n")
            const touched: string[] = []
            for (const t of pending) {
              if (t.status === "pending") {
                t.description = `${t.description}\n\nOperator steering (apply where relevant):\n${addendum}`
                t.metadata = { ...(t.metadata ?? {}), steered: true }
                touched.push(t.id)
              }
            }
            if (touched.length > 0) {
              this.emit({
                type: "steering-applied",
                workspaceId: updated.id,
                messages: steeringMsgs,
                taskIds: touched,
              })
            }
          }
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
              await this.runTask(updated, task, counters, stallDetector)
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

        // ── Per-wave checkpoint & task re-ranking ───────────────────────────

        // Task re-ranking: ask the LLM to reorder remaining tasks based on
        // recent results and the overall goal (借鉴 AutoGPT TaskPrioritizer).
        if (this.taskPrioritizer && remaining.length > 0) {
          try {
            const priorities = await this.taskPrioritizer.reRank(remaining, {
              recentResults: updated.results,
              goal: updated.userRequest,
            })
            if (priorities && priorities.length > 0) {
              // Reorder remaining tasks by priority: high → medium → low
              const priorityOrder = { high: 0, medium: 1, low: 2 }
              const priorityMap = new Map(priorities.map((p) => [p.taskId, p]))
              // Sort by LLM-assigned priority, then by original order for ties
              remaining.sort((a, b) => {
                const pa = priorityMap.get(a.id)
                const pb = priorityMap.get(b.id)
                const ordA = pa ? priorityOrder[pa.priority] : 1
                const ordB = pb ? priorityOrder[pb.priority] : 1
                if (ordA !== ordB) return ordA - ordB
                return 0
              })
              // Apply newScope modifications if the LLM suggested scope changes
              for (const t of remaining) {
                const p = priorityMap.get(t.id)
                if (p?.newScope) {
                  t.description = p.newScope
                }
              }
              log.info(
                { workspaceId: updated.id, newOrder: remaining.map((t) => t.id) },
                "task re-rank applied",
              )
            }
          } catch (err) {
            log.error({ err, workspaceId: updated.id }, "task re-rank failed")
          }
        }

        // 修复 Bug10: save checkpoint AFTER reRank mutation so checkpoint captures post-reRank state
        if (this.checkpointSaver) {
          const checkpointId = `${updated.id}-${roundRef.value.toString().padStart(4, "0")}`
          const channelValues: ChannelValues = {
            results: updated.results,
            tasks: remaining,
            plan: updated.plan,
          }
          const channelVersions: Record<string, number> = {}
          const updatedChannels = ["results", "tasks"]
          const prevCheckpointId = `${updated.id}-${(roundRef.value - 1).toString().padStart(4, "0")}`
          try {
            await this.checkpointSaver.put(
              { thread_id: updated.id, checkpoint_id: checkpointId },
              {
                id: checkpointId,
                parentId: roundRef.value === 1 ? null : prevCheckpointId,
                channelValues,
                channelVersions,
                updatedChannels,
                metadata: {
                  source: "loop" as const,
                  step: roundRef.value,
                },
              },
            )
          } catch (err) {
            log.error({ err, workspaceId: updated.id }, "checkpoint save failed")
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

      // Leftover followups (pi borrowing): the run finished but the user
      // queued "keep going with this" messages. Surface them so the API
      // layer can start a new cycle instead of silently dropping them in
      // the finally-block cleanup.
      const leftoverFollowups = this.followUpQueues.get(workspace.id)
      if (leftoverFollowups && leftoverFollowups.length > 0) {
        this.followUpQueues.delete(workspace.id)
        this.emit({
          type: "followup-pending",
          workspaceId: updated.id,
          messages: leftoverFollowups.map((m) => ({
            text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            at: new Date().toISOString(),
          })),
        })
      }

      await this.sink.saveWorkspace(updated)
      this.emit({ type: "workspace-status", workspaceId: updated.id, status: updated.status })
      this.emit({ type: "done", workspaceId: updated.id, workspace: updated })
      this.runningWorkspaces.delete(workspace.id)
      return updated
    } finally {
      this._currentWorkspaceId = undefined
      // Clean up per-workspace bookkeeping so an exception path (e.g. a
      // failing sink.saveWorkspace) doesn't leak the AbortController or the
      // steering/follow-up queues (which grow unboundedly on long-lived
      // runtimes otherwise).
      //
      // Note: messages enqueued via enqueueSteeringMessages()/
      // enqueueFollowUpMessages() but never drained by the tool loop (e.g. a
      // run that had no tool-enabled provider) are discarded here rather
      // than carried over to the next run of the same workspace. That is
      // intentional — stale steering is more confusing than lost — and it
      // is what bounds memory on long-lived runtimes.
      this.runningWorkspaces.delete(workspace.id)
      this.steeringQueues.delete(workspace.id)
      this.followUpQueues.delete(workspace.id)
    }
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
    stallDetector: StallDetector,
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
        // M4-fix: also capture the selection in `lastSelectionRef` so the
        // post-execute hook can call `modelRouter.recordOutcome()` with
        // success/failure, feeding the health feedback loop that demotes
        // models with sustained failure rates.
        const lastSelectionRef: { key: string | undefined } = { key: undefined }
        if (this.modelRouter) {
          const taskChars = deriveTaskCharacteristics(task)
          const selection = this.modelRouter.selectModel(taskChars)
          agent.setModelOverride(selection.provider, selection.model)
          lastSelectionRef.key = `${selection.provider}/${selection.model}`
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
          workspaceId: workspace.id,
          planId: workspace.plan?.id,
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

          // Ref to capture last tool call info for self-critique observation
          const lastActionRef = { toolName: "", input: undefined as unknown }
          // 借鉴 opencode - when opencode executor is set, route the entire task
          // through the sidecar kernel and return early. This bypasses
          // agent.execute + runToolLoop; opencode handles LLM + tools itself.
          let final: Awaited<ReturnType<typeof agent.submitResult>> | undefined
          if (this.opencodeExecutor) {
            const workspaceId = workspace.id
            // H5-fix: if opencode sidecar is unreachable (connection
            // refused, timeout, 5xx), fall through to the in-process
            // paths below so the task doesn't silently die. We treat
            // opencode as a *preferred* executor, not a hard
            // dependency — until Phase 4 removes the in-process paths.
            let opencodeFailed = false
            try {
              // H4-fix: commander pre-flight already ran this task through
              // opencode and stashed the result in `task.metadata.preflightResult`.
              // Re-running it here means *two* LLM/tool sessions per task,
              // doubling cost and time. When the preflight result is present
              // and well-formed, hydrate a `Result` from it and skip the
              // network call entirely. The shape mirrors what
              // `OpencodeExecutor.executeTask` returns so the rest of the
              // pipeline (self-critique, TruthAudit, etc.) sees identical
              // data regardless of which path produced the result.
              const cached = readPreflightResult(task.metadata)
              if (cached && cached.executor === "opencode") {
                // Hydrate a minimal Result-like object from the cached
                // preflight payload. We deliberately cast through
                // `unknown` because the Result shape includes fields
                // (agentRole / id / agentId / createdAt) that only the
                // agent knows how to populate; the runtime uses `final`
                // for self-critique + TruthAudit, which read metadata
                // and output, not those identity fields. The pipeline
                // treats the cast as a "trust the cache" boundary.
                final = {
                  taskId: task.id,
                  output: cached.outputPreview,
                  metadata: {
                    sessionId: cached.sessionId,
                    executor: "opencode-preflight",
                    durationMs: cached.durationMs,
                    prefetched: true,
                  },
                } as unknown as Awaited<ReturnType<typeof agent.submitResult>>
                lastActionRef.toolName = "opencode-session-preflight"
                lastActionRef.input = { sessionId: cached.sessionId, durationMs: cached.durationMs }
              } else {
                const out = await raceWithAbort(
                  this.opencodeExecutor.executeTask(task, workspaceId),
                  ctx.signal,
                  workspace.id,
                )
                final = out.result
                lastActionRef.toolName = "opencode-session"
                lastActionRef.input = { sessionId: out.sessionId, durationMs: out.durationMs }
              }
              // Skip the in-process execution paths below on success.
              // (fall through to result handling)
            } catch (err) {
              // Distinguish abort from opencode failure: if the runtime
              // was aborted, propagate the abort; otherwise fall back.
              if ((err as Error)?.name === "AbortError" || ctx.signal?.aborted) {
                throw err
              }
              log.warn(
                { err, taskId: task.id, workspaceId },
                "opencode executor failed; falling back to in-process execution",
              )
              opencodeFailed = true
            }
            if (!opencodeFailed && final !== undefined) {
              // Success path — skip in-process execution.
              // (controlled by the opencodeFailed flag)
            } else if (!opencodeFailed) {
              // final is undefined (shouldn't happen if no exception)
              throw new Error("opencode executor returned no result without erroring")
            }
          }
          // In-process fallback (Phase 3): if opencode failed or isn't
          // configured, route through agent's tool loop or plain execute.
          if (final === undefined) {
            if (toolProvider) {
              final = await raceWithAbort(
                runToolLoopAndSubmit(
                  agent,
                  task,
                  ctx,
                  toolProvider,
                  workspace.id,
                  this.emit.bind(this),
                  (requestId, meta) => this.awaitPermission(requestId, meta),
                  lastActionRef,
                  // Pin _currentWorkspaceId before each hook call: the getters
                  // resolve their queue key from that single instance field,
                  // so with concurrent workspaces the last-started one would
                  // otherwise win and steering/follow-up messages would be
                  // cross-read (or silently dropped). The hook bodies are
                  // synchronous (no await between set and read), so this is
                  // atomic under Node's event loop.
                  () => {
                    this._currentWorkspaceId = workspace.id
                    return this.getSteeringMessages()
                  },
                  () => {
                    this._currentWorkspaceId = workspace.id
                    return this.getFollowUpMessages()
                  },
                  undefined, // toolExecution (借鉴 pi)
                  undefined, // beforeToolCall (借鉴 pi)
                  undefined, // afterToolCall (借鉴 pi)
                ),
                ctx.signal,
                workspace.id,
              )
            } else {
              final = await raceWithAbort(
                agent.execute(task, ctx).then((r) => agent.submitResult(r)),
                ctx.signal,
                workspace.id,
              )
            }
          }
          if (!final) {
            throw new Error(
              "agent runtime: no result after executeTask (opencode + in-process both failed silently)",
            )
          }

          // M4-fix: feed the ModelRouter the success signal so sustained
          // failures flip a model's status to "alpha" (downweighted in
          // future selections). Reaching this point means we have a
          // `Result` — the task ran to completion, so count it as a
          // success for the selected model. Failure paths (catch blocks
          // below) record `ok=false` so the demotion math gets the right
          // signal.
          if (this.modelRouter && lastSelectionRef.key) {
            this.modelRouter.recordOutcome(lastSelectionRef.key, true)
          }

          // Self-critique observation: evaluate the last action's quality
          // (借鉴 AutoGPT self-critique — fires after each tool execution).
          if (this.selfCritique && lastActionRef.toolName) {
            const historyTail: ChatMessage[] = []
            const critiqueResult = await this.selfCritique.observe(
              `tool=${lastActionRef.toolName} input=${JSON.stringify(lastActionRef.input).slice(0, 200)}`,
              final.output,
              historyTail,
            )
            // Store critique result for this workspace
            const existing = this.critiqueHistory.get(workspace.id) ?? []
            existing.push(critiqueResult)
            this.critiqueHistory.set(workspace.id, existing)

            // If consecutive low scores, trigger an early stall signal
            // by injecting a "stall suggestion" into the stall detector
            if (this.selfCritique.shouldReplan(existing)) {
              log.warn(
                { workspaceId: workspace.id, lastScore: critiqueResult.score },
                "self-critique score low — signaling early stall",
              )
              stallDetector.observe({ completedTasks: 0, newResults: 0 })
            }
          }

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

          // M4-fix: feed the ModelRouter the failure outcome. We check
          // `lastSelectionRef.key` (captured above when ModelRouter was
          // consulted) so the router's rolling failure counter reflects
          // the same model that *would* have handled this task. If the
          // router wasn't used, this is a no-op.
          if (this.modelRouter && lastSelectionRef.key) {
            this.modelRouter.recordOutcome(lastSelectionRef.key, false)
          }

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
    // Polyfill AbortSignal.timeout for Node < 18.11
    const timeoutSignal = approval.timeoutMs
      ? "timeout" in AbortSignal
        ? AbortSignal.timeout(approval.timeoutMs)
        : (() => {
            const controller = new AbortController()
            setTimeout(() => controller.abort(), approval.timeoutMs)
            return controller.signal
          })()
      : undefined
    const signals = [workspaceSignal, timeoutSignal].filter(
      (s): s is AbortSignal => s !== undefined,
    )
    const response =
      signals.length === 0
        ? await responsePromise
        : await raceWithAbort(
            responsePromise,
            signals.length === 1
              ? signals[0]
              : // Polyfill AbortSignal.any for Node < 20
                "any" in AbortSignal
                ? AbortSignal.any(signals)
                : signals.reduce((acc, s) => {
                    const combined = new AbortController()
                    s.addEventListener("abort", () => combined.abort())
                    acc.addEventListener("abort", () => combined.abort())
                    return combined.signal
                  }),
            workspace.id,
          ).catch((err) => {
            // Clean up the parked resolver so a late user response doesn't
            // resolve an already-rejected promise (harmless but noisy).
            this.approvalResolvers.delete(requestId)
            // M10-fix: emit an `approval-resolved` event so any UI / SSE
            // listener waiting for the answer learns the approval
            // terminated. Previously a timeout or abort would surface as
            // a thrown error inside `runApprovalTask`, but the
            // dashboard's parked approval request would never receive a
            // resolution event — leaving it pinned as "awaiting" until
            // the user manually closed it. We classify the outcome as
            // `denied` because the user never explicitly approved, and
            // include the reason for the dashboard's audit log.
            const reason = timeoutSignal?.aborted
              ? `approval timed out after ${approval.timeoutMs}ms`
              : err instanceof Error
                ? err.message
                : "approval aborted"
            this.emit({
              type: "approval-resolved",
              workspaceId: workspace.id,
              taskId: task.id,
              requestId,
              decision: "reject",
              comment: reason,
            })
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

  /** True while the workspace has an in-flight execution. */
  isExecuting(workspaceId: string): boolean {
    return this.runningWorkspaces.has(workspaceId)
  }

  /**
   * Queue a mid-flight steering message for a running workspace (pi
   * borrowing). Consumed at the next safe point — per tool-loop iteration
   * for tool tasks, or the next wave boundary otherwise. Returns false on
   * an idle workspace (the caller should start a new workspace instead).
   */
  steer(workspaceId: string, text: string, source?: string): boolean {
    if (!this.isExecuting(workspaceId)) return false
    const label = source ? `[steering from ${source}]` : "[steering]"
    this.enqueueSteeringMessages(workspaceId, [{ role: "user", content: `${label} ${text}` }])
    return true
  }

  /**
   * Queue a followup message. Surfaced as a `followup-pending` event when
   * the workspace's current run finishes, so the caller can start a new
   * cycle with the user's continuation attached.
   */
  queueFollowup(workspaceId: string, text: string, source?: string): boolean {
    const label = source ? `[followup from ${source}]` : "[followup]"
    this.enqueueFollowUpMessages(workspaceId, [{ role: "user", content: `${label} ${text}` }])
    return true
  }

  abort(workspaceId: string): void {
    this.runningWorkspaces.get(workspaceId)?.abort()
    // Reject any parked permission/approval prompts so runTask doesn't
    // hang forever waiting on a user response that will never come.
    // Without this, abort() only flips the AbortController but the
    // `await awaitPermission(...)` call inside runTask keeps the task
    // (and the workspace) pinned in `executing` until process exit.
    // Collect keys first, then delete to avoid iterator invalidation issues.
    const permissionKeysToDelete: string[] = []
    for (const [id, entry] of this.permissionResolvers) {
      if (entry.meta.workspaceId === workspaceId) {
        entry.reject(new Error(`workspace ${workspaceId} aborted`))
        permissionKeysToDelete.push(id)
      }
    }
    for (const key of permissionKeysToDelete) {
      this.permissionResolvers.delete(key)
    }

    const approvalKeysToDelete: string[] = []
    for (const [id, entry] of this.approvalResolvers) {
      if (entry.meta.workspaceId === workspaceId) {
        entry.reject(new Error(`workspace ${workspaceId} aborted`))
        approvalKeysToDelete.push(id)
      }
    }
    for (const key of approvalKeysToDelete) {
      this.approvalResolvers.delete(key)
    }

    // Phase 9 — SLO-4: count opencode sessions abandoned by an
    // `abort()` that didn't go through OpencodeExecutor.shutdown().
    // The `runTask` path attaches the workspace's AbortSignal to the
    // executor call (M2-fix), which calls OpencodeSdk.abortSession()
    // server-side. The remaining gap is workspaces aborted by SIGTERM
    // before `shutdown()` runs — every cached pool entry at that
    // moment is a leak. Increment per-cached-session so the SLO
    // dashboard sees the magnitude even if the process exits before
    // flushing Prometheus.
    if (this.opencodeExecutor) {
      const leaked = this.opencodeExecutor.leakedSessionsOnAbort?.(workspaceId) ?? 0
      for (let i = 0; i < leaked; i++) opencodeSessionsLeakedTotal.inc()
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
  /** Optional: record last tool name+input for self-critique observation. */
  lastActionRef?: { toolName: string; input?: unknown },
  getSteeringMessages?: () => import("@max/providers").ChatMessage[],
  getFollowUpMessages?: () => import("@max/providers").ChatMessage[],
  // 借鉴 pi: tool execution modes and before/after hooks
  toolExecution?: import("./types.js").ToolExecutionMode,
  beforeToolCall?: (
    ctx: import("./types.js").BeforeToolCallContext,
  ) => import("./types.js").BeforeToolCallResult | undefined,
  afterToolCall?: (
    ctx: import("./types.js").AfterToolCallContext,
  ) => import("./types.js").AfterToolCallResult | undefined,
): Promise<Result> {
  const messages = agent.buildChatMessages(task, ctx)
  const { response, allToolCalls } = await runToolLoop(toolProvider, messages, {
    emitEvent: emit,
    workspaceId,
    taskId: task.id,
    awaitPermission,
    getSteeringMessages,
    getFollowUpMessages,
    ownedFiles: task.metadata?.ownedFiles as string[] | undefined,
    // 借鉴 pi
    toolExecution,
    beforeToolCall,
    afterToolCall,
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
  // Record last tool info for self-critique observation
  if (lastActionRef) {
    const lastCall = allToolCalls[allToolCalls.length - 1]
    lastActionRef.toolName = lastCall?.name ?? ""
    lastActionRef.input = lastCall?.input
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
