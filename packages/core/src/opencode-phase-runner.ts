// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * OpencodePhaseRunner — PhaseRunner-shaped adapter that drives a phase's
 * tasks through OpencodeExecutor (Phase 3d).
 *
 * 借鉴 opencode - wires the existing ChatDev-shaped `Phase` lifecycle
 * (Plan → Review → Execute) to opencode serve, treating each task in the
 * phase as an opencode session invocation. Mirrors `AgentRuntime`'s
 * `opencodeExecutor` branch but at the *phase* level so the gate/timeout/
 * event machinery in `phase.ts` keeps working.
 *
 * Architecture:
 *   PhaseSpec { phase, tasks } ─→ OpencodePhaseRunner ─→ OpencodeExecutor
 *                                                      ├→ SessionPool (per-ws)
 *                                                      └→ EventBus (task:* events)
 *
 * Type-safety:
 *   - `phase` is the existing `Phase<S>` from `@max/core/phase.js`
 *   - `tasks` is an array of `Task` from `@max/core/types.js`
 *   - `executor` is `OpencodeExecutor` from `@max/core/opencode-executor.js`
 *   - Returned `OpencodePhaseOutcome` extends `PhaseResult<S>` so existing
 *     downstream code (recursive runner, dispatchers) doesn't need to change.
 *
 * Phase semantics:
 *   - Tasks with no dependencies run in parallel.
 *   - Tasks with dependencies run only after their deps complete.
 *   - The phase `gate()` (if defined) sees the aggregated output.
 *   - 'pass' / 'fail' / 'retry' / 'skip' verdicts are preserved.
 *   - `session.idle` SSE events are mapped to `session:idle` notifications
 *     on the event bus (after each `OpencodeExecutor.executeTask` resolves).
 */

import { performance } from "perf_hooks"
import type { Phase, PhaseContext, PhaseResult, PhaseVerdict, Artifact } from "./phase.js"
import type { Result, Task } from "./types.js"
import type { OpencodeExecutor, ExecuteResult } from "./opencode-executor.js"
import { EventBus } from "./event-bus.js"

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Events emitted by OpencodePhaseRunner.
 *
 * 借鉴 opencode - the `session:idle` event mirrors opencode's SSE
 * `session.idle` channel and is fired when the underlying opencode
 * session transitions to idle after task completion.
 */
export type OpencodePhaseEvent =
  | { type: "phase:start"; workspaceId: string; phaseId: string; taskCount: number }
  | { type: "task:start"; workspaceId: string; phaseId: string; taskId: string; sessionId: string }
  | { type: "task:complete"; workspaceId: string; phaseId: string; taskId: string; sessionId: string; resultId: string; durationMs: number }
  | { type: "task:failed"; workspaceId: string; phaseId: string; taskId: string; error: string }
  | { type: "session:idle"; workspaceId: string; phaseId: string; sessionId: string; taskId: string }
  | { type: "phase:end"; workspaceId: string; phaseId: string; verdict: PhaseVerdict; taskCount: number; failedCount: number; durationMs: number }

/**
 * Per-task result produced during phase execution.
 */
export interface PhaseTaskOutcome {
  taskId: string
  sessionId: string
  durationMs: number
  /** Populated on success. */
  result?: Result
  /** Populated on failure. */
  error?: string
}

/**
 * Options accepted by `OpencodePhaseRunner.runPhase`.
 */
export interface RunPhaseOpts<S, R> {
  /** The phase manifest (must have `id`, `name`, optional `gate`/`timeout`). */
  phase: Phase<S, R>
  /** Tasks to execute inside this phase. Order is irrelevant; deps are honoured. */
  tasks: ReadonlyArray<Task>
  /** The executor to route task invocations through. */
  executor: OpencodeExecutor
  /** Workspace id used for session pooling inside OpencodeExecutor. */
  workspaceId: string
  /** Event bus for `session:idle` and other lifecycle notifications. */
  eventBus?: EventBus<OpencodePhaseEvent>
  /**
   * Max parallel task executions. Tasks beyond this limit are scheduled
   * FIFO once a slot frees up. Defaults to `tasks.length`.
   */
  maxConcurrency?: number
  /** Cooperative cancellation. */
  signal?: AbortSignal
}

export interface OpencodePhaseRunnerOptions {
  /** Default event bus when callers don't pass one. */
  eventBus?: EventBus<OpencodePhaseEvent>
  /** Default maxConcurrency. */
  maxConcurrency?: number
}

/**
 * Aggregate result of running a phase through OpencodePhaseRunner.
 * Mirrors `PhaseResult` but exposes task-level outcomes too.
 */
export interface OpencodePhaseOutcome<S = unknown> extends PhaseResult<S, unknown> {
  /** One outcome per input task (success OR failure), preserving original task order. */
  taskOutcomes: ReadonlyArray<PhaseTaskOutcome>
  /** Verdict returned by the gate (or the runner when no gate is provided). */
  gateVerdict: PhaseVerdict
}

// ── OpencodePhaseRunner ──────────────────────────────────────────────────────

