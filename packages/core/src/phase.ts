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

import { EventBus, type SubscriptionHandle } from "./event-bus.js"

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
}

/** Built-in phase IDs. */
export const BUILT_IN_PHASES = {
  INTAKE: "intake",
  PLAN: "plan",
  IMPLEMENT: "implement",
  REVIEW: "review",
  FINALIZE: "finalize",
} as const

// ── Default gate ──────────────────────────────────────────────────────────────

/**
 * Default gate implementation — always returns 'pass'.
 * Subclasses / callers can provide their own gate function.
 */
export async function defaultGate<S>(_ctx: PhaseContext<S>): Promise<PhaseVerdict> {
  return "pass"
}

// ── PhaseRunner ───────────────────────────────────────────────────────────────

/** Event emitted by PhaseRunner. */
export type PhaseEvent =
  | { type: "phase:start"; phaseId: string; turn: number }
  | { type: "phase:end"; phaseId: string; turn: number; verdict: PhaseVerdict }
  | { type: "runner:complete"; results: PhaseResult[] }
  | { type: "runner:error"; phaseId: string; error: string }

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

  constructor(phases: Phase<S>[], ctx: PhaseContext<S>, eventBus: EventBus<PhaseEvent>) {
    if (phases.length === 0) throw new Error("PhaseRunner requires at least one phase")
    this.phases = phases
    this.ctx = ctx
    this.eventBus = eventBus
  }

  /**
   * Execute all phases in sequence and return every PhaseResult.
   * The sequence stops early if a gate returns 'fail' (throws) or 'skip'.
   */
  async run(): Promise<PhaseResult[]> {
    return this.runUntil(this.phases[this.phases.length - 1]!.id)
  }

  /**
   * Execute phases up to and including `phaseId`.
   * Throws if a gate returns 'fail'.
   */
  async runUntil(phaseId: string): Promise<PhaseResult[]> {
    const targetIdx = this.phases.findIndex((p) => p.id === phaseId)
    if (targetIdx < 0) throw new Error(`Phase "${phaseId}" not found`)

    // Initialize index on first run.
    if (this.currentPhaseIdx === undefined) this.currentPhaseIdx = 0

    while (this.currentPhaseIdx <= targetIdx) {
      const result = await this.executePhase(this.currentPhaseIdx, this.currentPhaseIdx)
      this.history.push(result)
      this.currentPhaseIdx++

      // Gate threw an exception → throw with gate error message.
      if (result.gateError) {
        throw new Error(`Phase "${result.phaseId}" gate threw: ${result.gateError}`)
      }
      // Gate returned 'fail' verdict (no phaseError → gate failure, not phase exception) → throw.
      if (result.verdict === "fail" && !result.phaseError) {
        throw new Error(`Phase "${result.phaseId}" gate returned 'fail'`)
      }
      if (result.verdict === "skip") break
    }

    await this.eventBus.publishAsync({ type: "runner:complete", results: this.history })
    return this.history
  }

  /** The currently-executing phase, or null if run() has not been called. */
  currentPhase(): Phase<S> | null {
    if (this.currentPhaseIdx === undefined) return null
    return this.phases[this.currentPhaseIdx] ?? null
  }

  /** All PhaseResults collected so far. */
  getHistory(): PhaseResult[] {
    return [...this.history]
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async executePhase(phaseIdx: number, _turn: number): Promise<PhaseResult<S, unknown>> {
    const phase = this.phases[phaseIdx]!
    const start = Date.now()

    await this.eventBus.publishAsync({ type: "phase:start", phaseId: phase.id, turn: phaseIdx })

    // Snapshot state before phase runs — used to restore if timeout occurs, preventing
    // post-timeout writes from polluting shared state that subsequent phases may read.
    const stateBeforePhase = structuredClone(this.ctx.state)

    // Build a phase-specific context (shares top-level ctx but resets messages)
    const phaseCtx: PhaseContext<S> = {
      ...this.ctx,
      phaseId: phase.id,
      state: this.ctx.state,
      artifacts: [],
      messages: [],
      startTime: new Date(),
    }

    let output: unknown
    let phaseError: string | undefined

    try {
      if (phase.timeout) {
        output = await this.withTimeout(phase.run(phaseCtx), phase.timeout, phase.id)
      } else {
        output = await phase.run(phaseCtx)
      }
    } catch (err) {
      phaseError = err instanceof Error ? err.message : String(err)
      // Restore state to prevent post-timeout / post-error writes from polluting shared state.
      this.ctx.state = stateBeforePhase
      // Exception in run() → verdict 'fail'
      const verdict: PhaseVerdict = "fail"
      await this.eventBus.publishAsync({ type: "phase:end", phaseId: phase.id, turn: phaseIdx, verdict })
      return { phaseId: phase.id, verdict, output: undefined, durationMs: Date.now() - start, phaseError, finalState: stateBeforePhase }
    }

    // Evaluate gate
    let verdict: PhaseVerdict = "pass"
    let gateError: string | undefined
    if (phase.gate) {
      try {
        verdict = await phase.gate(phaseCtx)
      } catch (err) {
        verdict = "fail"
        gateError = err instanceof Error ? err.message : String(err)
      }
    }

    await this.eventBus.publishAsync({ type: "phase:end", phaseId: phase.id, turn: phaseIdx, verdict })
    return {
      phaseId: phase.id,
      verdict,
      output,
      durationMs: Date.now() - start,
      phaseError,
      gateError,
      finalState: phaseCtx.state,
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, phaseId: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Phase "${phaseId}" timed out after ${ms}ms`)), ms)
      promise.then(resolve, reject).finally(() => clearTimeout(timer))
    })
  }
}
