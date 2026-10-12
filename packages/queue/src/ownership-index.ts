// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Bounded recovery bookkeeping for the crash-recovery sweep (pi
 * borrowing: durable scheduler ownership indexes, commits cb4375493 +
 * ea448f454).
 *
 * The naive sweep walks EVERY task the ledger remembers: a process that
 * has completed thousands of tasks pays for all of them on every pass —
 * pi measured super-linear blowup at 500 held tasks. The lesson: the
 * sweep's candidates come from an in-memory index organized around LIVE
 * work, so a pass costs O(live), independent of history:
 *
 *   - `candidatesForSweep()` returns only RUNNING tasks — the sweep never
 *     materializes terminal history;
 *   - `runningCount` is an O(1) count (counting short-circuit);
 *   - ownership entries of terminal tasks are removed INCREMENTALLY as
 *     their last live dependent ends: a `liveBelow` counter per node, and
 *     a removal WORKLIST drained at the end of a scan/publication — never
 *     mid-operation, never a full-map walk. Chains above live work stay
 *     whole (their liveBelow stays positive), so `ownersAbove` of any
 *     live task keeps seeing its full ancestry.
 *
 * Semantics are UNCHANGED: same tasks, same classification, same verbs —
 * only the candidate generation is indexed.
 */

/** Task lifecycle states the index tracks. */
export type IndexedTaskState = "running" | "completed" | "failed" | "cancelled"

/** A task record as the ledger reports it. */
export interface IndexedTask {
  id: string
  state: IndexedTaskState
  /** Immediate owner (parent chain / conversation), when the task has one. */
  owner?: string
  /** Attempts so far — surfaced to the sweep for budget decisions. */
  attempts?: number
  /** Raw last-failure artifact. */
  lastError?: unknown
}

interface IndexedRecord {
  state: IndexedTaskState
  owner: string | undefined
  attempts: number | undefined
  lastError: unknown
}

export class RecoveryBookkeepingIndex {
  private readonly records = new Map<string, IndexedRecord>()
  /** Running task ids — the sweep's candidate set. */
  private readonly running = new Set<string>()
  /** Immediate children per owner, as observed by upserts. */
  private readonly childrenOf = new Map<string, Set<string>>()
  /** Live tasks at or below each node (its subtree). Kept nodes have > 0. */
  private readonly liveBelow = new Map<string, number>()
  /** Terminal nodes whose last live dependent ended; drained by sweepPending. */
  private readonly removable: string[] = []

  /**
   * Insert or update a task record; idempotent per id. State transitions
   * adjust the `liveBelow` counters along the owner chain and queue newly
   * unneeded terminal nodes for {@link sweepPending}.
   */
  upsert(task: IndexedTask): void {
    const previous = this.records.get(task.id)
    const wasRunning = previous?.state === "running"
    const isRunning = task.state === "running"
    // Owners are immutable in this model and a transition update may omit
    // them — stick to the previously seen owner.
    const owner = task.owner ?? previous?.owner
    this.records.set(task.id, {
      state: task.state,
      owner,
      attempts: task.attempts,
      lastError: task.lastError,
    })
    if (isRunning) this.running.add(task.id)
    else this.running.delete(task.id)

    // Wire the ownership edge once (owners are immutable in this model).
    if (owner !== undefined && previous === undefined) {
      let children = this.childrenOf.get(owner)
      if (children === undefined) {
        children = new Set()
        this.childrenOf.set(owner, children)
      }
      children.add(task.id)
    }

    if (previous === undefined) {
      // First sight of this task. Children may have wired liveBelow BEFORE
      // the record existed (records can arrive in any order), so the
      // liveliness propagated up the owner chain is the task's EFFECTIVE
      // liveliness: itself live, or live work reachable through it.
      const effectivelyLive = isRunning || (this.liveBelow.get(task.id) ?? 0) > 0
      if (effectivelyLive) {
        this.adjustAncestors(owner, +1)
      } else {
        this.removable.push(task.id)
      }
      return
    }

    if (wasRunning && !isRunning) {
      // The task ended: every ancestor loses one live descendant.
      this.adjustAncestors(owner, -1)
      if ((this.liveBelow.get(task.id) ?? 0) === 0) this.removable.push(task.id)
    } else if (!wasRunning && isRunning) {
      // The task came alive again (a retry): ancestors gain one.
      this.adjustAncestors(owner, +1)
    }
  }

  /** O(1) count of running tasks — the sweep's candidate-set size. */
  get runningCount(): number {
    return this.running.size
  }

  /**
   * Total nodes the index still retains: live work plus the terminal
   * chains that live work still reaches through. After a
   * {@link sweepPending}, this is O(live + chains above live).
   */
  get size(): number {
    return this.records.size
  }

  /** Queued-but-not-yet-swept removals (diagnostics). */
  get pendingRemovals(): number {
    return this.removable.length
  }

  /**
   * The sweep's candidates: ONLY running tasks, in insertion order. Never
   * includes terminal history — a pass costs O(live), not O(history).
   */
  candidatesForSweep(): StalledCandidate[] {
    const out: StalledCandidate[] = []
    for (const id of this.running) {
      const record = this.records.get(id)
      if (record === undefined) continue
      out.push({ id, attempts: record.attempts, lastError: record.lastError })
    }
    return out
  }

  /**
   * The ownership chain ABOVE a task (nearest owner first). Chains above
   * live work are kept whole by the liveBelow discipline.
   */
  ownersAbove(taskId: string): string[] {
    const chain: string[] = []
    let current = this.records.get(taskId)?.owner
    const seen = new Set<string>()
    while (current !== undefined && !seen.has(current)) {
      seen.add(current)
      chain.push(current)
      current = this.records.get(current)?.owner
    }
    return chain
  }

  /**
   * Drain the removal worklist: drop terminal nodes whose liveBelow has
   * not come back (a terminal task can be retried into `running` after it
   * was queued — the re-check makes that safe). O(queued), never a
   * full-map walk. Call at the END of a scan or publication.
   * Returns the number of nodes removed.
   */
  sweepPending(): number {
    const worklist = this.removable.splice(0, this.removable.length)
    let removed = 0
    for (const id of worklist) {
      if ((this.liveBelow.get(id) ?? 0) > 0) continue // needed again
      const record = this.records.get(id)
      if (record === undefined || record.state === "running") continue
      this.records.delete(id)
      removed += 1
      const owner = record.owner
      if (owner !== undefined) {
        const siblings = this.childrenOf.get(owner)
        siblings?.delete(id)
        if (siblings !== undefined && siblings.size === 0) this.childrenOf.delete(owner)
      }
    }
    return removed
  }

  /**
   * Add `delta` to the liveBelow counter of every node from `from` up the
   * owner chain. On the way down (delta -1), a terminal node whose counter
   * reaches zero is queued for removal.
   */
  private adjustAncestors(from: string | undefined, delta: 1 | -1): void {
    let current = from
    const seen = new Set<string>()
    while (current !== undefined && !seen.has(current)) {
      seen.add(current)
      const next = (this.liveBelow.get(current) ?? 0) + delta
      if (next === 0) this.liveBelow.delete(current)
      else this.liveBelow.set(current, next)
      if (delta === -1 && next === 0) {
        const record = this.records.get(current)
        if (record !== undefined && record.state !== "running") this.removable.push(current)
      }
      current = this.records.get(current)?.owner
    }
  }
}

/** The subset of an indexed task the recovery sweep consumes. */
export interface StalledCandidate {
  id: string
  attempts?: number
  lastError?: unknown
}