/**
 * Wires the existing `Phase` lifecycle (Plan/Review/Execute) to
 * OpencodeExecutor so a phase's tasks all run through opencode serve in
 * parallel (respecting dependency edges).
 *
 * Usage:
 * ```
 * const runner = new OpencodePhaseRunner()
 * const outcome = await runner.runPhase({
 *   phase: planPhase,
 *   tasks: plan.tasks,
 *   executor,
 *   workspaceId: ws.id,
 *   eventBus,
 * })
 * ```
 */
export class OpencodePhaseRunner {
  private readonly defaultEventBus?: EventBus<OpencodePhaseEvent>
  private readonly defaultMaxConcurrency?: number

  constructor(opts: OpencodePhaseRunnerOptions = {}) {
    if (opts.eventBus) this.defaultEventBus = opts.eventBus
    if (opts.maxConcurrency !== undefined) this.defaultMaxConcurrency = opts.maxConcurrency
  }

  /**
   * Execute every task via `OpencodeExecutor`, respecting `dependsOn`,
   * then run the phase gate (if any) on the aggregated output.
   */
  async runPhase<S, R>(opts: RunPhaseOpts<S, R>): Promise<OpencodePhaseOutcome<S>> {
    const { phase, tasks, executor, workspaceId } = opts
    const startMs = performance.now()
    const bus = opts.eventBus ?? this.defaultEventBus ?? new EventBus<OpencodePhaseEvent>()
    const maxConcurrency = Math.max(1, opts.maxConcurrency ?? this.defaultMaxConcurrency ?? tasks.length)

    await this.publish(bus, {
      type: "phase:start",
      workspaceId,
      phaseId: phase.id,
      taskCount: tasks.length,
    })

    // 1. Execute all tasks via executor (parallel where deps allow).
    const outcomes = await this.executeTasks({
      tasks,
      executor,
      workspaceId,
      phaseId: phase.id,
      bus,
      maxConcurrency,
      signal: opts.signal,
    })

    const failedCount = outcomes.filter((o) => Boolean(o.error)).length
    const successful = outcomes.filter((o) => o.result !== undefined)

    // 2. Aggregate into PhaseContext-shaped structures for the gate.
    const artifacts: Artifact[] = successful.map((o, i) => ({
      id: `artifact-${phase.id}-${i}`,
      phaseId: phase.id,
      name: `task-${o.taskId}`,
      content: o.result!.output,
      createdAt: new Date().toISOString(),
      metadata: { sessionId: o.sessionId, taskId: o.taskId },
    }))
    const aggregatedOutput = successful.map((o) => o.result!.output).join("\n\n")

    const phaseCtx: PhaseContext<S> = {
      workspaceId,
      phaseId: phase.id,
      state: {} as S,
      artifacts,
      messages: [],
      role: phase.roles[0] ?? "executor",
      startTime: new Date(startMs),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }

    // 3. Gate evaluation.
    let verdict: PhaseVerdict = "pass"
    let gateError: string | undefined
    let phaseError: string | undefined

    if (failedCount > 0) {
      verdict = "fail"
      phaseError = `${failedCount}/${tasks.length} task(s) failed`
    }

    if (phase.gate) {
      try {
        verdict = await this.applyGateTimeout(phase.gate(phaseCtx), phase)
      } catch (err) {
        verdict = "fail"
        gateError = err instanceof Error ? err.message : String(err)
      }
    }

    const durationMs = Math.max(0, performance.now() - startMs)

    const outcome: OpencodePhaseOutcome<S> = {
      phaseId: phase.id,
      verdict,
      output: aggregatedOutput.length > 0 ? aggregatedOutput : undefined,
      durationMs,
      finalState: phaseCtx.state,
      artifacts: phaseCtx.artifacts,
      messages: phaseCtx.messages,
      taskOutcomes: outcomes,
      gateVerdict: verdict,
      ...(phaseError !== undefined ? { phaseError } : {}),
      ...(gateError !== undefined ? { gateError } : {}),
    }

    await this.publish(bus, {
      type: "phase:end",
      workspaceId,
      phaseId: phase.id,
      verdict,
      taskCount: tasks.length,
      failedCount,
      durationMs,
    })

    return outcome
  }

  // ── private ───────────────────────────────────────────────────────────────

