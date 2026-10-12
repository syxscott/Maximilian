// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Hydration invalidation whole-read retry (openclaw borrowing:
 * `session-actor.worker.ts`, commit 60d35878f03).
 *
 * A session read is not atomic by accident: it hydrates a projection from
 * several underlying rows, and a concurrent write can land BETWEEN those
 * reads. The openclaw lesson: don't try to patch the half-hydrated
 * snapshot — detect that the underlying version moved during the read and
 * retry the COMPLETE read once, revalidating every dependent on the retry
 * path. A snapshot invalidated a second time is not transient anymore and
 * surfaces the error instead of looping.
 *
 * Pure model + injected version probe: the store wires a real probe
 * (SQLite `data_version`), tests inject a fake.
 */

/** Thrown when a read was invalidated during hydration AND on its one retry. */
export class HydrationInvalidatedError extends Error {
  readonly attempts: number
  constructor(attempts: number) {
    super(`underlying store changed during hydration on ${attempts} consecutive reads`)
    this.name = "HydrationInvalidatedError"
    this.attempts = attempts
  }
}

export interface HydrationRetryOptions {
  /**
   * Whole-read retries after a detected invalidation. The openclaw
   * contract is exactly one — a second invalidation is an error. Keep the
   * default unless a caller has measured a reason otherwise.
   */
  maxRetries?: number
}

/**
 * Run `read` and detect invalidation by comparing the version probe before
 * and after it. Version equality across the read ⇒ the snapshot is whole;
 * inequality ⇒ something wrote underneath us mid-hydration ⇒ re-run the
 * complete read (which revalidates all of its dependencies, because it
 * rebuilds them from scratch). Retain the invalidation error when the
 * fresh snapshot is invalidated again.
 *
 * The probe must be cheap and monotone-ish (any change in its return
 * value means "the underlying store moved"); SQLite's `PRAGMA data_version`
 * and a file mtime are typical. Exceptions thrown by `read` propagate —
 * this helper only arbitrates invalidation, not failures.
 */
export function readWithHydrationRetry<T>(
  probe: () => string | number,
  read: () => T,
  options: HydrationRetryOptions = {},
): T {
  const maxRetries = options.maxRetries ?? 1
  let attempts = 0
  // One attempt past the retry budget so the final attempt's invalidation
  // surfaces as an error, not a success of unverified provenance.
  for (;;) {
    attempts += 1
    const before = probe()
    const result = read()
    const after = probe()
    if (before === after) return result
    if (attempts > maxRetries) throw new HydrationInvalidatedError(attempts)
    // Invalidate and re-read from scratch: `read` revalidates its own
    // dependencies because it rebuilds them.
  }
}

/**
 * Convenience wrapper for async probes/reads (e.g. a Redis VERSION or a
 * remote revision counter). Same whole-read retry contract.
 */
export async function readWithHydrationRetryAsync<T>(
  probe: () => Promise<string | number> | string | number,
  read: () => Promise<T> | T,
  options: HydrationRetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 1
  for (let attempts = 1; ; attempts += 1) {
    const before = await probe()
    const result = await read()
    const after = await probe()
    if (before === after) return result
    if (attempts > maxRetries) throw new HydrationInvalidatedError(attempts)
  }
}
