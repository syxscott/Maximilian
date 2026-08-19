/**
 * Phase — abstract phase lifecycle (借鉴 ChatDev ChatChain Phase).
 *
 * ChatDev's ChatChain divides the software-development lifecycle into
 * named phases (Intake, Plan, Implement, Review, Finalize). Each phase
 * has a role, input/output schemas, an optional gate function that must
 * pass before advancing, and a run function that produces an output.
 *
 * Maximilian adapts this with:
 *  - PhaseContext: per-phase mutable state, artifacts, and conversation
 *  - Phase: the static manifest (id, name, roles, schemas)
 *  - PhaseRunner: state machine that sequences phases and evaluates gates
 *  - PhaseVerdict: outcome of a gate evaluation
 *
 * @see https://github.com/OpenBMB/ChatDev/blob/main/chatdev/chat_chain.py
 */

import { EventBus } from "./event-bus.js"
import { performance } from "perf_hooks"

// ── Types ─────────────────────────────────────────────────────────────────────

export type PhaseVerdict = "pass" | "fail" | "retry" | "skip"

/**
 * Artifact produced by a phase (e.g., a plan document, a file, a review report).
 */
export interface Artifact {
  id: string
  phaseId: string
  name: string
  content: string
  createdAt: string
  metadata?: Record<string, unknown>
}

/**
 * Chat message stored within a phase context.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  name?: string
  toolCallId?: string
}

/**
 * Per-phase mutable execution context. Passed to both gate() and run().
 */
export interface PhaseContext<S = unknown> {
  workspaceId: string
  phaseId: string
  /** Phase-local mutable state (e.g., collected feedback, vote tally). */
  state: S
  /** Artifacts produced so far in this phase. */
  artifacts: Artifact[]
  /** Conversation history within this phase. */
  messages: ChatMessage[]
  /** The role currently executing (e.g., "architect", "backend"). */
  role: string
  startTime: Date
  /** Abort signal for cancellation. */
  signal?: AbortSignal
}

/**
 * Phase manifest — static metadata plus the gate and run functions.
 */
export interface Phase<S = unknown, R = unknown> {
  id: string
  name: string
  description: string
  /** Roles required to execute this phase. */
  roles: string[]
  /** JSON Schema for the input passed to run(). */
  inputSchema: Record<string, unknown>
  /** JSON Schema for the output produced by run(). */
  outputSchema: Record<string, unknown>
  /**
   * Phase gate — evaluated after run() to decide whether to advance.
   * Return 'pass' to continue; 'fail' aborts the sequence; 'retry' re-runs run();
   * 'skip' proceeds without error but does not advance.
   */
  gate?: (ctx: PhaseContext<S>) => Promise<PhaseVerdict>
  /** Execute the phase and return its result. */
  run(ctx: PhaseContext<S>): Promise<R>
  /** Milliseconds before run() is considered hung. Default: no timeout. */
  timeout?: number
}

/** Result of a single phase execution (whether gated or not). */
export interface PhaseResult<S = unknown, R = unknown> {
  phaseId: string
  verdict: PhaseVerdict
  output: R | undefined
  durationMs: number
  /** Error message from the phase's run() method (phase exception → verdict 'fail'). */
  phaseError?: string
  /** Error message from the gate function (gate failure → runner throws). */
  gateError?: string
  /** Final state after run() + gate() (useful for the next phase). */
  finalState: S
  /** Artifacts produced in this phase. */
  artifacts: Artifact[]
  /** Messages produced in this phase. */
  messages: ChatMessage[]
}

/** Built-in phase IDs. */
export const BUILT_IN_PHASES = {
  INTAKE: "intake",
  PLAN: "plan",
  IMPLEMENT: "implement",
  REVIEW: "review",
  FINALIZE: "finalize",
} as const

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum retry attempts for a 'retry' verdict. */
const MAX_RETRIES = 2

/** Default gate implementation — always returns 'pass'. */
export async function defaultGate<S>(_ctx: PhaseContext<S>): Promise<PhaseVerdict> {
  return "pass"
}

// ── PhaseRunner ─────────────────────────────────────────────────────────────

/** Event emitted by PhaseRunner. Includes workspaceId so multiple runners on one EventBus are distinguishable. */
export type PhaseEvent =
  | { type: "phase:start"; workspaceId: string; phaseId: string; turn: number }
  | { type: "phase:end"; workspaceId: string; phaseId: string; turn: number; verdict: PhaseVerdict }
  | { type: "runner:complete"; workspaceId: string; terminalReason: "completed" | "skipped" | "failed" | "error"; phaseCount: number; totalDurationMs: number }
  | { type: "runner:error"; workspaceId: string; phaseId: string; error: string }