  /**
   * Execute tasks in topological waves respecting `dependsOn`.
   * Each wave runs concurrently up to `maxConcurrency`.
   */
  private async executeTasks(args: {
    tasks: ReadonlyArray<Task>
    executor: OpencodeExecutor
    workspaceId: string
    phaseId: string
    bus: EventBus<OpencodePhaseEvent>
    maxConcurrency: number
    signal?: AbortSignal
  }): Promise<PhaseTaskOutcome[]> {
    const { tasks, executor, workspaceId, phaseId, bus, maxConcurrency } = args
    const outcomes = new Map<string, PhaseTaskOutcome>()
    // A single "wake" promise that any in-flight task resolves when settled.
    let wake: (() => void) | null = null
    const newWake = (): Promise<void> => {
      if (wake !== null) return Promise.resolve()
      return new Promise<void>((resolve) => {
        wake = resolve
      })
    }
    const fireWake = (): void => {
      const resolve = wake
      wake = null
      if (resolve) resolve()
    }

    if (tasks.length === 0) return []

    // Pre-build index.
    const byId = new Map<string, Task>()
    for (const t of tasks) byId.set(t.id, t)

    const inDegree = new Map<string, number>()
    for (const t of tasks) {
      const realDeps = t.dependsOn.filter((d) => byId.has(d))
      inDegree.set(t.id, realDeps.length)
    }

    const ready: string[] = []
    for (const [id, deg] of inDegree) {
      if (deg === 0) ready.push(id)
    }

    let inflight = 0

    const launchOne = (taskId: string): void => {
      const task = byId.get(taskId)
      if (!task) return
      inflight++
      void this.runSingleTask(task, executor, workspaceId, phaseId, bus)
        .then((outcome) => {
          outcomes.set(taskId, outcome)
          // Decrement in-degree of dependents and enqueue any that reach zero.
          for (const [otherId, deg] of inDegree) {
            if (deg > 0 && byId.get(otherId)?.dependsOn.includes(taskId)) {
              const next = deg - 1
              inDegree.set(otherId, next)
              if (next === 0) ready.push(otherId)
            }
          }
        })
        .finally(() => {
          inflight--
          fireWake()
        })
    }

    const pump = (): void => {
      while (inflight < maxConcurrency && ready.length > 0) {
        const id = ready.shift()!
        if (outcomes.has(id)) continue
        inDegree.set(id, -1) // mark in-flight
        launchOne(id)
      }
    }

    pump()

    // Wait for all tasks to settle. Tasks with cyclic / missing deps will
    // never become ready → emit them as failures at the end.
    while (outcomes.size < tasks.length) {
      if (args.signal?.aborted) {
        for (const t of tasks) {
          if (!outcomes.has(t.id)) outcomes.set(t.id, this.abortOutcome(t.id))
        }
        break
      }
      if (inflight === 0 && ready.length === 0) {
        // No progress possible: remaining tasks have missing deps or cycles.
        for (const t of tasks) {
          if (!outcomes.has(t.id)) {
            outcomes.set(t.id, this.missingOutcome(t.id, t.dependsOn, byId))
          }
        }
        break
      }
      // Wait for at least one inflight task to settle.
      await newWake()
      pump()
    }

    return tasks.map((t) => outcomes.get(t.id) ?? this.abortOutcome(t.id))
  }

  private async runSingleTask(
    task: Task,
    executor: OpencodeExecutor,
    workspaceId: string,
    phaseId: string,
    bus: EventBus<OpencodePhaseEvent>,
  ): Promise<PhaseTaskOutcome> {
    await this.publish(bus, {
      type: "task:start",
      workspaceId,
      phaseId,
      taskId: task.id,
      sessionId: "",
    })

    try {
      const res: ExecuteResult = await executor.executeTask(task, workspaceId)

      // 借鉴 opencode - session.idle equivalent: emit completion + idle notifications.
      await this.publish(bus, {
        type: "task:complete",
        workspaceId,
        phaseId,
        taskId: task.id,
        sessionId: res.sessionId,
        resultId: res.result.id,
        durationMs: res.durationMs,
      })
      await this.publish(bus, {
        type: "session:idle",
        workspaceId,
        phaseId,
        sessionId: res.sessionId,
        taskId: task.id,
      })

      return {
        taskId: task.id,
        sessionId: res.sessionId,
        durationMs: res.durationMs,
        result: res.result,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.publish(bus, {
        type: "task:failed",
        workspaceId,
        phaseId,
        taskId: task.id,
        error: msg,
      })
      return this.failureOutcome(task.id, msg)
    }
  }

  private async applyGateTimeout<S>(
    gatePromise: Promise<PhaseVerdict>,
    phase: Phase<S, unknown>,
  ): Promise<PhaseVerdict> {
    if (phase.timeout === undefined || phase.timeout <= 0 || !Number.isFinite(phase.timeout)) {
      return await gatePromise
    }
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), phase.timeout)
    try {
      return await Promise.race([
        gatePromise,
        new Promise<PhaseVerdict>((_resolve, reject) =>
          ac.signal.addEventListener("abort", () =>
            reject(new Error(`"${phase.id}:gate" timed out after ${phase.timeout}ms`)),
          ),
        ),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  private async publish(bus: EventBus<OpencodePhaseEvent>, event: OpencodePhaseEvent): Promise<void> {
    // EventBus.publishAsync isolates per-subscriber failures and never throws.
    await bus.publishAsync(event)
  }

  private failureOutcome(taskId: string, error: string): PhaseTaskOutcome {
    return { taskId, sessionId: "", durationMs: 0, error }
  }

  private abortOutcome(taskId: string): PhaseTaskOutcome {
    return this.failureOutcome(taskId, "aborted")
  }

  private missingOutcome(taskId: string, deps: ReadonlyArray<string>, byId: Map<string, Task>): PhaseTaskOutcome {
    const missing = deps.filter((d) => !byId.has(d))
    return this.failureOutcome(taskId, `missing dependencies: ${missing.join(", ")}`)
  }
}
