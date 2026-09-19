// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ActivationPool — bounded capacity for concurrently-active subagents
 * (deepseek-harness borrowing: continuable activation capacity).
 *
 * Semantics ported from dsh `continuation-activation.ts`:
 *  - Slots are reserved BEFORE the subagent is materialized ("reserve then
 *    build"); both the build-failure path and a rollback release the same
 *    token safely (release is idempotent per token).
 *  - A FULL pool REFUSES with a structured, actionable error instead of
 *    queuing — queuing when every slot is held by a parent waiting on its
 *    own children deadlocks.
 *  - The pool is owned by the root and shared by all depths of continuable
 *    children (one-shot children don't hold slots).
 */

export class ActivationLimitReachedError extends Error {
  readonly code = "subagent/activation-limit"
  readonly maxActive: number
  readonly hint: string

  constructor(maxActive: number) {
    super(
      `Subagent activation limit reached (${maxActive} active). ` +
        `Finish or interrupt running subagents before delegating more.`,
    )
    this.name = "ActivationLimitReachedError"
    this.maxActive = maxActive
    this.hint =
      "Waiting to queue would deadlock: all slots are held by parents awaiting their own children."
  }
}

export interface ActivationToken {
  readonly token: symbol
}

export class ActivationPool {
  private readonly held = new Set<symbol>()

  constructor(readonly maxActive: number) {}

  get activeCount(): number {
    return this.held.size
  }

  /**
   * Reserve a slot. Throws {@link ActivationLimitReachedError} when full —
   * deliberately NOT a queued promise (see class docs).
   */
  reserve(): ActivationToken {
    if (this.held.size >= this.maxActive) {
      throw new ActivationLimitReachedError(this.maxActive)
    }
    const token = Symbol("activation")
    this.held.add(token)
    return { token }
  }

  /**
   * Release a reserved slot. Safe to call twice, and safe when the
   * reservation itself failed (nothing to release).
   */
  release(t: ActivationToken | undefined | null): void {
    if (t) this.held.delete(t.token)
  }

  /** Run `fn` with a reserved slot; releases on both success and failure. */
  async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    const t = this.reserve()
    try {
      return await fn()
    } finally {
      this.release(t)
    }
  }
}
