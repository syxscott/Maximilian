// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Stop suppression window — after a user explicitly stops a session, a
 * short window (default 5s) suppresses every automatic re-trigger of the
 * same target: auto-continuation, queue re-dispatch, cron re-fire.
 *
 * Without the window, machinery that retries work on the runtime's behalf
 * immediately undoes the user's stop — the run bounces back within
 * milliseconds and the stop looks broken.
 *
 * Deliberately NOT suppressed: anything the user re-submits themselves
 * (a new prompt, an explicit execute call) — `execute()` without the
 * `autoResume` flag bypasses the gate entirely.
 *
 * Pure model with an injectable clock (house style, cf. cron-slot.ts),
 * so tests drive time instead of sleeping.
 */

/** Default suppression window after an explicit stop. */
export const DEFAULT_STOP_SUPPRESSION_WINDOW_MS = 5_000

export interface SuppressionVerdict {
  readonly suppressed: boolean
  /** How long until the window expires (0 when not suppressed). */
  readonly remainingMs: number
}

export function suppressionVerdict(
  stoppedAtMs: number | undefined,
  nowMs: number,
  windowMs: number,
): SuppressionVerdict {
  if (stoppedAtMs === undefined) return { suppressed: false, remainingMs: 0 }
  const elapsed = nowMs - stoppedAtMs
  if (elapsed < 0 || elapsed >= windowMs) return { suppressed: false, remainingMs: 0 }
  return { suppressed: true, remainingMs: windowMs - elapsed }
}

export interface StopSuppressionEntry {
  readonly stoppedAtMs: number
  readonly reason?: string
}

export interface StopSuppressionOptions {
  /** Window length in ms. Default 5000. */
  windowMs?: number
  /** Injectable clock. Default Date.now. */
  now?: () => number
}

export class StopSuppressionWindow {
  private readonly entries = new Map<string, StopSuppressionEntry>()
  private readonly windowMs: number
  private readonly now: () => number

  constructor(opts?: StopSuppressionOptions) {
    if (opts?.windowMs !== undefined && opts.windowMs < 0) {
      throw new Error("stop suppression windowMs must be >= 0")
    }
    this.windowMs = opts?.windowMs ?? DEFAULT_STOP_SUPPRESSION_WINDOW_MS
    this.now = opts?.now ?? Date.now
  }

  /**
   * Record an explicit stop of `key`. A repeated stop overwrites the
   * previous entry — the window restarts from the newest stop.
   */
  recordStop(key: string, reason?: string): void {
    this.entries.set(key, { stoppedAtMs: this.now(), ...(reason !== undefined ? { reason } : {}) })
  }

  /** Whether `key` is still inside the suppression window. */
  check(key: string, atMs?: number): SuppressionVerdict {
    const entry = this.entries.get(key)
    return suppressionVerdict(entry?.stoppedAtMs, atMs ?? this.now(), this.windowMs)
  }

  stopOf(key: string): StopSuppressionEntry | undefined {
    return this.entries.get(key)
  }

  clear(key: string): void {
    this.entries.delete(key)
  }

  /** Evict expired entries (bounded memory on long-lived runtimes). Returns the evicted count. */
  purge(): number {
    const nowMs = this.now()
    let evicted = 0
    for (const [key, entry] of this.entries) {
      if (nowMs - entry.stoppedAtMs >= this.windowMs) {
        this.entries.delete(key)
        evicted++
      }
    }
    return evicted
  }

  get size(): number {
    return this.entries.size
  }
}

/**
 * Thrown by `AgentRuntime.execute(…, { autoResume: true })` when the
 * workspace is still inside its stop suppression window. Carries the
 * remaining window so a queue/cron host can reschedule past it instead of
 * hot-looping.
 */
export class AutoResumeSuppressedError extends Error {
  constructor(
    /** The workspace whose auto-resume was suppressed. */
    public readonly workspaceId: string,
    /** Milliseconds left in the suppression window. */
    public readonly remainingMs: number,
  ) {
    super(
      `auto-resume of workspace ${workspaceId} suppressed for another ${remainingMs}ms ` +
        `(explicit stop within the suppression window)`,
    )
    this.name = "AutoResumeSuppressedError"
  }
}
