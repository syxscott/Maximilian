// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Chunked timeout scheduling (minimax c172cf9 run-coordinator borrowing).
 *
 * Node clamps setTimeout delays above 2^31 - 1 ms (~24.9 days) to 1 ms, so a
 * plain `setTimeout(fn, 25 * 24 * 3600 * 1000)` fires almost IMMEDIATELY.
 * Execution budgets (exec deadlines, approval windows) legitimately exceed
 * that bound; scheduling them through {@link scheduleTimeoutChunks} preserves
 * the requested total delay as a chain of bounded chunks instead.
 */

/** Largest delay Node's setTimeout accepts verbatim (2^31 - 1 ms). */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** A scheduled, cancellable timeout chain. */
export interface ScheduledTimeout {
  /** Cancel the chain; the expiry callback will never fire afterwards. */
  clear(): void
}

/**
 * Injectable timer seam (clock injection for tests). Defaults to the real
 * global timers with `unref` applied so a pending budget never keeps the
 * process alive by itself.
 */
export interface TimerScheduler<Ticket = unknown> {
  set(fn: () => void, delayMs: number): Ticket
  clear(ticket: Ticket): void
}

/** Real-timer scheduler: unref'd setTimeout/clearTimeout. */
export const realTimerScheduler: TimerScheduler<unknown> = {
  set(fn, delayMs) {
    const timer = setTimeout(fn, delayMs)
    ;(timer as { unref?: () => void }).unref?.()
    return timer
  },
  clear(ticket) {
    clearTimeout(ticket as ReturnType<typeof setTimeout>)
  },
}

/**
 * Schedule `onExpired` after `delayMs`, regardless of how large the delay
 * is. Delays above {@link MAX_TIMER_DELAY_MS} are split into consecutive
 * bounded chunks that sum to the requested total; cancellation clears the
 * currently-armed chunk so no later chunk ever fires.
 *
 * A delay of 0 (or less) fires immediately, mirroring setTimeout semantics.
 */
export function scheduleTimeoutChunks(
  onExpired: () => void,
  delayMs: number,
  scheduler: TimerScheduler<unknown> = realTimerScheduler,
): ScheduledTimeout {
  let remainingMs = delayMs
  let ticket: unknown
  let cleared = false

  const scheduleNext = (): void => {
    if (cleared) return
    if (remainingMs <= 0) {
      onExpired()
      return
    }
    const chunkMs = Math.min(remainingMs, MAX_TIMER_DELAY_MS)
    remainingMs -= chunkMs
    ticket = scheduler.set(scheduleNext, chunkMs)
  }
  scheduleNext()

  return {
    clear() {
      cleared = true
      scheduler.clear(ticket)
    },
  }
}

/**
 * An abort signal that fires after `delayMs` — including delays above the
 * Node timer limit, which `AbortSignal.timeout` would clamp to 1 ms
 * (runtime execution-budget / approval-window borrowing).
 */
export function abortSignalAfterChunks(
  delayMs: number,
  scheduler: TimerScheduler<unknown> = realTimerScheduler,
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const scheduled = scheduleTimeoutChunks(
    () => controller.abort(new Error(`timeout after ${delayMs}ms`)),
    delayMs,
    scheduler,
  )
  return { signal: controller.signal, clear: scheduled.clear }
}
