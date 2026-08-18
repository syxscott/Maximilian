// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * OpencodeDagExecutor — streaming parallel DAG executor that runs every
 * Task through OpencodeExecutor, yielding results as they complete (Phase 3d).
 *
 * 借鉴 opencode - implements opencode's "stream tasks as they finish"
 * idiom (mirrors `runPromise` in `@opencode-ai/sdk` v2). Each DAG node
 * is submitted to opencode serve independently, dependencies between
 * nodes are honoured, and the consumer sees a stream of TaskResult
 * events via an AsyncIterator.
 *
 * Architecture:
 *   Task[] ─→ OpencodeDagExecutor ─→ topological layer scheduler
 *                                    │
 *                                    ├→ OpencodeExecutor.executeTask (parallel per layer)
 *                                    └→ AsyncIterator<TaskResult> (yields as tasks finish)
 *
 * Why an AsyncIterator (vs. Promise.all):
 *   - Streaming UI needs results one-by-one as soon as a task finishes.
 *   - Downstream consumers can break the loop on early errors.
 *   - Composes with `for await ... of` in any JS runtime.
 *
 * Type-safety:
 *   - `tasks: Task[]` (from `@max/core/types.js`)
 *   - `executor: OpencodeExecutor` (from `@max/core/opencode-executor.js`)
 *   - Returns `AsyncIterableIterator<TaskResult>`
 */

import type { Result, Task } from "./types.js"
import type { OpencodeExecutor } from "./opencode-executor.js"

/**
 * A single task-level execution outcome, yielded as tasks complete.
 */
export interface TaskResult {
  /** The task that produced this result. */
  taskId: string
  /** Session id from opencode serve (empty when the task failed before reaching opencode). */
  sessionId: string
  /** Wall-clock duration of the task. */
  durationMs: number
  /** ISO timestamp the task started. */
  startedAt: string
  /** ISO timestamp the task finished (populated on success + failure). */
  completedAt: string
  /** Populated on success. */
  result?: Result
  /** Populated on failure. */
  error?: string
}

/**
 * Options accepted by `OpencodeDagExecutor.execute`.
 */
export interface ExecuteOpts {
  /**
   * Max parallel task executions across the whole DAG (default: tasks.length).
   */
  maxConcurrency?: number
  /**
   * If true (default), the iterator's `return()` resolves the current
   * in-flight tasks. If false, aborting the iterator leaves in-flight
   * promises to settle naturally.
   */
  abortOnReturn?: boolean
}

/**
 * OpencodeDagExecutor — streams results from a DAG of Tasks via opencode.
 *
 * Usage:
 * ```
 * const dag = new OpencodeDagExecutor()
 * for await (const tr of dag.execute({ tasks, executor })) {
 *   console.log("task done:", tr.taskId, tr.result?.output)
 * }
 * ```
 */
export class OpencodeDagExecutor {
  private readonly defaultMaxConcurrency?: number

  constructor(opts: { maxConcurrency?: number } = {}) {
    if (opts.maxConcurrency !== undefined) this.defaultMaxConcurrency = opts.maxConcurrency
  }