/**
 * State-machine runner that sequences an array of Phases.
 *
 * Usage:
 * ```
 * const runner = new PhaseRunner([intakePhase, planPhase, implementPhase], ctx, eventBus)
 * const results = await runner.run()
 * ```
 */
export class PhaseRunner<S = unknown> {
  private readonly phases: Phase<S>[]
  private readonly ctx: PhaseContext<S>
  private readonly eventBus: EventBus<PhaseEvent>
  private readonly history: PhaseResult[] = []
  /** undefined before run() is called; then 0..N as phases execute. */
  private currentPhaseIdx: number | undefined = undefined
  /** Start time of the entire run, set on first run(). */
  private runStartMs: number | undefined = undefined
  /** Retry counter for the current phase (resets on advance). */
  private retryCount = 0

  constructor(phases: Phase<S>[], ctx: PhaseContext<S>, eventBus: EventBus<PhaseEvent>) {
    if (!Array.isArray(phases) || phases.length === 0) {
      throw new Error("PhaseRunner requires a non-empty array of phases")
    }
    if (!phases.every((p) => typeof p?.id === "string" && p.id.length > 0)) {
      throw new Error("All phases must have a non-empty string id")
    }
    if (!ctx || typeof ctx !== "object") {
      throw new Error("PhaseRunner requires a valid PhaseContext")
    }
    if (typeof ctx.workspaceId !== "string" || ctx.workspaceId.length === 0) {
      throw new Error("PhaseRunner PhaseContext must have a non-empty workspaceId")
    }
    this.phases = phases
    this.ctx = ctx
    this.eventBus = eventBus
  }

  /**
   * Execute all phases in sequence and return every PhaseResult.
   * The sequence stops early if a gate returns 'fail' (throws),
   * a 'skip' verdict (break), or a terminal 'fail' from phase exception.
   */
  async run(): Promise<PhaseResult[]> {
    if (this.runStartMs === undefined) this.runStartMs = performance.now()
    return this.runUntil(this.phases[this.phases.length - 1]!.id)
  }

  /**
   * Execute phases up to and including `phaseId`.
   * Throws if a gate returns 'fail'.
   */
  async runUntil(phaseId: string): Promise<PhaseResult[]> {
    const targetIdx = this.phases.findIndex((p) => p.id === phaseId)
    if (targetIdx < 0) throw new Error(`Phase "${phaseId}" not found`)

    // Initialize index and run timer on first run.
    if (this.currentPhaseIdx === undefined) {
      this.currentPhaseIdx = 0
      this.runStartMs = performance.now()
    }

    // Reject backward targets — caller asked for a phase that already ran.
    if (this.currentPhaseIdx > targetIdx) {
      await this.eventBus.publishAsync({
        type: "runner:complete",
        workspaceId: this.ctx.workspaceId,
        terminalReason: "completed",
        phaseCount: this.history.length,
        totalDurationMs: Math.round(performance.now() - (this.runStartMs ?? performance.now())),
      })
      return this.history
    }

    while (this.currentPhaseIdx <= targetIdx) {
      // Execute phase. Throws on phase exception or gate failure.
      const result = await this.executePhase(this.currentPhaseIdx)

      // Gate threw an exception → throw immediately (don't advance).
      if (result.gateError) {
        await this.eventBus.publishAsync({
          type: "runner:error",
          workspaceId: this.ctx.workspaceId,
          phaseId: result.phaseId,
          error: result.gateError,
        })
        throw new Error(`Phase "${result.phaseId}" gate threw: ${result.gateError}`)
      }

      // Phase exception returned as 'fail' with phaseError → throw immediately.
      if (result.phaseError) {
        await this.eventBus.publishAsync({
          type: "runner:error",
          workspaceId: this.ctx.workspaceId,
          phaseId: result.phaseId,
          error: result.phaseError,
        })
        throw new Error(`Phase "${result.phaseId}" threw: ${result.phaseError}`)
      }

      // 'retry' verdict → re-run the same phase (bounded by MAX_RETRIES).
      if (result.verdict === "retry") {
        this.retryCount++
        if (this.retryCount > MAX_RETRIES) {
          await this.eventBus.publishAsync({
            type: "runner:error",
            workspaceId: this.ctx.workspaceId,
            phaseId: result.phaseId,
            error: `Phase "${result.phaseId}" retry exceeded max retries (${MAX_RETRIES})`,
          })
          throw new Error(`Phase "${result.phaseId}" retry verdict exceeded ${MAX_RETRIES} attempts`)
        }
        // Index is NOT incremented — retry stays at the same phase.
        continue
      }

      // Store result AFTER all checks so index is still pointing at this phase.
      this.history.push(result)

      // Gate returned 'fail' verdict (no phaseError → gate failure, not exception) → throw.
      if (result.verdict === "fail" && !result.phaseError) {
        await this.eventBus.publishAsync({
          type: "runner:error",
          workspaceId: this.ctx.workspaceId,
          phaseId: result.phaseId,
          error: `Phase "${result.phaseId}" gate returned 'fail'`,
        })
        throw new Error(`Phase "${result.phaseId}" gate returned 'fail'`)
      }

      // 'skip' verdict → stop sequence early.
      if (result.verdict === "skip") {
        await this.eventBus.publishAsync({
          type: "runner:complete",
          workspaceId: this.ctx.workspaceId,
          terminalReason: "skipped",
          phaseCount: this.history.length,
          totalDurationMs: Math.round(performance.now() - (this.runStartMs ?? performance.now())),
        })
        return this.history
      }

      // Advance to next phase only after successfully passing.
      this.currentPhaseIdx++
      this.retryCount = 0
    }

    await this.eventBus.publishAsync({
      type: "runner:complete",
      workspaceId: this.ctx.workspaceId,
      terminalReason: "completed",
      phaseCount: this.history.length,
      totalDurationMs: Math.round(performance.now() - (this.runStartMs ?? performance.now())),
    })
    return this.history
  }

