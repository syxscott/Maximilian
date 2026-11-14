// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Scheduled-job materialization (runner mode) — the last hop of the jobs
 * dispatch: turn a scheduler's bare `message` into a REAL workspace run.
 *
 * The API's jobs registry (kind=workspace fires) enqueues onto the BullMQ
 * WORKSPACE_QUEUE with the standard WorkspaceJobData shape plus scheduler
 * extras (`message` / `jobId` / `scheduledAt` / `source`). The placeholder
 * `workspaceId` (`ws-sched-<jobId>-<n>`) does NOT exist in the store, so
 * the worker's normal processor would skip the job as "not found".
 *
 * This module is the runner: it mirrors POST /api/chat's commander path
 * inside the worker process (no HTTP round-trip — the worker already owns
 * a runtime and can own a Commander):
 *
 *   1. commander.plan(message)              — plan from the scheduler text
 *   2. preflight + plan-review gates        — same 400/422 semantics
 *   3. metadata {scheduledBy:"job", jobId}  — provenance on the workspace
 *   4. store.saveWorkspace(workspace)       — the real workspaceId is born
 *   5. jobId→workspaceId backfill           — through the existing
 *      publishWorkspaceEvent Redis channel (type "job-materialized"), so
 *      the API/SSE side can correlate the fire to the materialized run
 *   6. runtime.execute(workspace)           — same execution path as every
 *      other queued workspace (runtime events, evolution feeding and the
 *      autonomy observe loop all see it via the worker's normal listener)
 *
 * Failures are honest: preflight/plan-review rejections publish a
 * `rejected` backfill and throw; runtime errors persist a `failed`
 * terminal state (processor parity) and rethrow so BullMQ records the
 * job failure.
 */

import { getLogger } from "@max/telemetry"
import type { Commander } from "@max/commander"
import {
  AgentRuntime,
  AutoResumeSuppressedError,
  type ReviewResult,
  type Workspace,
} from "@max/core"
import type { FileWorkspaceStore } from "@max/workspace"
import { executeUntilPark, type ParkSignal } from "./park-yield.js"

const log = getLogger("worker:jobs-materialize")

/** Event type published through the workspace-event channel. */
export const JOB_MATERIALIZED_EVENT = "job-materialized"

/**
 * Scheduler-only extra fields a kind=workspace fire adds to the
 * WORKSPACE_QUEUE job data (mirrors `ScheduledWorkspaceJobData` in
 * apps/api/src/routes/jobs.ts — kept structural so the queue package
 * stays scheduler-agnostic).
 */
export interface ScheduledJobExtras {
  message: string
  jobId?: string
  scheduledAt?: string
  source?: string
}

/** Defensive read of the scheduler extras off a passthrough job payload. */
export function asScheduledExtras(data: unknown): ScheduledJobExtras | null {
  if (data == null || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  if (typeof d.message !== "string" || d.message.trim().length === 0) return null
  return {
    message: d.message,
    ...(typeof d.jobId === "string" ? { jobId: d.jobId } : {}),
    ...(typeof d.scheduledAt === "string" ? { scheduledAt: d.scheduledAt } : {}),
    ...(typeof d.source === "string" ? { source: d.source } : {}),
  }
}

/** Envelope shape accepted by `createWorkspaceEventPublisher` (@max/queue). */
export interface MaterializeEventSink {
  (envelope: { workspaceId: string; tenantId?: string; event: unknown }): Promise<void>
}

export interface MaterializeDeps {
  /** Plan the message — the same Commander the API's chat route uses. */
  commander: Pick<Commander, "plan" | "preflight">
  /** Execute the materialized workspace. */
  runtime: Pick<AgentRuntime, "execute">
  /** Persist the workspace (tenant-scoped like the processor's sink). */
  store: Pick<FileWorkspaceStore, "saveWorkspace">
  /** Existing publishWorkspaceEvent channel — carries the backfill. */
  publishEvent: MaterializeEventSink
  /**
   * Park-yield (borrowing; OpenAgentCore worker.go:277 — see park-yield.ts).
   * When provided, a run that parks on a human decision does NOT hold the
   * caller's slot for the whole ask timeout: the run detaches (it keeps
   * living in the runtime's waiting registry — resuming continues from the
   * park point), and this function returns the pre-execution workspace.
   */
  park?: {
    /** Per-job park signal — its observer is wired to the runtime hook. */
    signal: ParkSignal
    /**
     * Register the signal's observer under the REAL workspace id (the
     * scheduler's placeholder id never parks — it does not exist). Must be
     * called before execute so the parked edge reaches the signal.
     */
    registerParkListener: (workspaceId: string) => void
    /** Track the detached run's lifecycle promise in the worker registry. */
    detach: (detached: Promise<void>, workspaceId: string) => void
    /** Worker-side detached completion (deferred completion notification). */
    onDetachedComplete: (final: Workspace) => Promise<void>
  }
}

export interface MaterializeContext {
  /** Tenant scope of the scheduled fire (undefined = dev/no-tenant). */
  tenantId?: string
  /** The deterministic placeholder id the scheduler enqueued. */
  scheduledWorkspaceId?: string
}

/** The gate rejections (preflight / plan review) that abort materialization. */
export class ScheduledMaterializationError extends Error {
  constructor(
    message: string,
    readonly reasons: string[],
  ) {
    super(message)
    this.name = "ScheduledMaterializationError"
  }
}

/** Backfill event appended to the dispatch trail via the event channel. */
export function materializationEvent(input: {
  jobId?: string
  scheduledWorkspaceId?: string
  workspaceId?: string
  outcome: "materialized" | "rejected" | "failed"
  status?: string
  error?: string
  at: string
}): Record<string, unknown> {
  return {
    type: JOB_MATERIALIZED_EVENT,
    jobId: input.jobId ?? null,
    scheduledWorkspaceId: input.scheduledWorkspaceId ?? null,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    outcome: input.outcome,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    at: input.at,
  }
}

/** Best-effort publish — losing one backfill event must not fail the run. */
async function publishBackfill(
  deps: MaterializeDeps,
  ctx: MaterializeContext,
  event: Record<string, unknown>,
  workspaceId: string,
): Promise<void> {
  try {
    await deps.publishEvent({
      workspaceId,
      ...(ctx.tenantId !== undefined ? { tenantId: ctx.tenantId } : {}),
      event,
    })
  } catch (err) {
    log.warn({ err, workspaceId }, "job-materialized backfill publish failed")
  }
}

/**
 * Materialize a scheduled fire into a real workspace and execute it.
 * Returns the final workspace (id is the REAL one — not the placeholder).
 */
export async function materializeScheduledWorkspace(
  deps: MaterializeDeps,
  extras: ScheduledJobExtras,
  ctx: MaterializeContext = {},
): Promise<Workspace> {
  const at = new Date().toISOString()

  // 1. Plan — the message IS the user request (POST /api/chat parity).
  const { workspace, plan } = await deps.commander.plan(extras.message)

  // Review verdict attach (the runtime doesn't know "review" is special).
  // Shared by the synchronous and the detached (parked) completion path.
  const attachReviewVerdict = async (final: Workspace): Promise<void> => {
    const reviewResult = final.results.find((r) => r.agentRole === "review")
    const review = reviewResult?.metadata?.review as ReviewResult | undefined
    if (!review) return
    final.review = review
    await deps.store.saveWorkspace(final, ctx.tenantId)
  }

  // Processor parity: a failed execution must leave a `failed` terminal
  // state. Shared by the synchronous catch and the detached failure path.
  const persistFailedState = async (err: Error): Promise<void> => {
    const failed: Workspace = {
      ...workspace,
      status: "failed",
      error: err.message,
      updatedAt: new Date().toISOString(),
    }
    try {
      await deps.store.saveWorkspace(failed, ctx.tenantId)
    } catch (saveErr) {
      log.error({ workspaceId: workspace.id, err: saveErr }, "failed to persist failed state")
    }
  }

  // 2a. Preflight gate (parity with the chat route's 400).
  const preflightErrors = deps.commander.preflight(plan)
  if (preflightErrors.length > 0) {
    const error = new ScheduledMaterializationError(
      `scheduled fire rejected by preflight: ${preflightErrors.join("; ")}`,
      preflightErrors,
    )
    await publishBackfill(
      deps,
      ctx,
      materializationEvent({
        jobId: extras.jobId,
        scheduledWorkspaceId: ctx.scheduledWorkspaceId,
        outcome: "rejected",
        error: error.message,
        at,
      }),
      ctx.scheduledWorkspaceId ?? workspace.id,
    )
    throw error
  }

  // 2b. Plan-review verdict gate (parity with the chat route's 422).
  const planReview = workspace.metadata?.planReview as
    | {
        approved: boolean
        requiredChanges?: string[]
      }
    | undefined
  if (planReview && planReview.approved === false) {
    const reasons = planReview.requiredChanges ?? ["plan rejected by reviewer"]
    const error = new ScheduledMaterializationError(
      `scheduled fire rejected by plan reviewer: ${reasons.join("; ")}`,
      reasons,
    )
    await publishBackfill(
      deps,
      ctx,
      materializationEvent({
        jobId: extras.jobId,
        scheduledWorkspaceId: ctx.scheduledWorkspaceId,
        outcome: "rejected",
        error: error.message,
        at,
      }),
      ctx.scheduledWorkspaceId ?? workspace.id,
    )
    throw error
  }

  // 3. Provenance metadata (the task contract: {scheduledBy: "job", jobId}).
  workspace.metadata = {
    ...(workspace.metadata ?? {}),
    tenantId: ctx.tenantId ?? null,
    scheduledBy: "job",
    ...(extras.jobId !== undefined ? { jobId: extras.jobId } : {}),
    scheduledAt: extras.scheduledAt ?? at,
    ...(extras.source !== undefined ? { source: extras.source } : {}),
  }

  // 4. Persist — this save is where the real workspaceId starts existing.
  await deps.store.saveWorkspace(workspace, ctx.tenantId)

  // 5. Backfill the jobId→workspaceId mapping through the existing
  //    workspace-event channel. Published BEFORE execution so the mapping
  //    exists even if the process dies mid-run; live execution state flows
  //    through the normal runtime events under the same workspaceId.
  await publishBackfill(
    deps,
    ctx,
    materializationEvent({
      jobId: extras.jobId,
      scheduledWorkspaceId: ctx.scheduledWorkspaceId,
      workspaceId: workspace.id,
      outcome: "materialized",
      status: workspace.status,
      at,
    }),
    workspace.id,
  )
  log.info(
    {
      jobId: extras.jobId ?? "unknown",
      scheduledWorkspaceId: ctx.scheduledWorkspaceId ?? "unknown",
      workspaceId: workspace.id,
    },
    "scheduled fire materialized into a real workspace",
  )

  // 6. Execute — processor parity: a throw must leave a `failed` terminal
  //    state, then propagate so BullMQ records the job failure.
  let final: Workspace
  try {
    if (deps.park) {
      // Park-yield (borrowing; see MaterializeDeps.park): race execute
      // against the parked edge. The park hook reports the REAL workspace
      // id, so the observer must be registered before the first tool call.
      deps.park.registerParkListener(workspace.id)
      const raced = await executeUntilPark({
        workspaceId: workspace.id,
        execute: () => deps.runtime.execute(workspace, { autoResume: true }),
        signal: deps.park.signal,
        onDetachedComplete: async (detachedFinal) => {
          await attachReviewVerdict(detachedFinal)
          await deps.park!.onDetachedComplete(detachedFinal)
        },
        onDetachedFailure: async (err) => {
          // Post-park failures keep processor parity: persist the failed
          // terminal state (no BullMQ job left to record it).
          log.error(
            { workspaceId: workspace.id, jobId: extras.jobId ?? "unknown", err: err.message },
            "detached materialized execution threw - marking failed",
          )
          await persistFailedState(err)
        },
      })
      if (raced.outcome === "parked") {
        deps.park.detach(raced.detached, workspace.id)
        log.info(
          { workspaceId: workspace.id, jobId: extras.jobId ?? "unknown" },
          "materialized run parked on human decision - detached, slot released",
        )
        return workspace
      }
      final = raced.result
    } else {
      final = await deps.runtime.execute(workspace, { autoResume: true })
    }
  } catch (err) {
    if (err instanceof AutoResumeSuppressedError) {
      // Explicit stop within the suppression window: leave the terminal
      // state the stop path persisted and skip rethrowing (BullMQ retries
      // must not undo the stop for the rest of the window).
      log.warn(
        {
          workspaceId: workspace.id,
          jobId: extras.jobId ?? "unknown",
          remainingMs: err.remainingMs,
        },
        "materialized execution suppressed after explicit stop",
      )
      return workspace
    }
    const message = (err as Error)?.message ?? String(err)
    log.error(
      { workspaceId: workspace.id, jobId: extras.jobId ?? "unknown", err: message },
      "materialized workspace execution threw - marking failed",
    )
    await persistFailedState(err instanceof Error ? err : new Error(message))
    throw err
  }

  // Review verdict attach (the runtime doesn't know "review" is special).
  await attachReviewVerdict(final)

  return final
}
