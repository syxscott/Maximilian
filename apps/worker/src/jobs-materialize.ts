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
import type { AgentRuntime, ReviewResult, Workspace } from "@max/core"
import type { FileWorkspaceStore } from "@max/workspace"

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
    final = await deps.runtime.execute(workspace)
  } catch (err) {
    const message = (err as Error)?.message ?? String(err)
    log.error(
      { workspaceId: workspace.id, jobId: extras.jobId ?? "unknown", err: message },
      "materialized workspace execution threw - marking failed",
    )
    const failed: Workspace = {
      ...workspace,
      status: "failed",
      error: message,
      updatedAt: new Date().toISOString(),
    }
    try {
      await deps.store.saveWorkspace(failed, ctx.tenantId)
    } catch (saveErr) {
      log.error({ workspaceId: workspace.id, err: saveErr }, "failed to persist failed state")
    }
    throw err
  }

  // Review verdict attach (the runtime doesn't know "review" is special).
  const reviewResult = final.results.find((r) => r.agentRole === "review")
  const review = reviewResult?.metadata?.review as ReviewResult | undefined
  if (review) {
    final.review = review
    await deps.store.saveWorkspace(final, ctx.tenantId)
  }

  return final
}
