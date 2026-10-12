// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Cron failure notifications: transient-retry hold + cancel-is-not-
 * failure (openclaw borrowing: `cron/service/timer-outcomes.ts` +
 * `cron/service/failure-alerts.ts`, commits 9449b4e7dc9 + ddea57545b7).
 *
 * Two invariants, both pure and independently asserted:
 *
 *  1. When a cycle's outcome is adjudicated as "transient retry pending"
 *     (a provider outage gets a quick re-run while the retry budget
 *     lasts), the failure ALERT and the owner REPAIR for that cycle are
 *     HELD — but incident bookkeeping still runs, so a success during the
 *     hold clears the incident silently. Bounds: never without a next
 *     run, never beyond the transient retry budget, never for failures
 *     the job causes itself (watchdog timeout, script failures, command
 *     timeouts) — those repair at failure 2 as before.
 *
 *  2. A CANCELLED completion envelope NEVER triggers a failure alert.
 *     Cancellation is a user action, not a failure; the terminal
 *     one-shot failure alert (armed by consecutive failures) and the
 *     cancel envelope are two independent code paths with two
 *     independent assertions.
 */

/** Completion status of one cron run. */
export type CronCompletionStatus = "succeeded" | "error" | "cancelled"

/** Why a run failed, at the grain the hold decision needs. */
export type CronFailureKind =
  /** Provider/network outage — retryable, hold-eligible. */
  | "provider"
  /** The job's own watchdog (execution timeout) — NOT hold-eligible. */
  | "watchdog-timeout"
  /** Helper script failed (incl. script timeouts) — NOT hold-eligible. */
  | "script"
  /** Command-job timeout — NOT hold-eligible. */
  | "command-timeout"
  /** Anything else — treated as job-owned (conservative for alerts). */
  | "unknown"

export interface CronRunResult {
  status: CronCompletionStatus
  /** Present when status is "error" or "cancelled". */
  failureKind?: CronFailureKind
  /** Structured failover reason of the last error, when known. */
  lastErrorReason?: string
  /** Human-readable error text, when known. */
  lastErrorText?: string
}

/** Default quick-retry budget for transient provider failures (openclaw: 3). */
export const DEFAULT_MAX_TRANSIENT_RETRIES = 3

/**
 * Whether a failure may hold its notifications because a quick transient
 * re-run is pending. ALL of:
 *   - the failure is provider-side (not job-owned),
 *   - the retry budget is not exhausted,
 *   - a next run actually exists (a disabled job, a retired one-shot, or
 *     a schedule with no future slot never holds).
 */
export function holdsFailureNotificationForRetry(input: {
  result: CronRunResult
  retriesUsed: number
  maxTransientRetries?: number
  /** Epoch ms of the next scheduled run; undefined = no next run. */
  nextRunAtMs?: number
}): boolean {
  const max = input.maxTransientRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES
  if (input.result.status !== "error") return false
  if (input.result.failureKind !== "provider") return false
  if (input.retriesUsed >= max) return false
  return input.nextRunAtMs !== undefined
}

/** The adjudication one cycle produces (openclaw's applyJobResult output). */
export interface CycleAdjudication {
  /** A quick transient re-run is scheduled; alert/repair wait for it. */
  pendingTransientRetry: boolean
}

/** Adjudicate a finished cycle: pure decision, no side effects. */
export function adjudicateCycle(input: {
  result: CronRunResult
  retriesUsed: number
  maxTransientRetries?: number
  nextRunAtMs?: number
}): CycleAdjudication {
  return {
    pendingTransientRetry: holdsFailureNotificationForRetry(input),
  }
}

/**
 * Notification sink — the caller wires emitters (home channels, owner
 * conversations). A sinking ship must not take the ledger down: the
 * finalize function never throws on sink errors.
 */