  /** The currently-executing phase, or null if run() has not been called. */
  currentPhase(): Phase<S> | null {
    if (this.currentPhaseIdx === undefined) return null
    return this.phases[this.currentPhaseIdx] ?? null
  }

  /** All PhaseResults collected so far. Returns defensive deep-cloned copies. */
  getHistory(): ReadonlyArray<PhaseResult<S, unknown>> {
    return this.history.map((r): PhaseResult<S, unknown> => {
      const cloned: PhaseResult<S, unknown> = {
        phaseId: r.phaseId,
        verdict: r.verdict,
        output: r.output,
        durationMs: r.durationMs,
        finalState: deepClone(r.finalState) as S,
        artifacts: r.artifacts.map(deepClone),
        messages: r.messages.map(deepClone),
        ...(r.phaseError !== undefined ? { phaseError: r.phaseError } : {}),
        ...(r.gateError !== undefined ? { gateError: r.gateError } : {}),
      }
      return Object.freeze(cloned)
    })
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async executePhase(phaseIdx: number): Promise<PhaseResult<S, unknown>> {
    const phase = this.phases[phaseIdx]!
    const startMs = performance.now()

    // Validate timeout — must be a finite positive number.
    const timeoutMs =
      phase.timeout !== undefined
        ? Number.isFinite(phase.timeout) && phase.timeout > 0
          ? phase.timeout
          : phase.timeout <= 0
            ? undefined // 0/negative → no timeout (preserve original contract)
            : undefined // NaN → no timeout
        : undefined

    await this.eventBus.publishAsync({ type: "phase:start", workspaceId: this.ctx.workspaceId, phaseId: phase.id, turn: phaseIdx })

    // Snapshot state before phase runs — used to restore on timeout or gate failure.
    let stateBeforePhase: S | undefined
    try {
      stateBeforePhase = structuredClone(this.ctx.state)
    } catch {
      // structuredClone can fail on functions, WeakMaps, Symbols, etc.
      // Fall back to the original state — caller must ensure state is cloneable.
      stateBeforePhase = this.ctx.state
    }

    // AbortController for cooperative cancellation.
    const abortController = new AbortController()

    // Build a phase-specific context.
    const phaseCtx: PhaseContext<S> = {
      ...this.ctx,
      phaseId: phase.id,
      state: this.ctx.state,
      artifacts: [],
      messages: [],
      startTime: new Date(),
      signal: abortController.signal,
    }

    let output: unknown
    let phaseError: string | undefined

    // ── Run phase with timeout ──────────────────────────────────────────────

    try {
      const runPromise = timeoutMs !== undefined
        ? this.withTimeout(phase.run(phaseCtx), timeoutMs, phase.id, abortController)
        : phase.run(phaseCtx)
      output = await runPromise
    } catch (err) {
      phaseError = err instanceof Error ? err.message : String(err)
      // Restore state to prevent post-error writes from polluting shared state.
      if (stateBeforePhase !== undefined) {
        this.ctx.state = stateBeforePhase
      }
      const verdict: PhaseVerdict = "fail"
      const durationMs = Math.max(0, performance.now() - startMs)
      const clonedState = cloneOrUse<S>(stateBeforePhase, this.ctx.state)
      await this.eventBus.publishAsync({ type: "phase:end", workspaceId: this.ctx.workspaceId, phaseId: phase.id, turn: phaseIdx, verdict })
      return makePhaseResult(phase, verdict, output, durationMs, phaseError, undefined, clonedState, phaseCtx.artifacts, phaseCtx.messages)
    }

    // ── Gate evaluation (also with timeout) ────────────────────────────────

    let verdict: PhaseVerdict = "pass"
    let gateError: string | undefined

    if (phase.gate) {
      try {
        // Gate also respects the same timeout as the phase.
        const gatePromise = timeoutMs !== undefined
          ? this.withTimeout(Promise.resolve(phase.gate(phaseCtx)), timeoutMs, `${phase.id}:gate`, abortController)
          : phase.gate(phaseCtx)
        verdict = await gatePromise
      } catch (err) {
        verdict = "fail"
        gateError = err instanceof Error ? err.message : String(err)
      }
    }

    // On gate failure, restore state as if this phase never ran.
    if (verdict === "fail" || verdict === "skip") {
      if (stateBeforePhase !== undefined) {
        this.ctx.state = stateBeforePhase
      }
    }

    const durationMs = Math.max(0, performance.now() - startMs)
    // Clone finalState to prevent temporal mutation of history entries.
    // For 'fail' / 'skip' verdicts the runner restored `this.ctx.state` to
    // stateBeforePhase above, so the canonical "state after the verdict was
    // applied" is stateBeforePhase. For 'pass' the phase's mutations stand
    // and `phaseCtx.state` is the post-phase snapshot.
    const clonedState =
      verdict === "fail" || verdict === "skip"
        ? cloneOrUse<S>(stateBeforePhase, phaseCtx.state)
        : cloneOrUse<S>(phaseCtx.state, stateBeforePhase)
    await this.eventBus.publishAsync({ type: "phase:end", workspaceId: this.ctx.workspaceId, phaseId: phase.id, turn: phaseIdx, verdict })
    return makePhaseResult(phase, verdict, output, durationMs, phaseError, gateError, clonedState, phaseCtx.artifacts, phaseCtx.messages)
  }

  /**
   * Wraps a promise with a timeout. If the timeout fires, the AbortController
   * is signalled and the promise is rejected. The underlying promise continues
   * running in the background — cooperative cancellation via `signal` is the
   * responsibility of the phase/gate implementation.
   */
  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
    abortController: AbortController,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        abortController.abort()
        reject(new Error(`"${label}" timed out after ${ms}ms`))
      }, ms)
      promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (reason) => {
          clearTimeout(timer)
          reject(reason)
        },
      )
    })
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Creates a PhaseResult with only present keys (respects exactOptionalPropertyTypes).
 */
