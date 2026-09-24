// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Cron pending-slot — exactly-once scheduling identity (hermes borrowing:
 * cron/occurrences.py + pending_slot).
 *
 * The failure mode being prevented: a scheduler tick that ADVANCES
 * `next_run_at` and then dies before dispatching silently loses the fire
 * (#107485 in hermes). The pattern:
 *
 *  1. tick marks a PENDING SLOT for the precise scheduled instant
 *     (persisted, with machine identity),
 *  2. then dispatches,
 *  3. then clears the slot on success.
 *
 * A slot left behind proves the owner died mid-dispatch — recovery runs
 * the fire exactly ONCE via the normal late/catch-up path, never N times.
 * An optional unreachable-retry ladder (hermes cron/unreachable_retry.py,
 * itself ported from Claude Cowork) allows automatic re-dispatch ONLY for
 * fires that made zero side effects (0 model/API calls — nothing to
 * double-spend).
 */

export interface PendingSlotRecord {
  /** Exact scheduled instant (ISO) — the fire's identity. */
  scheduledAt: string
  /** When the pending slot was stamped. */
  at: string
  /** Machine/process identity that stamped it. */
  by: string
}

export interface PendingSlotPersistence {
  get(key: string): Promise<PendingSlotRecord | undefined>
  set(key: string, value: PendingSlotRecord): Promise<void>
  clear(key: string): Promise<void>
}

export interface PendingSlotOptions {
  /** Identity of this scheduler instance (default: pid+random). */
  machineId?: string
  /**
   * Unreachable-retry ladder in ms (hermes: 5/15/30min). A fire that
   * reported `sideEffectCount === 0` may be re-dispatched at these delays;
   * once any side effect happened, the fire is terminal either way.
   */
  unreachableRetryLadderMs?: number[]
  now?: () => number
}

export class PendingSlotManager {
  private readonly machineId: string
  private readonly ladder: number[]
  private readonly now: () => number

  constructor(
    private persistence: PendingSlotPersistence,
    opts: PendingSlotOptions = {},
  ) {
    this.machineId =
      opts.machineId ?? `sched-${process.pid}-${Math.random().toString(36).slice(2, 6)}`
    this.ladder = opts.unreachableRetryLadderMs ?? [5 * 60_000, 15 * 60_000, 30 * 60_000]
    this.now = opts.now ?? Date.now
  }

  /**
   * Stamp a pending slot BEFORE dispatching. Persist-first is the whole
   * point: a crash after this line leaves recoverable evidence.
   */
  async markPending(key: string, scheduledAt: string): Promise<void> {
    await this.persistence.set(key, {
      scheduledAt,
      at: new Date(this.now()).toISOString(),
      by: this.machineId,
    })
  }

  /** Clear the slot after a successful dispatch. */
  async clear(key: string): Promise<void> {
    await this.persistence.clear(key)
  }

  /**
   * Read the current pending slot for a key WITHOUT touching it —
   * observability only (dashboards surface "fire armed" state). Never
   * used for dispatch decisions.
   */
  async peek(key: string): Promise<PendingSlotRecord | undefined> {
    return this.persistence.get(key)
  }

  /**
   * Recover a slot left by a dead owner. Rules (hermes):
   *  - a slot held by a LIVE owner (same machineId, recent heartbeat) is
   *    left alone;
   *    - a stale slot may be recovered EXACTLY ONCE (recovery itself is
   *    idempotent because the slot is cleared before dispatch returns);
   *  - `sideEffectCount > 0` fires are never auto-retried — surface them
   *    for a human instead.
   * @returns true when the caller should dispatch the fire.
   */
  async recoverOnce(
    key: string,
    opts: { ownerAlive?: (record: PendingSlotRecord) => boolean } = {},
  ): Promise<{ shouldDispatch: boolean; reason: string; record?: PendingSlotRecord }> {
    const record = await this.persistence.get(key)
    if (!record) return { shouldDispatch: false, reason: "no pending slot" }
    if (record.by === this.machineId) {
      // Our own slot: only recover if our own tick died long enough ago
      // that this call cannot be the same tick (caller's responsibility to
      // clear after dispatch). Same-process recovery = dispatch now.
      return { shouldDispatch: true, reason: "own stale slot", record }
    }
    if (opts.ownerAlive?.(record)) {
      return { shouldDispatch: false, reason: "owner alive", record }
    }
    await this.clear(key)
    return { shouldDispatch: true, reason: "owner dead — recovering once", record }
  }

  /**
   * Unreachable-retry ladder decision for a fire that failed with zero
   * side effects. `sideEffectCount > 0` fires are terminal (a human or
   * the caller retries deliberately); past-ladder failures are terminal.
   */
  unreachableRetryDecision(
    attempt: number,
    sideEffectCount: number,
    lastAttemptAtMs: number,
  ): {
    retry: boolean
    delayMs: number
    reason: string
  } {
    if (sideEffectCount > 0) {
      return { retry: false, delayMs: 0, reason: "side effects already happened — no auto-retry" }
    }
    const delay = this.ladder[attempt - 1]
    if (delay === undefined) {
      return { retry: false, delayMs: 0, reason: "retry ladder exhausted" }
    }
    if (this.now() < lastAttemptAtMs + 0) {
      return { retry: false, delayMs: 0, reason: "clock anomaly" }
    }
    return {
      retry: true,
      delayMs: delay,
      reason: `transient failure, zero side effects — retry in ${delay}ms`,
    }
  }
}