export interface CronNotificationSink {
  /** A failure alert to unowned destinations. */
  failureAlert?: (info: { jobId: string; consecutiveErrors: number; text: string }) => void
  /** An owner-conversation repair request. */
  ownerRepair?: (info: { jobId: string; consecutiveErrors: number; text: string }) => void
  /** The incident cleared (a success during a failure streak). */
  incidentCleared?: (info: { jobId: string; hadErrors: number }) => void
}

export interface FinalizeNotificationsParams {
  jobId: string
  result: CronRunResult
  adjudication: CycleAdjudication
  /**
   * True when a disabling auto-action owns the failure and will inform
   * the owner itself — also suppresses the plain alert (openclaw's
   * autoDisableNotificationOwnsFailure).
   */
  autoDisableNotificationOwnsFailure?: boolean
  /**
   * True when the job has an owner conversation: the failure surfaces as
   * a REPAIR request there; false (unowned) surfaces as a plain alert.
   */
  owned?: boolean
  /** Alert after this many consecutive failures (default 2). */
  alertAfter?: number
  /** Incident bookkeeping comes from the ledger. */
  consecutiveErrors: number
}

/**
 * The final gate before a failure notification leaves the house.
 *
 * Order of guards (all independent, each skips alert AND repair):
 *   1. cancelled envelope → never a failure alert (invariant 2);
 *   2. pendingTransientRetry → held for the quick re-run (invariant 1);
 *   3. autoDisableNotificationOwnsFailure → the disabling path notifies;
 *   4. alertAfter threshold not reached → nothing yet.
 * Below the gates: owned jobs get a repair request, unowned jobs an alert.
 */
export function finalizeCronFailureNotifications(
  params: FinalizeNotificationsParams,
  sink: CronNotificationSink,
): void {
  if (params.result.status === "cancelled") return // cancel ≠ failure, ever
  if (params.result.status !== "error") return
  if (params.adjudication.pendingTransientRetry) return
  if (params.autoDisableNotificationOwnsFailure === true) return
  const alertAfter = params.alertAfter ?? 2
  if (params.consecutiveErrors < alertAfter) return

  const info = {
    jobId: params.jobId,
    consecutiveErrors: params.consecutiveErrors,
    text: `Automation ${params.jobId} failed ${params.consecutiveErrors} consecutive runs`,
  }
  try {
    if (params.owned === true && sink.ownerRepair !== undefined) {
      sink.ownerRepair(info)
    } else if (sink.failureAlert !== undefined) {
      sink.failureAlert(info)
    }
  } catch {
    // A notification failure must never corrupt the ledger.
  }
}

/**
 * Incident bookkeeping that runs EVEN WHILE notifications are held
 * (openclaw: "incident and unresolved-failure bookkeeping still run, so a
 * success during the hold clears the incident silently").
 */
export class CronIncidentLedger {
  private readonly consecutive = new Map<string, number>()

  /** Record a failed run; returns the new consecutive-error count. */
  recordFailure(jobId: string): number {
    const next = (this.consecutive.get(jobId) ?? 0) + 1
    this.consecutive.set(jobId, next)
    return next
  }

  /**
   * Record a successful run. Clears the incident SILENTLY (the sink's
   * incidentCleared is the only observable, and only when there was
   * something to clear) — including during a pendingTransientRetry hold.
   */
  recordSuccess(jobId: string, sink?: CronNotificationSink): void {
    const had = this.consecutive.get(jobId) ?? 0
    if (had === 0) return
    this.consecutive.delete(jobId)
    try {
      sink?.incidentCleared?.({ jobId, hadErrors: had })
    } catch {
      // swallowed by contract
    }
  }

  /** Record a cancelled run: bookkeeping-neutral (cancel ≠ failure). */
  recordCancelled(jobId: string): void {
    // A cancel neither extends the failure streak nor clears an incident:
    // the streak is about failures, and the user aborted this cycle.
    void jobId
  }

  consecutiveErrors(jobId: string): number {
    return this.consecutive.get(jobId) ?? 0
  }
}