  /**
   * Execute the DAG layer by layer (Kahn's algorithm) and yield each
   * `TaskResult` as soon as the task finishes. The iterator ends when
   * all tasks have settled OR the iterator's `return()` is called.
   *
   * `signal` is supported via an optional trailing argument.
   */
  execute(args: {
    tasks: ReadonlyArray<Task>
    executor: OpencodeExecutor
    workspaceId: string
    signal?: AbortSignal
  } & ExecuteOpts): AsyncIterableIterator<TaskResult> {
    const { tasks, executor } = args
    const workspaceId = args.workspaceId
    const signal = args.signal
    const abortOnReturn = args.abortOnReturn ?? true
    const maxConcurrency = Math.max(1, args.maxConcurrency ?? this.defaultMaxConcurrency ?? tasks.length)

    // ── Pre-compute indices ────────────────────────────────────────────────
    const byId = new Map<string, Task>()
    for (const t of tasks) byId.set(t.id, t)

    const inDegree = new Map<string, number>()
    for (const t of tasks) {
      inDegree.set(t.id, t.dependsOn.filter((d) => byId.has(d)).length)
    }

    // Pending results queue + a wake callback per consumer-waiter.
    const settledResults: TaskResult[] = []
    const waiters: Array<() => void> = []

    // Abort state.
    let aborted = signal?.aborted ?? false

    const onAbort = (): void => {
      aborted = true
      // Wake any pending next() calls so they can return.
      while (waiters.length > 0) {
        const wake = waiters.shift()!
        wake()
      }
    }

    if (signal) {
      if (aborted) onAbort()
      else signal.addEventListener("abort", onAbort, { once: true })
    }

    const emit = (result: TaskResult): void => {
      settledResults.push(result)
      // Remove from inflight so the budget refills.
      inflight.delete(result.taskId)
      // Decrement in-degree of dependents and queue any that became ready.
      for (const [id, deg] of inDegree) {
        if (deg <= 0) continue
        const other = byId.get(id)
        if (!other) continue
        if (other.dependsOn.includes(result.taskId)) {
          const next = deg - 1
          inDegree.set(id, next)
        }
      }
      // Wake ONE pending yield.
      if (waiters.length > 0) {
        const wake = waiters.shift()!
        wake()
      }
    }

    // ── Task launcher ──────────────────────────────────────────────────────
    const inflight = new Map<string, Promise<void>>()
    const launchedIds = new Set<string>()

    const launchOne = (task: Task): void => {
      const startedAt = new Date().toISOString()
      const startedAtMs = Date.now()
      let sessionId = ""
      let resolveSettle: () => void = () => {}
      const settlePromise = new Promise<void>((resolve) => {
        resolveSettle = resolve
      })
      inflight.set(task.id, settlePromise)
      launchedIds.add(task.id)

      void (async () => {
        if (aborted) {
          const finished: TaskResult = {
            taskId: task.id,
            sessionId: "",
            durationMs: 0,
            startedAt,
            completedAt: new Date().toISOString(),
            error: "aborted",
          }
          emit(finished)
          resolveSettle()
          return
        }
        const missing = task.dependsOn.filter((d) => !byId.has(d))
        if (missing.length > 0) {
          const finished: TaskResult = {
            taskId: task.id,
            sessionId: "",
            durationMs: 0,
            startedAt,
            completedAt: new Date().toISOString(),
            error: `missing dependencies: ${missing.join(", ")}`,
          }
          emit(finished)
          resolveSettle()
          return
        }
        try {
          // M2-fix: pass the abort signal so an aborted DAG run
          // cancels the in-flight opencode session via
          // OpencodeSdk.abortSession (set up inside the executor).
          // Without this, onAbort() would only flip the local flag —
          // the opencode server would keep running the LLM call.
          const res = await executor.executeTask(task, workspaceId, signal ?? undefined)
          sessionId = res.sessionId
          const finished: TaskResult = {
            taskId: task.id,
            sessionId: res.sessionId,
            durationMs: res.durationMs,
            startedAt,
            completedAt: new Date().toISOString(),
            result: res.result,
          }
          emit(finished)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          const finished: TaskResult = {
            taskId: task.id,
            sessionId,
            durationMs: Math.max(0, Date.now() - startedAtMs),
            startedAt,
            completedAt: new Date().toISOString(),
            error: msg,
          }
          emit(finished)
        } finally {
          resolveSettle()
        }
      })()
    }

    // ── Layer scheduler ───────────────────────────────────────────────────
    const pump = (): void => {
      // Launch as many tasks as the concurrency budget allows.
      if (aborted) return
      for (const [id, deg] of inDegree) {
        if (inflight.size >= maxConcurrency) break
        if (deg !== 0) continue
        if (launchedIds.has(id)) continue
        const task = byId.get(id)
        if (!task) continue
        // Mark in-flight.
        inDegree.set(id, -1)
        launchOne(task)
      }
    }

    // Initial pump.
    pump()

    // ── Public iterator ───────────────────────────────────────────────────
    let yieldCursor = 0

    const cleanup = (): void => {
      if (signal) signal.removeEventListener("abort", onAbort)
    }

    function allKnown(): boolean {
      if (settledResults.length >= tasks.length) return true
      const known = new Set(settledResults.map((r) => r.taskId))
      for (const t of tasks) {
        if (!known.has(t.id)) return false
      }
      return true
    }

    const iterator: AsyncIterableIterator<TaskResult> = {
      [Symbol.asyncIterator]() {
        return iterator
      },
      async next(): Promise<IteratorResult<TaskResult>> {
        // Drain any already-settled results.
        if (yieldCursor < settledResults.length) {
          const value = settledResults[yieldCursor++]!
          return { value, done: false }
        }
        // No more results possible?
        if (aborted || allKnown() || inflight.size === 0) {
          cleanup()
          return { value: undefined, done: true }
        }
        // Wait for the next settlement.
        await new Promise<void>((resolve) => waiters.push(resolve))
        // After waking, more tasks may have become ready — pump them.
        pump()
        if (yieldCursor < settledResults.length) {
          const value = settledResults[yieldCursor++]!
          return { value, done: false }
        }
        // Re-check termination; if there's truly nothing left inflight, return done.
        if (aborted || allKnown() || inflight.size === 0) {
          cleanup()
          return { value: undefined, done: true }
        }
        // Otherwise, another task landed — recurse once.
        return iterator.next()
      },
      return(): Promise<IteratorResult<TaskResult>> {
        if (abortOnReturn) onAbort()
        cleanup()
        while (waiters.length > 0) {
          const wake = waiters.shift()!
          wake()
        }
        return Promise.resolve({ value: undefined, done: true })
      },
      throw(err: unknown): Promise<IteratorResult<TaskResult>> {
        onAbort()
        cleanup()
        while (waiters.length > 0) {
          const wake = waiters.shift()!
          wake()
        }
        return Promise.reject(err)
      },
    }

    return iterator
  }
}
