// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Scheduled-job materialization tests — the message→workspace hop the
 * worker performs for kind=workspace job fires (apps/worker/src/
 * jobs-materialize.ts). The commander/runtime/store/event-channel
 * collaborators are fakes; the contract under test is the runner flow:
 * plan → preflight/plan-review gates → provenance metadata → save →
 * jobId→workspaceId backfill → execute → review attach / failure state.
 *
 * The BullMQ wiring itself (active-hook stash, processor branch) needs a
 * live Redis + PostgreSQL to exercise end-to-end (covered by the load-test
 * workflow); a source-level guard below pins the wiring so it cannot
 * silently drift away from this module.
 */

import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import type { Plan, Workspace } from "@max/core"
import {
  JOB_MATERIALIZED_EVENT,
  ScheduledMaterializationError,
  asScheduledExtras,
  materializationEvent,
  materializeScheduledWorkspace,
  type MaterializeDeps,
  type ScheduledJobExtras,
} from "../src/jobs-materialize"

const PLAN = { id: "plan-1", tasks: [] } as unknown as Plan

function baseWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-real-1",
    userRequest: "original request",
    status: "planning",
    results: [],
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    metadata: {},
    ...overrides,
  } as Workspace
}

const EXTRAS: ScheduledJobExtras = {
  message: "sweep the staging logs",
  jobId: "job_abc",
  scheduledAt: "2026-09-24T02:00:00.000Z",
}
const CTX = { tenantId: "t1", scheduledWorkspaceId: "ws-sched-job_abc-1" }

function makeDeps(workspace = baseWorkspace()) {
  const commander = {
    plan: vi.fn(async (_message: string) => ({ workspace, plan: PLAN })),
    preflight: vi.fn((_plan: Plan) => [] as string[]),
  }
  const runtime = {
    execute: vi.fn(async (ws: Workspace) => ({
      ...ws,
      status: "completed",
      updatedAt: "2026-09-24T03:00:00.000Z",
    })),
  }
  const store = {
    saveWorkspace: vi.fn(async (_ws: Workspace, _tenantId?: string) => {}),
  }
  const publishEvent = vi.fn(
    async (_envelope: { workspaceId: string; tenantId?: string; event: unknown }) => {},
  )
  const deps = { commander, runtime, store, publishEvent } as unknown as MaterializeDeps
  return { deps, commander, runtime, store, publishEvent }
}

describe("asScheduledExtras", () => {
  it("extracts the scheduler fields off a passthrough job payload", () => {
    expect(
      asScheduledExtras({
        workspaceId: "ws-sched-job_abc-1",
        mode: "commander",
        message: "do the thing",
        jobId: "job_abc",
        scheduledAt: "2026-09-24T02:00:00.000Z",
        source: "cron-ui",
      }),
    ).toEqual({
      message: "do the thing",
      jobId: "job_abc",
      scheduledAt: "2026-09-24T02:00:00.000Z",
      source: "cron-ui",
    })
  })

  it("returns null for non-objects, blank/missing messages (never materializes junk)", () => {
    expect(asScheduledExtras(null)).toBeNull()
    expect(asScheduledExtras(undefined)).toBeNull()
    expect(asScheduledExtras("execute")).toBeNull()
    expect(asScheduledExtras({ mode: "commander" })).toBeNull()
    expect(asScheduledExtras({ message: "   " })).toBeNull()
  })

  it("omits absent optional fields instead of writing undefined keys", () => {
    const extras = asScheduledExtras({ message: "only a message" })
    expect(extras).not.toBeNull()
    expect(extras!.message).toBe("only a message")
    expect(Object.keys(extras!)).toEqual(["message"])
  })
})

