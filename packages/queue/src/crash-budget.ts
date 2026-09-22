// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * CrashBudget — sliding-window crash backoff (ZCode zcode-server-cli
 * borrowing: crashBudget.ts). Pure function: given recent crash timestamps
 * and the current time, decide whether a process may restart and how long
 * to wait. Exhausting the budget means "stop restarting — something is
 * fundamentally broken; a human or an orchestrator must intervene."
 *
 * Used by process supervisors around the BullMQ worker / gateway so a
 * crash-loop doesn't spin the machine (or burn LLM quota on boot hooks).
 */

export interface CrashBudgetOptions {
  /**
   * Backoff ladder in ms, indexed by crash ordinal within the window
   * (ZCode default pattern: exponential with a hard stop).
   */
  backoffScheduleMs?: number[]
  /** Sliding window size in ms. Default: 10 minutes. */
  windowMs?: number
  /** Max crashes allowed within the window before giving up. Default: schedule length. */
  maxCrashesInWindow?: number
}

export interface CrashBudgetDecision {
  allowRestart: boolean
  /** How long to wait before restarting (0 = immediately). */
  delayMs: number
  reason: string
}

const DEFAULT_SCHEDULE = [1_000, 5_000, 15_000, 60_000, 300_000]

export class CrashBudget {
  private readonly schedule: number[]
  private readonly windowMs: number
  private readonly maxCrashes: number
  private crashes: number[] = []

  constructor(opts: CrashBudgetOptions = {}) {
    this.schedule = opts.backoffScheduleMs ?? DEFAULT_SCHEDULE
    this.windowMs = opts.windowMs ?? 10 * 60_000
    this.maxCrashes = opts.maxCrashesInWindow ?? this.schedule.length
  }

  /**
   * Record a crash at `now` and get the restart decision. Timestamps older
   * than the window are pruned first, so a process that ran fine for hours
   * starts its budget fresh.
   */
  recordCrash(now: number): CrashBudgetDecision {
    this.crashes = this.crashes.filter((t) => now - t < this.windowMs)
    this.crashes.push(now)

    const crashesInWindow = this.crashes.length
    if (crashesInWindow > this.maxCrashes) {
      return {
        allowRestart: false,
        delayMs: 0,
        reason: `crash budget exhausted: ${crashesInWindow} crashes in ${this.windowMs / 1000}s window`,
      }
    }

    const ordinal = Math.min(crashesInWindow - 1, this.schedule.length - 1)
    const delayMs = this.schedule[ordinal]!
    return {
      allowRestart: true,
      delayMs,
      reason: `crash #${crashesInWindow} in window — restart in ${delayMs}ms`,
    }
  }

  /** Manual reset (e.g. after a successful long run proves health). */
  reset(): void {
    this.crashes = []
  }

  get size(): number {
    return this.crashes.length
  }
}
