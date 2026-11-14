// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Park-yield (borrowing; OpenAgentCore
 * services/core/internal/execution/worker.go:277 + delivery.go:349).
 *
 * OAC's scheduler counts concurrency as "active minus waiting turns": a
 * session waiting for function results stays reserved but holds no
 * execution slot. The Maximilian analogue: a BullMQ job whose runtime run
 * parks on a human decision (permission ask / approval prompt) holds its
 * WORKER_CONCURRENCY slot for the whole wait — with the default
 * permissionAskTimeoutMs of 600s, three workspaces waiting on a human
 * starve every other queued job.
 *
 * The fix mirrors OAC without changing the queue contract:
 *
 *   1. The runtime reports park transitions via its
 *      `onParkStateChange` option (waiting-registry mechanics live there,
 *      where the parked promises live).
 *   2. The processor races `runtime.execute` against the parked edge.
 *      On parked: the run STAYS ALIVE in the runtime (the in-process
 *      parked promise is the wake channel — resuming is the same
 *      continuation, so nothing re-runs), the processor arms terminal
 *      handlers on the detached run and returns, releasing the BullMQ
 *      slot immediately. The next queued job starts right away.
 *   3. A `DetachedRunRegistry` keeps the detached runs addressable so a
 *      duplicate dispatch for a parked workspace is skipped instead of
 *      double-executing, and completion/failure still persist the same
 *      terminal states the synchronous path would have written.
 *
 * Why not checkpoint + requeue across processes: today there is no
 * cross-process decision channel (the API's resolvePermission resolves
 * promises on ITS runtime instance; queue-mode parked promises live in
 * the worker), and mid-turn LLM state is not checkpointed — a resumed
 * job could only restart the turn, violating "continue from the park
 * point without re-running". Detached continuation satisfies both
 * requirements by construction. (A cross-process decision channel
 * would additionally let human answers arrive while parked; that needs
 * an apps/api change outside this package.)
 */

import { getLogger } from "@max/telemetry"
import type { AgentRuntime, Workspace } from "@max/core"

const log = getLogger("worker:park-yield")

/** Shape of the runtime's park transitions (see RuntimeOptions.onParkStateChange). */
export interface ParkStateInfo {
  workspaceId: string
  parked: boolean
}

/**
 * Per-job park signal. The processor registers `observe` as the
 * per-workspace dispatch target of the runtime's global park hook; the
 * first parked edge resolves `parked` and the processor detaches.
 */
export class ParkSignal {
  private resolveParked?: () => void
  readonly parked = new Promise<void>((resolve) => {
    this.resolveParked = resolve
  })

  /** Dispatch target for the runtime's onParkStateChange hook. */
  observe = (info: ParkStateInfo): void => {
    if (info.parked) this.resolveParked?.()
  }
}

/** Registry of runs detached from their BullMQ job (parked, still living). */
export class DetachedRunRegistry {
  private runs = new Map<string, { promise: Promise<void>; startedAt: string }>()

  /** Whether a detached run for the workspace is currently in flight. */
  has(workspaceId: string): boolean {
    return this.runs.has(workspaceId)
  }

  /**
   * Track a detached run. `promise` must already have its terminal
   * handlers attached (never rejects) — this only records it and cleans
   * up when it settles.
   */
  track(workspaceId: string, promise: Promise<void>): void {
    this.runs.set(workspaceId, { promise, startedAt: new Date().toISOString() })
    void promise.then(
      () => this.runs.delete(workspaceId),
      () => this.runs.delete(workspaceId),
    )
  }

  /** Workspace ids with detached runs (diagnostics / tests). */
  list(): string[] {
    return [...this.runs.keys()]
  }
}

/** Outcome of `executeUntilPark`. */
export type ParkYieldOutcome =
  | { outcome: "completed"; result: Workspace }
  | {
      outcome: "parked"
      /**
       * Settles (never rejects) after the detached run's terminal handlers
       * ran — the caller records it in the DetachedRunRegistry so a
       * duplicate dispatch is skipped until the run truly finished.
       */
      detached: Promise<void>
    }

export interface ExecuteUntilParkInput {
  /** The workspace this execute call belongs to (logging context). */
  workspaceId: string
  /** The runtime execute call (already bound to its workspace). */
  execute: () => Promise<Workspace>
  /** Per-job park signal wired to the runtime's park hook. */
  signal: ParkSignal
  /**
   * Runs when the DETACHED run completes successfully — the worker's
   * post-execute steps (review attach, goal judgement) must still happen
   * even though the job returned at park time.
   */
  onDetachedComplete: (final: Workspace) => Promise<void>
  /**
   * Runs when the DETACHED run throws. Mirrors the synchronous catch:
   * AutoResumeSuppressedError keeps the stop's terminal state, anything
   * else persists `failed` and rethrows into the log.
   */
  onDetachedFailure: (err: Error) => Promise<void>
}

/**
 * Race the execute call against the park edge (borrowing; see module
 * doc). Returns `completed` with the final workspace when the run
 * finished before parking, or `parked` after arming the detached
 * continuation — the caller releases its slot by returning.
 */
export async function executeUntilPark(input: ExecuteUntilParkInput): Promise<ParkYieldOutcome> {
  const exec = input.execute()
  const raced = await Promise.race([
    exec.then((result): { won: "completed"; result: Workspace } => ({ won: "completed", result })),
    input.signal.parked.then((): { won: "parked" } => ({ won: "parked" })),
  ])
  if (raced.won === "completed") return { outcome: "completed", result: raced.result }

  // Parked: the run keeps living in the runtime's waiting registry. Arm
  // the terminal handlers so the background run still persists its
  // outcome, then let the caller return (slot released).
  log.info(
    { workspaceId: input.workspaceId },
    "run parked on human decision - detaching, slot released",
  )
  const detached = exec.then(
    (final) =>
      input.onDetachedComplete(final).catch((err: unknown) => {
        log.error({ err, workspaceId: input.workspaceId }, "detached-run completion handler failed")
      }),
    (err: unknown) =>
      input
        .onDetachedFailure(err instanceof Error ? err : new Error(String(err)))
        .catch((handlerErr: unknown) => {
          log.error(
            { err: handlerErr, workspaceId: input.workspaceId },
            "detached-run failure handler failed",
          )
        }),
  )
  return { outcome: "parked", detached }
}

/** Port of AgentRuntime used by the park-yield helpers (mock-friendly). */
export type ParkYieldRuntime = Pick<AgentRuntime, "execute">