describe("materializeScheduledWorkspace", () => {
  it("plans from the message, persists provenance metadata and executes the real workspace", async () => {
    const { deps, commander, runtime, store } = makeDeps()
    const final = await materializeScheduledWorkspace(deps, EXTRAS, CTX)

    expect(commander.plan).toHaveBeenCalledWith("sweep the staging logs")
    const saved = store.saveWorkspace.mock.calls[0]?.[0] as Workspace
    expect(saved.id).toBe("ws-real-1")
    expect(saved.metadata).toMatchObject({
      tenantId: "t1",
      scheduledBy: "job",
      jobId: "job_abc",
      scheduledAt: "2026-09-24T02:00:00.000Z",
    })
    // The SAME workspace object that was saved is what executes — the
    // real workspaceId is born at the save, not at the placeholder.
    expect(runtime.execute).toHaveBeenCalledWith(saved)
    expect(final.id).toBe("ws-real-1")
    expect(final.status).toBe("completed")
  })

  it("publishes the jobId→workspaceId backfill through the workspace-event channel", async () => {
    const { deps, publishEvent } = makeDeps()
    await materializeScheduledWorkspace(deps, EXTRAS, CTX)

    expect(publishEvent).toHaveBeenCalledTimes(1)
    const envelope = publishEvent.mock.calls[0]?.[0] as {
      workspaceId: string
      tenantId?: string
      event: Record<string, unknown>
    }
    expect(envelope.workspaceId).toBe("ws-real-1")
    expect(envelope.tenantId).toBe("t1")
    expect(envelope.event).toMatchObject({
      type: JOB_MATERIALIZED_EVENT,
      jobId: "job_abc",
      scheduledWorkspaceId: "ws-sched-job_abc-1",
      workspaceId: "ws-real-1",
      outcome: "materialized",
      status: "planning",
    })
  })

  it("refuses execution on preflight errors and backfills a rejected outcome", async () => {
    const { deps, commander, runtime, store, publishEvent } = makeDeps()
    commander.preflight.mockReturnValueOnce(["Plan has no tasks"])

    await expect(materializeScheduledWorkspace(deps, EXTRAS, CTX)).rejects.toBeInstanceOf(
      ScheduledMaterializationError,
    )

    expect(store.saveWorkspace).not.toHaveBeenCalled()
    expect(runtime.execute).not.toHaveBeenCalled()
    const envelope = publishEvent.mock.calls[0]?.[0] as {
      workspaceId: string
      event: Record<string, unknown>
    }
    // No real workspace exists — the backfill targets the placeholder id.
    expect(envelope.workspaceId).toBe("ws-sched-job_abc-1")
    expect(envelope.event).toMatchObject({
      type: JOB_MATERIALIZED_EVENT,
      outcome: "rejected",
      jobId: "job_abc",
    })
    expect(String(envelope.event.error)).toContain("Plan has no tasks")
  })

  it("refuses execution when the plan reviewer rejects (chat 422 parity)", async () => {
    const rejected = baseWorkspace({
      metadata: { planReview: { approved: false, requiredChanges: ["too vague"] } },
    })
    const { deps, runtime, store, publishEvent } = makeDeps(rejected)

    await expect(materializeScheduledWorkspace(deps, EXTRAS, CTX)).rejects.toThrow(/too vague/)
    expect(store.saveWorkspace).not.toHaveBeenCalled()
    expect(runtime.execute).not.toHaveBeenCalled()
    const envelope = publishEvent.mock.calls[0]?.[0] as { event: Record<string, unknown> }
    expect(envelope.event).toMatchObject({ outcome: "rejected" })
  })

  it("attaches the review verdict and persists it after execution (processor parity)", async () => {
    const { deps, runtime, store } = makeDeps()
    runtime.execute.mockImplementationOnce(
      async (ws: Workspace) =>
        ({
          ...ws,
          status: "completed",
          results: [
            {
              id: "r1",
              agentRole: "review",
              output: "verdict",
              metadata: { review: { score: 4 } },
            },
          ],
        }) as unknown as Workspace,
    )

    const final = await materializeScheduledWorkspace(deps, EXTRAS, CTX)

    expect(final.review).toEqual({ score: 4 })
    // Initial save + the review-attach save, both tenant-scoped.
    expect(store.saveWorkspace).toHaveBeenCalledTimes(2)
    for (const call of store.saveWorkspace.mock.calls) {
      expect(call[1]).toBe("t1")
    }
  })

  it("marks the workspace failed and rethrows when execution throws", async () => {
    const { deps, runtime, store, publishEvent } = makeDeps()
    runtime.execute.mockRejectedValueOnce(new Error("provider exploded"))

    await expect(materializeScheduledWorkspace(deps, EXTRAS, CTX)).rejects.toThrow(
      "provider exploded",
    )

    const lastSave = store.saveWorkspace.mock.calls.at(-1)
    const failed = lastSave?.[0] as Workspace
    expect(failed.status).toBe("failed")
    expect(failed.error).toBe("provider exploded")
    expect(lastSave?.[1]).toBe("t1")
    // The mapping backfill already fired before execution — it is not lost.
    expect(publishEvent).toHaveBeenCalledOnce()
  })

  it("carries the optional source passthrough into workspace metadata", async () => {
    const { deps, store } = makeDeps()
    await materializeScheduledWorkspace(deps, { ...EXTRAS, source: "cron-ui" }, CTX)
    const saved = store.saveWorkspace.mock.calls[0]?.[0] as Workspace
    expect(saved.metadata.source).toBe("cron-ui")
  })
})

describe("worker wiring (source-level guard)", () => {
  const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf-8")

  it("wires the active-hook stash and the processor materialization branch", () => {
    // The extras stash: "active" fires before the processor for the same
    // job (bullmq run loop), so the processor can take() what this stashed.
    expect(src).toMatch(/worker\.on\(\s*["']active["']/)
    expect(src).toContain("asScheduledExtras(job.data)")
    // The processor consumes a not-found workspace carrying a message by
    // materializing through the shared runner module.
    expect(src).toContain("materializeScheduledWorkspace(")
    expect(src).toContain("publishEvent: publishWorkspaceEvent")
  })

  it("names the materialized workspace in the completed notification", () => {
    expect(src).toContain("materializedByScheduledId")
  })
})

describe("materializationEvent", () => {
  it("keeps the correlation fields and omits absent ones", () => {
    const event = materializationEvent({
      jobId: "job_abc",
      scheduledWorkspaceId: "ws-sched-job_abc-1",
      outcome: "materialized",
      at: "2026-09-24T02:00:00.000Z",
    })
    expect(event).toMatchObject({
      type: "job-materialized",
      jobId: "job_abc",
      scheduledWorkspaceId: "ws-sched-job_abc-1",
      outcome: "materialized",
      at: "2026-09-24T02:00:00.000Z",
    })
    expect("workspaceId" in event).toBe(false)
    expect("error" in event).toBe(false)
  })
})