function makePhaseResult<S, R>(
  phase: Phase<S, R>,
  verdict: import("./phase.js").PhaseVerdict,
  output: R | undefined,
  durationMs: number,
  phaseError: string | undefined,
  gateError: string | undefined,
  finalState: S,
  artifacts: import("./phase.js").Artifact[],
  messages: import("./phase.js").ChatMessage[],
): import("./phase.js").PhaseResult<S, R> {
  const result: import("./phase.js").PhaseResult<S, R> = {
    phaseId: phase.id,
    verdict,
    output,
    durationMs,
    finalState,
    artifacts,
    messages,
  }
  if (phaseError !== undefined) result.phaseError = phaseError
  if (gateError !== undefined) result.gateError = gateError
  return result
}

/**
 * Deep-clones a value. Falls back to the original on failure.
 */
function deepClone<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

/**
 * Returns a deep clone of `preferred` if it differs from `fallback`,
 * otherwise returns `fallback` (avoids unnecessary cloning when state didn't change).
 */
function cloneOrUse<S>(preferred: S | undefined, fallback: S): S {
  if (preferred === undefined) return fallback
  try {
    const cloned = structuredClone(preferred)
    // If cloning produced the same reference (e.g. frozen primitives), skip re-cloning.
    return Object.is(preferred, cloned) ? fallback : cloned
  } catch {
    return fallback
  }
}
