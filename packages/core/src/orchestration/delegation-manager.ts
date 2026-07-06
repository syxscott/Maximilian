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
 *   - Per-task retry with exponential backoff.
 *   - Aggregate summary: total/completed/failed counts, success rate.
 *
 * The runtime already does fan-out; this complements it for callers that
 * want explicit batching + retry control over a flat task list.
 */

export type TaskStatus = "completed" | "failed" | "skipped"

export interface DelegationTask<T = unknown> {
  id: string
  type: string
  /** Optional input payload passed to the handler. */
  input?: T
}

export interface DelegationResult<R = unknown> {
  taskId: string
  type: string
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
  /** Maximum tasks running concurrently (default: 3). */
  maxParallel?: number
  /** Max retry attempts per task on failure (default: 2). */
  maxRetries?: number
  /** Base backoff delay in ms (default: 100). Doubles per attempt. */
  baseBackoffMs?: number
}

export type TaskHandler<T = unknown, R = unknown> = (
  task: DelegationTask<T>,
) => Promise<R>

export class DelegationManager {
  private readonly maxParallel: number
  private readonly maxRetries: number
  private readonly baseBackoffMs: number

  constructor(options?: DelegationOptions) {
    this.maxParallel = options?.maxParallel ?? 3
    this.maxRetries = options?.maxRetries ?? 2
    this.baseBackoffMs = options?.baseBackoffMs ?? 100
  }

  /**
   * Execute a list of tasks using the given handlers. Tasks are dispatched
   * in batches of `maxParallel`. Each task retries up to `maxRetries` times
   * on failure with exponential backoff.
   */
  async execute<T, R>(
    tasks: ReadonlyArray<DelegationTask<T>>,
    handlers: ReadonlyMap<string, TaskHandler<T, R>>,
  ): Promise<{ results: DelegationResult<R>[]; summary: DelegationSummary }> {
    if (tasks.length === 0) {
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

    const startTime = Date.now()
    const results: DelegationResult<R>[] = []

    for (let i = 0; i < tasks.length; i += this.maxParallel) {
      const batch = tasks.slice(i, i + this.maxParallel)
      const batchResults = await Promise.all(
        batch.map((task) => this.runWithRetry(task, handlers)),
      )
      results.push(...batchResults)
    }

    const completed = results.filter((r) => r.status === "completed").length
    const failed = results.filter((r) => r.status === "failed").length
    const skipped = results.filter((r) => r.status === "skipped").length
    const totalTime = Date.now() - startTime

    const summary: DelegationSummary = {
      totalTasks: tasks.length,
      completedTasks: completed,
      failedTasks: failed,
      skippedTasks: skipped,
      totalExecutionTimeMs: totalTime,
      successRate: tasks.length > 0 ? completed / tasks.length : 0,
    }

    return { results, summary }
  }

  private async runWithRetry<T, R>(
    task: DelegationTask<T>,
    handlers: ReadonlyMap<string, TaskHandler<T, R>>,
  ): Promise<DelegationResult<R>> {
    const start = Date.now()
    const handler = handlers.get(task.type)

    if (!handler) {
      return {
        taskId: task.id,
        type: task.type,
        status: "skipped",
        error: `no handler registered for type "${task.type}"`,
        attempts: 0,
        executionTimeMs: Date.now() - start,
      }
    }

    let lastError: string | undefined
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        const result = await handler(task)
        return {
          taskId: task.id,
          type: task.type,
          status: "completed",
          result,
          attempts: attempt,
          executionTimeMs: Date.now() - start,
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (attempt <= this.maxRetries) {
          await this.backoff(attempt)
        }
      }
    }

    return {
      taskId: task.id,
      type: task.type,
      status: "failed",
      error: lastError ?? "unknown error",
      attempts: this.maxRetries + 1,
      executionTimeMs: Date.now() - start,
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = this.baseBackoffMs * Math.pow(2, attempt - 1)
    await new Promise((r) => setTimeout(r, delay))
  }
}