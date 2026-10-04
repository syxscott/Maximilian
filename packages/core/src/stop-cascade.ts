// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Stop cascade — stopping a session (workspace) must stop everything it
 * derived and reclaim the partial results of every stopped unit.
 *
 * minimax-code borrowing: `child-bash-lifecycle.ts` (a child Turn owns its
 * background tasks; when the owner ends, `close()` lists every non-terminal
 * owned task and stops each with `Promise.allSettled`, aggregating failures)
 * plus `run-coordinator.ts` `stopAndSettle` (stop is not done when the abort
 * signal flips — the caller waits, bounded, for the run to settle before the
 * run is retired).
 *
 * The pure model here is runtime-agnostic: a forest of units (workspace /
 * background task ids) with derivation edges. `planStopCascade` orders the
 * units parent-before-child so a runtime can stop the root first (a stopped
 * parent cannot spawn more children mid-cascade). The runtime (runtime.ts)
 * owns the edges, the abort calls and the settle wait; these functions stay
 * synchronous and testable.
 */

import type { Task } from "./types.js"

/** One unit in the derivation forest. Root units have `parentId: null`. */
export interface StopCascadeNode {
  readonly id: string
  readonly parentId: string | null
}

/** A unit to stop, in cascade order (parents before children). */
export interface StopCascadeStep {
  readonly id: string
  readonly parentId: string | null
  /** 0 for the root, +1 per derivation hop. */
  readonly depth: number
}

/**
 * Order every unit derived from `rootId` (inclusive) parent-before-child.
 * Cycles in the edge set cannot hang the walk: a unit already visited is
 * skipped. An unknown root is still planned (synthesized as a root unit) so
 * the caller's stop attempt is observable in the report.
 */
export function planStopCascade(
  nodes: Iterable<StopCascadeNode>,
  rootId: string,
): StopCascadeStep[] {
  const parentOf = new Map<string, string | null>()
  for (const node of nodes) parentOf.set(node.id, node.parentId)

  const childrenOf = new Map<string, string[]>()
  for (const [id, parentId] of parentOf) {
    if (parentId === null || parentId === id) continue
    const siblings = childrenOf.get(parentId)
    if (siblings) siblings.push(id)
    else childrenOf.set(parentId, [id])
  }

  const steps: StopCascadeStep[] = []
  const visited = new Set<string>([rootId])
  const queue: Array<{ id: string; parentId: string | null; depth: number }> = [
    { id: rootId, parentId: parentOf.get(rootId) ?? null, depth: 0 },
  ]
  for (let head = 0; head < queue.length; head++) {
    const { id, parentId, depth } = queue[head]
    steps.push({ id, parentId, depth })
    for (const childId of childrenOf.get(id) ?? []) {
      if (visited.has(childId)) continue
      visited.add(childId)
      queue.push({ id: childId, parentId: id, depth: depth + 1 })
    }
  }
  return steps
}

/** How the stop of one unit ended. `timeout` means the unit kept running past the settle budget. */
export type CascadeStopUnitStatus = "stopped" | "timeout" | "already-terminal"

export interface CascadeStopOutcome {
  readonly id: string
  readonly status: CascadeStopUnitStatus
}

/** Partial output salvaged from a unit that did not run to completion. */
export interface PartialResultSnapshot {
  readonly id: string
  /** Results the unit had already produced when it was stopped. */
  readonly resultCount: number
  /** Truncated tail/head of the newest partial output (observability only). */
  readonly lastOutputPreview?: string
}

export interface ReclaimedPartialResult {
  readonly id: string
  readonly resultCount: number
  readonly lastOutputPreview?: string
}

/**
 * Collect the salvageable partial results of every planned unit, in plan
 * order. Units without any partial output are omitted — nothing was
 * reclaimed from them.
 */
export function reclaimPartialResults(
  steps: ReadonlyArray<StopCascadeStep>,
  snapshots: ReadonlyMap<string, PartialResultSnapshot>,
): ReclaimedPartialResult[] {
  const reclaimed: ReclaimedPartialResult[] = []
  for (const step of steps) {
    const snapshot = snapshots.get(step.id)
    if (!snapshot) continue
    if (snapshot.resultCount <= 0 && snapshot.lastOutputPreview === undefined) continue
    reclaimed.push({
      id: snapshot.id,
      resultCount: snapshot.resultCount,
      ...(snapshot.lastOutputPreview !== undefined
        ? { lastOutputPreview: snapshot.lastOutputPreview }
        : {}),
    })
  }
  return reclaimed
}

export interface CascadeStopReport {
  readonly rootId: string
  readonly reason: string
  readonly requestedAtMs: number
  readonly steps: ReadonlyArray<StopCascadeStep>
  readonly outcomes: ReadonlyArray<CascadeStopOutcome>
  readonly reclaimed: ReadonlyArray<ReclaimedPartialResult>
  /** Units that did not settle within the budget — their workspace record was left to the executor. */
  readonly timedOut: ReadonlyArray<string>
}

/**
 * Assemble the report of a completed cascade stop. Every planned step must
 * have an outcome; a missing one is a caller bug and throws rather than
 * silently understating what was stopped.
 */
export function buildCascadeStopReport(input: {
  rootId: string
  reason: string
  requestedAtMs: number
  steps: ReadonlyArray<StopCascadeStep>
  outcomes: ReadonlyArray<CascadeStopOutcome>
  reclaimed: ReadonlyArray<ReclaimedPartialResult>
}): CascadeStopReport {
  const byId = new Map(input.outcomes.map((o) => [o.id, o]))
  for (const step of input.steps) {
    if (!byId.has(step.id)) {
      throw new Error(`cascade stop: missing outcome for unit ${step.id}`)
    }
  }
  return {
    rootId: input.rootId,
    reason: input.reason,
    requestedAtMs: input.requestedAtMs,
    steps: input.steps,
    outcomes: input.outcomes,
    reclaimed: input.reclaimed,
    timedOut: input.outcomes.filter((o) => o.status === "timeout").map((o) => o.id),
  }
}

/**
 * Move every non-terminal task of a stopped workspace to `cancelled`
 * (opencode borrowing — the status already exists in types.ts). Mutates the
 * task objects in place (runtime style) and returns the cancelled ones so
 * the caller can emit per-task events. Already-terminal tasks are untouched,
 * which makes the operation idempotent.
 */
export function cancelNonTerminalTasks(
  tasks: Iterable<Task>,
  reason: string,
  atIso: string,
): Task[] {
  const cancelled: Task[] = []
  for (const task of tasks) {
    if (task.status !== "pending" && task.status !== "running") continue
    task.status = "cancelled"
    task.error = reason
    task.completedAt = atIso
    cancelled.push(task)
  }
  return cancelled
}

/**
 * Wait, bounded, for a run promise to settle (minimax `settleWithin`).
 * Never rejects: a rejected run still counts as settled.
 */
export function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const bail = (result: { settled: true; value: T } | { settled: false }) => {
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    timer = setTimeout(() => bail({ settled: false }), Math.max(0, timeoutMs))
    promise.then(
      (value) => bail({ settled: true, value }),
      () => bail({ settled: true, value: undefined as T }),
    )
  })
}
