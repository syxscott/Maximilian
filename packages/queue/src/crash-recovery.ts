// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Batch status reset for crash recovery (swarms borrowing).
 *
 * When a worker process dies, BullMQ tasks it was executing are left in the
 * "running" (active) state with no one holding their lock. A recovery sweep
 * must decide what to do with each of them — and the swarms lesson is that
 * the decision belongs to a closed error taxonomy, not to per-call-site
 * improvisation:
 *
 *   transient / rate_limit → reset back into the retry pool (safe re-run)
 *   permanent / context_limit / cancelled → hold (leave untouched, annotate)
 *   unknown → hold conservatively AND count, so operators see the residue
 *
 * This module is the batch-reset ENTRY POINT; the decision table itself
 * (`ERROR_RESET_ACTIONS`) lives in `@max/core`'s error-taxonomy next to
 * `classifyError`. Queue cannot depend on core (no workspace dep — queue is
 * a leaf), so the classifier is injected and a structural adapter
 * (`crashCategoryOfClassification`) accepts a `{ category: string }`
 * classification shape, rejecting anything outside the closed set as
 * `unknown`. The apps layer wires `classifyError(err).category` in.
 *
 * The task store is also a port (`StalledJobPort`) so the sweep is
 * unit-testable without Redis: implement it over BullMQ's `getJobs(["active"])`
 * + `Job.retry()` / `Job.updateData()`-style metadata writes in the worker app.
 */

/** Closed category set — mirrors @max/core error-taxonomy's ErrorCategory. */
export const CRASH_CATEGORIES = [
  "transient",
  "permanent",
  "context_limit",
  "rate_limit",
  "cancelled",
  "unknown",
] as const

export type CrashCategory = (typeof CRASH_CATEGORIES)[number]

/**
 * Structural adapter: accept a classification like `@max/core`'s
 * `ClassifiedExecutionError` (`{ category: string }`) and return the
 * matching closed-set member, or null when the shape or the value does not
 * fit. Callers typically coalesce null → "unknown" so a drifted or missing
 * classifier degrades to the conservative action instead of crashing.
 */
export function crashCategoryOfClassification(value: unknown): CrashCategory | null {
  if (typeof value !== "object" || value === null) return null
  const category = (value as { category?: unknown }).category
  if (typeof category !== "string") return null
  return (CRASH_CATEGORIES as readonly string[]).includes(category)
    ? (category as CrashCategory)
    : null
}

/** A task observed stuck in the running state after a crash. */
export interface StalledJobRecord {
  id: string
  /**
   * Attempts made before the crash — surfaced so callers can stop
   * resetting a job that has already burned its retry budget. Optional:
   * stores without a per-task attempt counter (e.g. the workspace
   * ledger) omit it rather than invent a number.
   */
  attempts?: number
  /** Raw last-failure artifact (Error, string, structured payload). */
  lastError?: unknown
}

/**
 * Persistence port over the queue's task states. Implementations map the
 * two verbs onto their storage (BullMQ, a DB ledger, …); the sweep only
 * ever calls these — never a third "just touch it a bit" action.
 */
export interface StalledJobPort {
  /** All tasks currently stuck in the running state. */
  listStalledRunning(): Promise<StalledJobRecord[]> | StalledJobRecord[]
  /** Put a task back into the retryable pool (transient/rate_limit only). */
  resetToRetryable(id: string, category: CrashCategory): Promise<void> | void
  /**
   * Annotate a task we deliberately did NOT reset (permanent /
   * context_limit / cancelled) so operators can see why it is parked.
   * Must not change the task's execution state.
   */
  holdWithReason(id: string, category: CrashCategory): Promise<void> | void
}

/** Per-category outcome of one sweep. */
export interface StalledRecoveryReport {
  /** Tasks examined. */
  scanned: number
  /** Tasks reset back into the retry pool. */
  reset: number
  /** Tasks held with a reason annotation. */
  held: number
  /**
   * Unknown-category tasks left untouched — the conservative residue that
   * must be surfaced (reported/alarmed) rather than retried.
   */
  unknownLeft: number
  /** Task counts per category. */
  byCategory: Record<CrashCategory, number>
  /** Per-task failures of the port operations themselves (sweep continues). */
  errors: string[]
}

export interface StalledRecoveryOptions {
  /**
   * Safety valve: at most this many tasks are reset per sweep. The rest are
   * held (annotated, counted) so a pathology cannot mass-requeue a queue.
   */
  maxResets?: number
}

const DEFAULT_MAX_RESETS = 100

function emptyReport(): StalledRecoveryReport {
  return {
    scanned: 0,
    reset: 0,
    held: 0,
    unknownLeft: 0,
    byCategory: {
      transient: 0,
      permanent: 0,
      context_limit: 0,
      rate_limit: 0,
      cancelled: 0,
      unknown: 0,
    },
    errors: [],
  }
}

/**
 * Sweep stalled running tasks and batch-reset them per the taxonomy.
 *
 * - classify: injected error classifier (wire `classifyError` from
 *   `@max/core` here, via `crashCategoryOfClassification`).
 * - transient + rate_limit → `resetToRetryable` (bounded by maxResets;
 *   over-budget tasks are held and counted instead).
 * - permanent / context_limit / cancelled → `holdWithReason`.
 * - unknown → touched by NO port verb, only counted (`unknownLeft`).
 * - Port failures are recorded per task and never abort the sweep.
 */
export async function recoverStalledJobs(
  port: StalledJobPort,
  classify: (err: unknown) => CrashCategory | null,
  options: StalledRecoveryOptions = {},
): Promise<StalledRecoveryReport> {
  const report = emptyReport()
  const maxResets = options.maxResets ?? DEFAULT_MAX_RESETS
  const stalled = await port.listStalledRunning()

  for (const job of stalled) {
    report.scanned += 1
    const category = classify(job.lastError) ?? "unknown"
    report.byCategory[category] += 1

    try {
      switch (category) {
        case "transient":
        case "rate_limit":
          if (report.reset < maxResets) {
            await port.resetToRetryable(job.id, category)
            report.reset += 1
          } else {
            // Reset budget exhausted: park it rather than requeue blindly.
            await port.holdWithReason(job.id, category)
            report.held += 1
          }
          break
        case "permanent":
        case "context_limit":
        case "cancelled":
          await port.holdWithReason(job.id, category)
          report.held += 1
          break
        case "unknown":
          // Conservative: no port call at all — only counted.
          report.unknownLeft += 1
          break
      }
    } catch (err) {
      report.errors.push(`job ${job.id} (${category}): ${(err as Error).message}`)
    }
  }
  return report
}
