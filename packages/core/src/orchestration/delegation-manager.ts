/**
 * DelegationManager — concurrent task executor with retry + routing (借鉴 Kosmos delegation.py).
 *
 * Kosmos's DelegationManager routes research tasks to specialized agents,
 * runs them in parallel batches (max 3), and retries failures up to 2 times.
 * It produces an ExecutionSummary tracking completion, failures, and timing.
 *
 * Maximilian adapts this as a generic, type-parameterized executor that the
 * AgentRuntime (or commander) can use to fan out heterogeneous work:
 *   - Type-keyed handler registry: register `Map<taskType, handler>`.
 *   - Bounded concurrency: at most N tasks in flight at once.
 *   - Per-task retry with exponential backoff with jitter.
 *   - Aggregate summary: total/completed/failed counts, success rate.
 */

import { performance } from "perf_hooks"

export type TaskStatus = "completed" | "failed" | "skipped"

export interface DelegationTask<T = unknown> {
  id: string
  type: string
  /** Optional input payload passed to the handler. */
  input?: T
}

export interface DelegationResult<R = unknown> {
  taskId: string
  taskType: string
  status: TaskStatus
  result?: R
  error?: string
  /** Total attempts used (1 = first try succeeded). */
  attempts: number
  executionTimeMs: number
}

export interface DelegationSummary {
  totalTasks: number
  completedTasks: number
  failedTasks: number
  skippedTasks: number
  totalExecutionTimeMs: number
  successRate: number
}

export interface DelegationOptions {
  /** Maximum tasks running concurrently (default: 3). Must be a positive safe integer. */
  maxParallel?: number
  /** Max retry attempts per task on failure (default: 2). Must be a non-negative safe integer. */
  maxRetries?: number
  /** Base backoff delay in ms (default: 100). Doubles per attempt with jitter. */
  baseBackoffMs?: number
  /** Maximum total retry duration per task in ms (default: 30000). */
  maxRetryDurationMs?: number
}

export type TaskHandler<T = unknown, R = unknown> = (
  task: Readonly<DelegationTask<T>>,
) => Promise<R>

export class DelegationManager {
  private readonly maxParallel: number
  private readonly maxRetries: number
  private readonly baseBackoffMs: number
  private readonly maxRetryDurationMs: number

  constructor(options?: DelegationOptions) {
    const mp = options?.maxParallel
    // Fractional values < 1 (e.g. 0.5, 1e-9) would produce ~tasks.length empty iterations.
    // Require integer >= 1.
    this.maxParallel =
      Number.isSafeInteger(mp) && mp !== undefined && mp >= 1
        ? mp
        : 3

    const mr = options?.maxRetries
    this.maxRetries =
      Number.isSafeInteger(mr) && mr !== undefined && mr >= 0
        ? mr
        : 2

    const bbm = options?.baseBackoffMs
    this.baseBackoffMs =
      Number.isFinite(bbm) && bbm !== undefined && bbm >= 0
        ? bbm
        : 100

    const mrdm = options?.maxRetryDurationMs
    this.maxRetryDurationMs =
      Number.isFinite(mrdm) && mrdm !== undefined && mrdm >= 0
        ? mrdm
        : 30_000
  }

  /**
   * Execute a list of tasks using the given handlers. Tasks are dispatched
   * in batches of `maxParallel`. Each task retries up to `maxRetries` times
   * on failure with exponential backoff and jitter.
   */
  async execute<T, R>(
    tasks: ReadonlyArray<DelegationTask<T>>,
    handlers: ReadonlyMap<string, TaskHandler<T, R>>,
  ): Promise<{ results: DelegationResult<R>[]; summary: DelegationSummary }> {
    // Snapshot the task list so concurrent mutation cannot affect in-flight batches.
    const taskList = Array.from(tasks)

    if (taskList.length === 0) {
      const emptySummary: DelegationSummary = {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        skippedTasks: 0,
        totalExecutionTimeMs: 0,
        successRate: 0,
      }
      return { results: [], summary: emptySummary }
    }

    const startTime = performance.now()
    const results: DelegationResult<R>[] = []

    for (let i = 0; i < taskList.length; i += this.maxParallel) {
      const batch = taskList.slice(i, i + this.maxParallel)
      const batchResults = await Promise.all(
        batch.map((task) => this.runWithRetry(task, handlers)),
      )
      results.push(...batchResults)
    }

    const completed = results.filter((r) => r.status === "completed").length
    const failed = results.filter((r) => r.status === "failed").length
    const skipped = results.filter((r) => r.status === "skipped").length
    const totalTime = performance.now() - startTime

    const summary: DelegationSummary = {
      totalTasks: taskList.length,
      completedTasks: completed,
      failedTasks: failed,
      skippedTasks: skipped,
      totalExecutionTimeMs: Math.max(0, Math.round(totalTime)),
      successRate: taskList.length > 0 ? completed / taskList.length : 0,
    }

    return { results, summary }
  }

  private async runWithRetry<T, R>(
    task: DelegationTask<T>,
    handlers: ReadonlyMap<string, TaskHandler<T, R>>,
  ): Promise<DelegationResult<R>> {
    // Capture identity at dispatch time — handlers must not be able to mutate
    // task correlation fields before the result is constructed.
    const { id: taskId, type: taskType } = task

    const start = performance.now()
    const handler = handlers.get(task.type)

    if (!handler) {
      return {
        taskId,
        taskType,
        status: "skipped",
        error: `no handler registered for type "${task.type}"`,
        attempts: 0,
        executionTimeMs: 0,
      }
    }

    // Frozen snapshot of the input passed to the handler.
    const frozenTask: Readonly<DelegationTask<T>> = Object.freeze({ ...task })
    const retryStart = start
    let lastError: string | undefined
    const maxAttempts = this.maxRetries + 1

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await handler(frozenTask)
        return {
          taskId,
          taskType,
          status: "completed",
          result,
          attempts: attempt,
          executionTimeMs: Math.max(0, Math.round(performance.now() - start)),
        }
      } catch (err) {
        // Sanitize: only keep error message, strip provider/prompt/URL/credential content.
        const raw = err instanceof Error ? err.message : String(err)
        // Truncate to first line, 200 chars to avoid leaking request content.
        lastError = raw.split("\n")[0]!.slice(0, 200)

        // Classify: never retry AbortError or security/validation errors.
        if (err instanceof Error && err.name === "AbortError") break

        // Stop retrying if overall budget is exceeded.
        const elapsed = performance.now() - retryStart
        if (elapsed >= this.maxRetryDurationMs) break

        if (attempt < maxAttempts) {
          await this.backoff(attempt)
        }
      }
    }

    return {
      taskId,
      taskType,
      status: "failed",
      error: lastError ?? "unknown error",
      attempts: maxAttempts,
      executionTimeMs: Math.max(0, Math.round(performance.now() - start)),
    }
  }

  /**
   * Exponential backoff with full jitter (AWS algorithm).
   * Caps at maxRetryDurationMs so no single retry waits longer than the budget.
   */
  private async backoff(attempt: number): Promise<void> {
    const exponentialDelay = this.baseBackoffMs * Math.pow(2, attempt - 1)
    const cappedDelay = Math.min(exponentialDelay, this.maxRetryDurationMs)
    // Full jitter: random uniform in [0, cappedDelay].
    const jitter = Math.random() * cappedDelay
    await new Promise((r) => setTimeout(r, jitter))
  }
}
