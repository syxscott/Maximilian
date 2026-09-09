// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Steering & followup queues — pi borrowing (`packages/agent/src/agent-loop.ts`).
 *
 * pi keeps two per-run queues so a user can talk to a *running* agent:
 *   - **steering**: messages injected while the agent is mid-flight; the
 *     loop polls at safe points (tool boundaries) and folds them into the
 *     ongoing work instead of interrupting it.
 *   - **followup**: messages that arrive when the agent is about to stop;
 *     instead of exiting, the loop picks them up and keeps going.
 *
 * Maximilian adaptation: queues are per-workspace and the "safe point" is
 * the wave boundary in `AgentRuntime._executeImpl`. Steering messages
 * drained there are appended to the pending tasks' instructions (marked in
 * task metadata); followup messages left after the workspace finishes are
 * surfaced as a `followup-pending` runtime event so the API layer can kick
 * off a new cycle.
 */

export interface SteeringMessage {
  text: string
  at: string
  source?: string
}

/** `"one"` injects a single message per safe point; `"all"` drains everything. */
export type SteerMode = "one" | "all"

export interface SteeringQueueOptions {
  mode?: SteerMode
  /** Drop new messages beyond this (backpressure). Default 32. */
  maxQueue?: number
  now?: () => string
}

export class SteeringQueue {
  private readonly steeringQ: SteeringMessage[] = []
  private readonly followupQ: SteeringMessage[] = []
  private readonly mode: SteerMode
  private readonly maxQueue: number
  private readonly now: () => string

  constructor(opts: SteeringQueueOptions = {}) {
    this.mode = opts.mode ?? "all"
    this.maxQueue = opts.maxQueue ?? 32
    this.now = opts.now ?? (() => new Date().toISOString())
  }

  /** Queue a mid-flight instruction (applied at the next safe point). */
  steer(text: string, source?: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) return false
    if (this.steeringQ.length >= this.maxQueue) return false
    this.steeringQ.push({ text: trimmed, at: this.now(), ...(source ? { source } : {}) })
    return true
  }

  /** Queue a "continue with this" message for when the run is about to stop. */
  followup(text: string, source?: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) return false
    if (this.followupQ.length >= this.maxQueue) return false
    this.followupQ.push({ text: trimmed, at: this.now(), ...(source ? { source } : {}) })
    return true
  }

  /** Called at safe points (wave boundaries). Returns pending steering messages. */
  drainSteering(): SteeringMessage[] {
    if (this.mode === "one") {
      return this.steeringQ.splice(0, 1)
    }
    return this.steeringQ.splice(0, this.steeringQ.length)
  }

  /** Called at the end of a run: pending followups that should keep it going. */
  drainFollowup(): SteeringMessage[] {
    return this.followupQ.splice(0, this.followupQ.length)
  }

  peekSteering(): number {
    return this.steeringQ.length
  }

  peekFollowup(): number {
    return this.followupQ.length
  }

  clear(): void {
    this.steeringQ.length = 0
    this.followupQ.length = 0
  }
}

/**
 * Per-workspace queue registry. Queues are created lazily and persist
 * across a workspace's execution; `cleanup` drops finished workspaces so
 * the map doesn't grow unbounded.
 */
export class SteeringCoordinator {
  private readonly queues = new Map<string, SteeringQueue>()

  forWorkspace(workspaceId: string): SteeringQueue {
    let q = this.queues.get(workspaceId)
    if (!q) {
      q = new SteeringQueue()
      this.queues.set(workspaceId, q)
    }
    return q
  }

  /** Convenience: steer a workspace. Returns false when the queue is full. */
  steer(workspaceId: string, text: string, source?: string): boolean {
    return this.forWorkspace(workspaceId).steer(text, source)
  }

  followup(workspaceId: string, text: string, source?: string): boolean {
    return this.forWorkspace(workspaceId).followup(text, source)
  }

  /** True when the workspace has steering messages waiting for a safe point. */
  hasPending(workspaceId: string): boolean {
    return (this.queues.get(workspaceId)?.peekSteering() ?? 0) > 0
  }

  cleanup(workspaceId: string): void {
    this.queues.delete(workspaceId)
  }
}
