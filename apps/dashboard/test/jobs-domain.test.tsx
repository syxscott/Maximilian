// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Jobs domain tests (dashboard): model-layer unit tests (defensive
 * normalization, sort/filter, draft validation, slot badge) plus render
 * smoke for JobsPanel with the data hooks mocked (settings-deep.test.tsx
 * pattern — React Query + fetch stubs interact in fragile ways under
 * jsdom; the contract under test is the model layer and the UI's states).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import jobsEn from "../src/locales/jobs.en-US.json"
import {
  EMPTY_JOB_DRAFT,
  buildJobPayload,
  dispatchStatus,
  dispatchTrail,
  filterJobs,
  formatIntervalMs,
  formatTimestamp,
  latestMaterialized,
  parsePayloadJson,
  sortJobs,
  toJobViews,
  toSlotBadge,
  validateJobDraft,
  windowList,
  type JobView,
} from "../src/components/settings/jobs-domain/model"
import { JobsPanel } from "../src/components/settings/jobs-domain/JobsPanel"

/** Domain JSONs are nested; t() looks up flat dotted keys — flatten first. */
function flatten(tree: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === "object") {
      Object.assign(out, flatten(value as Record<string, unknown>, dotted))
    } else {
      out[dotted] = String(value)
    }
  }
  return out
}

beforeAll(() => {
  const existing = getDictionary("en-US") ?? {}
  registerLocale("en-US", { ...existing, ...flatten(jobsEn as Record<string, unknown>) })
  setLocale("en-US")
})

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** Loose query-result stub: components only read these fields. */
function q(props: Record<string, unknown>) {
  return { isFetching: false, ...props }
}

const jobRow = {
  id: "job_1",
  name: "nightly",
  schedule: "0 2 * * *",
  scheduleKind: "cron",
  intervalMs: null,
  description: "nightly check",
  createdAt: "2026-09-24T10:00:00.000Z",
  updatedAt: "2026-09-24T10:00:00.000Z",
  lastTriggeredAt: "2026-09-23T02:00:00.000Z",
  nextRunAt: "2026-09-25T02:00:00.000Z",
  triggerCount: 3,
  events: [{ at: "2026-09-23T02:00:00.000Z", kind: "scheduled-trigger" }],
}

/** A row whose trail materialized a real workspace (newest backfill wins). */
function materializedRow() {
  return {
    ...jobRow,
    events: [
      ...jobRow.events,
      { at: "2026-09-23T02:00:01.000Z", kind: "dispatched", queued: true, workspaceJobId: "7" },
      {
        at: "2026-09-23T02:00:05.000Z",
        kind: "materialized",
        workspaceId: "ws-real-9",
        status: "planning",
      },
    ],
  }
}

/** A row whose newest fire failed to materialize (API rejection shape:
 * a `materialized` entry without a workspaceId, carrying the error). */
function failedRow() {
  return {
    ...jobRow,
    id: "job_fail",
    events: [
      ...jobRow.events,
      {
        at: "2026-09-23T02:30:00.000Z",
        kind: "materialized",
        error: "worker could not materialize: planning threw",
      },
    ],
  }
}

/** Record-only row (same shape as jobRow but a distinct id). */
function recordOnlyRow() {
  return { ...jobRow, id: "job_ro" }
}

// ── Model ────────────────────────────────────────────────────────────────────

describe("jobs-domain model", () => {
  it("normalizes passthrough rows into typed views", () => {
    const views = toJobViews({ jobs: [jobRow] })
    expect(views).toHaveLength(1)
    const v = views[0]
    expect(v).toMatchObject({
      id: "job_1",
      name: "nightly",
      scheduleKind: "cron",
      intervalMs: null,
      description: "nightly check",
      hasPayload: false,
      triggerCount: 3,
    })
    expect(v?.lastEvent).toEqual({
      at: "2026-09-23T02:00:00.000Z",
      kind: "scheduled-trigger",
      workspaceId: null,
    })
    // No materialized backfill in the trail → no workspace surfaced.
    expect(v?.materializedWorkspaceId).toBeNull()
  })

  it("surfaces the newest materialized workspace id from the event trail", () => {
    const v = toJobViews({
      jobs: [
        {
          id: "job_2",
          name: "nightly",
          schedule: "0 2 * * *",
          scheduleKind: "cron",
          events: [
            { at: "2026-09-23T02:00:00.000Z", kind: "scheduled-trigger" },
            {
              at: "2026-09-23T02:00:01.000Z",
              kind: "dispatched",
              queued: true,
              workspaceJobId: "42",
            },
            { at: "2026-09-23T02:00:05.000Z", kind: "materialized", workspaceId: "ws-older" },
            {
              at: "2026-09-23T02:00:09.000Z",
              kind: "materialized",
              workspaceId: "ws-real-9",
              status: "planning",
            },
          ],
        },
      ],
    })[0]
    // Newest backfill wins.
    expect(v?.materializedWorkspaceId).toBe("ws-real-9")
    expect(v?.lastEvent).toMatchObject({ kind: "materialized", workspaceId: "ws-real-9" })
  })

  it("defends the materialized-workspace scan against malformed trail entries", () => {
    const v = toJobViews({
      jobs: [
        {
          id: "job_3",
          name: "x",
          schedule: "*",
          scheduleKind: "interval",
          events: [null, 42, { kind: "materialized" }, { workspaceId: 7 }, { workspaceId: "  " }],
        },
      ],
    })[0]
    expect(v?.materializedWorkspaceId).toBeNull()
  })

  it("reports the three-state dispatch status per row", () => {
    const recordOnly = toJobViews({ jobs: [jobRow] })[0]
    const ok = toJobViews({ jobs: [materializedRow()] })[0]
    const bad = toJobViews({ jobs: [failedRow()] })[0]
    expect(dispatchStatus(recordOnly as JobView)).toBe("record-only")
    expect(dispatchStatus(ok as JobView)).toBe("materialized")
    expect(dispatchStatus(bad as JobView)).toBe("materialize-failed")
  })

  it("lets the newest failed outcome mask an older materialized success", () => {
    const v = toJobViews({
      jobs: [
        {
          id: "job_mixed",
          name: "x",
          schedule: "*",
          events: [
            { at: "2026-09-23T01:00:00.000Z", kind: "materialized", workspaceId: "ws-old" },
            { at: "2026-09-23T02:00:00.000Z", kind: "dispatch-failed", error: "queue down" },
          ],
        },
      ],
    })[0]
    expect(dispatchStatus(v as JobView)).toBe("materialize-failed")
    // …but the last workspace that DID run stays reachable for the chip.
    expect(v?.materializedWorkspaceId).toBe("ws-old")
  })

  it("picks the dispatch status by timestamp, not trail storage order", () => {
    // Newest outcome stored FIRST (reverse-chronological backfill).
    const v = toJobViews({
      jobs: [
        {
          id: "job_rev",
          name: "x",
          schedule: "*",
          events: [
            { at: "2026-09-23T09:00:00.000Z", kind: "materialized", workspaceId: "ws-late" },
            { at: "2026-09-23T08:00:00.000Z", kind: "materialized", error: "boom" },
          ],
        },
      ],
    })[0]
    expect(dispatchStatus(v as JobView)).toBe("materialized")
    expect(v?.materializedWorkspaceId).toBe("ws-late")
    expect(v?.dispatchOutcome).toMatchObject({
      kind: "materialized",
      workspaceId: "ws-late",
      failed: false,
    })
  })

  it("time-sorts the materialized trail newest-first regardless of append order", () => {
    const trail = dispatchTrail([
      { at: "2026-09-23T02:00:05.000Z", kind: "materialized", workspaceId: "ws-2" },
      { at: "2026-09-23T02:00:09.000Z", kind: "materialized", workspaceId: "ws-4" },
      { at: "2026-09-23T02:00:01.000Z", kind: "dispatched", queued: true },
      { at: "2026-09-23T02:00:07.000Z", kind: "materialized", workspaceId: "ws-3" },
      { kind: "materialized", workspaceId: "ws-undated" },
      { at: "not-a-date", kind: "materialized", workspaceId: "ws-garbage-date" },
      null,
    ])
    // Newest-first by `at`; undated/unparseable entries sink in input order;
    // non-materialization kinds ("dispatched") and garbage are dropped.
    expect(trail.map((e) => e.workspaceId)).toEqual([
      "ws-4",
      "ws-3",
      "ws-2",
      "ws-undated",
      "ws-garbage-date",
    ])
    expect(trail[0]).toMatchObject({ at: "2026-09-23T02:00:09.000Z", failed: false })
  })

  it("surfaces the globally latest materialized workspace across the list", () => {
    const jobs = toJobViews({
      jobs: [
        {
          id: "job_old",
          name: "older",
          schedule: "*",
          events: [{ at: "2026-09-23T01:00:00.000Z", kind: "materialized", workspaceId: "ws-old" }],
        },
        {
          id: "job_new",
          name: "newer",
          schedule: "*",
          events: [{ at: "2026-09-23T05:00:00.000Z", kind: "materialized", workspaceId: "ws-new" }],
        },
      ],
    })
    expect(latestMaterialized(jobs)).toEqual({ jobId: "job_new", workspaceId: "ws-new" })
  })

  it("returns no global latest when nothing ever materialized", () => {
    expect(latestMaterialized([])).toBeNull()
    expect(latestMaterialized(toJobViews({ jobs: [jobRow] }))).toBeNull()
    // Failed materializations never surface as a latest workspace.
    expect(latestMaterialized(toJobViews({ jobs: [failedRow()] }))).toBeNull()
    expect(latestMaterialized(toJobViews(null))).toBeNull()
  })

  it("treats undated successes as oldest and breaks ties by list order", () => {
    const jobs = toJobViews({
      jobs: [
        {
          id: "job_dated",
          name: "d",
          schedule: "*",
          events: [
            { at: "2026-09-23T01:00:00.000Z", kind: "materialized", workspaceId: "ws-dated" },
          ],
        },
        {
          id: "job_undated",
          name: "u",
          schedule: "*",
          events: [{ kind: "materialized", workspaceId: "ws-undated" }],
        },
        {
          id: "job_tie",
          name: "t",
          schedule: "*",
          events: [{ at: "2026-09-23T01:00:00.000Z", kind: "materialized", workspaceId: "ws-tie" }],
        },
      ],
    })
    expect(latestMaterialized(jobs)).toEqual({ jobId: "job_dated", workspaceId: "ws-dated" })
  })

  it("flags payload presence and coerces unknown schedule kinds", () => {
    const v = toJobViews({
      jobs: [{ id: "j2", name: "x", schedule: "5000", scheduleKind: "weird", payload: { a: 1 } }],
    })[0]
    expect(v?.scheduleKind).toBe("unknown")
    expect(v?.hasPayload).toBe(true)
    expect(v?.createdAt).toBeNull()
  })

  it("defends against garbage payloads", () => {
    expect(toJobViews(null)).toEqual([])
    expect(toJobViews("nope")).toEqual([])
    expect(toJobViews({ jobs: "not-an-array" })).toEqual([])
    expect(toJobViews({ jobs: [null, 42, {}, { noId: true }] })).toEqual([])
  })

  it("sorts by name and date with null dates sinking to the end", () => {
    const views = toJobViews({
      jobs: [
        { id: "b", name: "bravo", schedule: "*", createdAt: "2026-01-02T00:00:00.000Z" },
        { id: "a", name: "alpha", schedule: "*", createdAt: "2026-01-03T00:00:00.000Z" },
        { id: "c", name: "charlie", schedule: "*" }, // no createdAt
      ],
    }) as JobView[]
    expect(sortJobs(views, "name").map((v) => v.id)).toEqual(["a", "b", "c"])
    expect(sortJobs(views, "name", "desc").map((v) => v.id)).toEqual(["c", "b", "a"])
    expect(sortJobs(views, "createdAt", "desc").map((v) => v.id)).toEqual(["a", "b", "c"])
  })

  it("filters by name or schedule, case-insensitively", () => {
    const views = toJobViews({ jobs: [jobRow] }) as JobView[]
    expect(filterJobs(views, "NIGHT")).toHaveLength(1)
    expect(filterJobs(views, "0 2 * * *")).toHaveLength(1)
    expect(filterJobs(views, "zzz")).toHaveLength(0)
    expect(filterJobs(views, "  ")).toHaveLength(1)
  })

  it("caps lists and reports the hidden remainder", () => {
    const page = windowList([1, 2, 3], 2)
    expect(page).toEqual({ items: [1, 2], shown: 2, total: 3, hidden: 1 })
    expect(windowList([], 5).hidden).toBe(0)
  })

  it("formats intervals with compact units", () => {
    expect(formatIntervalMs(null)).toBeNull()
    expect(formatIntervalMs(0)).toBeNull()
    expect(formatIntervalMs(45_000)).toBe("45s")
    expect(formatIntervalMs(90_000)).toBe("1.5m")
    expect(formatIntervalMs(7_200_000)).toBe("2h")
  })

  it("parses optional payload JSON honestly", () => {
    expect(parsePayloadJson("")).toEqual({ ok: true, value: undefined })
    expect(parsePayloadJson('  {"a": 1}  ')).toEqual({ ok: true, value: { a: 1 } })
    expect(parsePayloadJson("{nope")).toMatchObject({ ok: false })
  })

  it("validates the create form draft", () => {
    expect(validateJobDraft(EMPTY_JOB_DRAFT)).toEqual({
      field: "name",
      key: "jobs.errors.nameRequired",
    })
    expect(
      validateJobDraft({
        name: "x",
        schedule: "",
        description: "",
        kind: "none",
        message: "",
        payloadJson: "",
      }),
    ).toEqual({ field: "schedule", key: "jobs.errors.scheduleRequired" })
    expect(
      validateJobDraft({
        name: "x",
        schedule: "*",
        description: "",
        kind: "none",
        message: "",
        payloadJson: "{bad",
      }),
    ).toEqual({ field: "payloadJson", key: "jobs.errors.payloadInvalidJson" })
    expect(
      validateJobDraft({
        name: "x",
        schedule: "*",
        description: "",
        kind: "none",
        message: "",
        payloadJson: "1",
      }),
    ).toBeNull()
  })

  it("defaults the draft to record-only dispatch", () => {
    expect(EMPTY_JOB_DRAFT.kind).toBe("none")
    expect(EMPTY_JOB_DRAFT.message).toBe("")
  })

  it("requires the message for workspace-kind drafts", () => {
    const base = { name: "x", schedule: "*", description: "", payloadJson: "" }
    expect(validateJobDraft({ ...base, kind: "workspace", message: "   " })).toEqual({
      field: "message",
      key: "jobs.errors.messageRequired",
    })
    expect(validateJobDraft({ ...base, kind: "workspace", message: "go" })).toBeNull()
    // Record-only drafts never need a message.
    expect(validateJobDraft({ ...base, kind: "none", message: "" })).toBeNull()
  })

  it("builds the POST payload from the draft kind", () => {
    expect(
      buildJobPayload({
        name: "j",
        schedule: "*",
        description: "",
        kind: "workspace",
        message: "  sweep  ",
        payloadJson: "",
      }),
    ).toEqual({ ok: true, value: { kind: "workspace", message: "sweep" } })
    // Record-only: legacy textarea passthrough (or nothing).
    expect(
      buildJobPayload({
        name: "j",
        schedule: "*",
        description: "",
        kind: "none",
        message: "",
        payloadJson: '{"a":1}',
      }),
    ).toEqual({ ok: true, value: { a: 1 } })
    expect(
      buildJobPayload({
        name: "j",
        schedule: "*",
        description: "",
        kind: "none",
        message: "",
        payloadJson: "",
      }),
    ).toEqual({ ok: true, value: undefined })
    // Invalid JSON in the textarea surfaces through the none-path too.
    expect(
      buildJobPayload({
        name: "j",
        schedule: "*",
        description: "",
        kind: "none",
        message: "",
        payloadJson: "{nope",
      }),
    ).toMatchObject({ ok: false })
  })

  it("maps slot payloads to badge states", () => {
    expect(toSlotBadge({ hasPendingSlot: true })).toBe("pending")
    expect(toSlotBadge({ hasPendingSlot: false })).toBe("idle")
    expect(toSlotBadge({})).toBe("unknown")
    expect(toSlotBadge(null)).toBe("unknown")
  })

  it("formats timestamps or an em-dash placeholder", () => {
    expect(formatTimestamp(null)).toBe("—")
    expect(formatTimestamp("garbage")).toBe("—")
    expect(formatTimestamp("2026-09-24T00:00:00.000Z")).toContain("2026")
  })
})

// ── Render smoke ─────────────────────────────────────────────────────────────

vi.mock("@/hooks/useJobsQueries", () => ({
  useJobs: vi.fn(),
  useCreateJob: vi.fn(),
  useDeleteJob: vi.fn(),
  useTriggerJob: vi.fn(),
  useJobSlots: vi.fn(),
}))

import * as hooks from "@/hooks/useJobsQueries"

const mocked = vi.mocked(hooks)

beforeEach(() => {
  vi.resetAllMocks()
  mocked.useCreateJob.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  mocked.useDeleteJob.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  mocked.useTriggerJob.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  mocked.useJobSlots.mockReturnValue(
    q({ data: { jobId: "job_1", hasPendingSlot: false } }) as never,
  )
})

describe("JobsPanel render smoke", () => {
  it("shows the loading state, then rows with badges and sort control", () => {
    mocked.useJobs.mockReturnValue(q({ isLoading: true }) as never)
    const { rerender } = renderWithQuery(<JobsPanel />)
    expect(screen.getByText("Loading…")).toBeTruthy()

    mocked.useJobs.mockReturnValue(
      q({ isLoading: false, isError: false, refetch: vi.fn(), data: { jobs: [jobRow] } }) as never,
    )
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <JobsPanel />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId("jobs-list")).toBeTruthy()
    expect(screen.getByText("nightly")).toBeTruthy()
    expect(screen.getByTestId("jobs-sort")).toBeTruthy()
    // Details (slot badge, last trigger) unfold per row.
    fireEvent.click(screen.getByText("nightly"))
    expect(screen.getByTestId("jobs-detail-job_1")).toBeTruthy()
    expect(screen.getByTestId("jobs-slot-badge-job_1").textContent).toBe("idle")
  })

  it("shows the empty state", () => {
    mocked.useJobs.mockReturnValue(
      q({ isLoading: false, isError: false, refetch: vi.fn(), data: { jobs: [] } }) as never,
    )
    renderWithQuery(<JobsPanel />)
    expect(screen.getByTestId("jobs-empty")).toBeTruthy()
  })

  it("shows the error state with retry", () => {
    const refetch = vi.fn()
    mocked.useJobs.mockReturnValue(q({ isLoading: false, isError: true, refetch }) as never)
    renderWithQuery(<JobsPanel />)
    expect(screen.getByText("Failed to load")).toBeTruthy()
    fireEvent.click(screen.getByText("Retry"))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("routes manual trigger and delete through the mutations", () => {
    const trigger = vi.fn()
    const remove = vi.fn()
    mocked.useTriggerJob.mockReturnValue({ mutate: trigger, isPending: false } as never)
    mocked.useDeleteJob.mockReturnValue({ mutate: remove, isPending: false } as never)
    mocked.useJobs.mockReturnValue(
      q({ isLoading: false, isError: false, refetch: vi.fn(), data: { jobs: [jobRow] } }) as never,
    )
    renderWithQuery(<JobsPanel />)
    fireEvent.click(screen.getByTestId("jobs-trigger-job_1"))
    expect(trigger).toHaveBeenCalledWith("job_1")
    fireEvent.click(screen.getByTestId("jobs-delete-job_1"))
    expect(remove).toHaveBeenCalledWith("job_1")
  })

  it("validates the create form and submits a parsed payload", async () => {
    const create = vi.fn().mockImplementation((_input, opts) => opts?.onSuccess?.({}))
    mocked.useCreateJob.mockReturnValue({ mutate: create, isPending: false } as never)
    mocked.useJobs.mockReturnValue(
      q({ isLoading: false, isError: false, refetch: vi.fn(), data: { jobs: [] } }) as never,
    )
    renderWithQuery(<JobsPanel />)
    const form = screen.getByTestId("jobs-create")

    // Empty draft → client-side validation error, no mutation.
    fireEvent.submit(form)
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByTestId("jobs-create-error").textContent).toBe("Name is required")

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "pulse" } })
    fireEvent.change(screen.getByLabelText("Schedule (cron or intervalMs)"), {
      target: { value: "*/1 * * * *" },
    })
    fireEvent.change(screen.getByLabelText("Payload JSON (optional)"), {
      target: { value: '{"workspaceId":"ws_1"}' },
    })
    fireEvent.submit(form)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toEqual({
      name: "pulse",
      schedule: "*/1 * * * *",
      payload: { workspaceId: "ws_1" },
    })
  })

  it("kind=workspace swaps the payload textarea for a message input and enqueues a dispatch payload", async () => {
    const create = vi.fn().mockImplementation((_input, opts) => opts?.onSuccess?.({}))
    mocked.useCreateJob.mockReturnValue({ mutate: create, isPending: false } as never)
    mocked.useJobs.mockReturnValue(
      q({ isLoading: false, isError: false, refetch: vi.fn(), data: { jobs: [] } }) as never,
    )
    renderWithQuery(<JobsPanel />)
    const form = screen.getByTestId("jobs-create")

    // Default kind is record-only → textarea visible, no message input.
    expect(screen.getByLabelText("Payload JSON (optional)")).toBeTruthy()
    expect(screen.queryByTestId("jobs-create-message")).toBeNull()

    fireEvent.change(screen.getByTestId("jobs-create-kind"), {
      target: { value: "workspace" },
    })
    // Workspace kind → message input appears, textarea folds away.
    expect(screen.queryByLabelText("Payload JSON (optional)")).toBeNull()
    const message = screen.getByTestId("jobs-create-message")
    expect(message).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "pulse" } })
    fireEvent.change(screen.getByLabelText("Schedule (cron or intervalMs)"), {
      target: { value: "0 2 * * *" },
    })
    // Missing message → blocked client-side, no mutation.
    fireEvent.submit(form)
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByTestId("jobs-create-error").textContent).toBe(
      "Message is required for workspace jobs",
    )

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "  rotate the reports  " },
    })
    fireEvent.submit(form)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toEqual({
      name: "pulse",
      schedule: "0 2 * * *",
      payload: { kind: "workspace", message: "rotate the reports" },
    })
  })

  it("renders the materialized workspace chip as inert text without a callback", () => {
    mocked.useJobs.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: { jobs: [materializedRow()] },
      }) as never,
    )
    // No onOpenWorkspace prop → honest degradation: the id stays visible
    // but as plain text, and clicking it must not throw.
    renderWithQuery(<JobsPanel />)
    fireEvent.click(screen.getByText("nightly")) // unfold the detail block
    const chip = screen.getByTestId("jobs-workspace-job_1")
    expect(chip.textContent).toBe("ws-real-9")
    expect(chip.tagName).toBe("SPAN")
    expect(() => fireEvent.click(chip)).not.toThrow()
  })

  it("opens the materialized workspace through the shell callback", () => {
    const openWorkspace = vi.fn()
    mocked.useJobs.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: { jobs: [materializedRow()] },
      }) as never,
    )
    renderWithQuery(<JobsPanel onOpenWorkspace={openWorkspace} activeWorkspaceId="ws-other" />)
    fireEvent.click(screen.getByText("nightly"))
    const chip = screen.getByTestId("jobs-workspace-job_1")
    expect(chip.tagName).toBe("BUTTON")
    expect(chip.getAttribute("title")).toBe("Open this workspace")
    fireEvent.click(chip)
    expect(openWorkspace).toHaveBeenCalledTimes(1)
    // The callback carries the materialized workspace id, not the job id.
    expect(openWorkspace).toHaveBeenCalledWith("ws-real-9")
  })

  it("keeps the chip inert for the already-active workspace", () => {
    const openWorkspace = vi.fn()
    mocked.useJobs.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: { jobs: [materializedRow()] },
      }) as never,
    )
    renderWithQuery(<JobsPanel onOpenWorkspace={openWorkspace} activeWorkspaceId="ws-real-9" />)
    fireEvent.click(screen.getByText("nightly"))
    const chip = screen.getByTestId("jobs-workspace-job_1")
    expect(chip.tagName).toBe("SPAN")
    fireEvent.click(chip)
    expect(openWorkspace).not.toHaveBeenCalled()
  })

  it("keeps the materialized chip visible and clickable on the collapsed row", () => {
    const openWorkspace = vi.fn()
    mocked.useJobs.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: { jobs: [materializedRow()] },
      }) as never,
    )
    renderWithQuery(<JobsPanel onOpenWorkspace={openWorkspace} activeWorkspaceId="ws-other" />)
    // No expansion first: the detail block is closed, yet the chip is on the row.
    expect(screen.queryByTestId("jobs-detail-job_1")).toBeNull()
    const chip = screen.getByTestId("jobs-workspace-job_1")
    expect(chip.tagName).toBe("BUTTON")
    fireEvent.click(chip)
    expect(openWorkspace).toHaveBeenCalledTimes(1)
    expect(openWorkspace).toHaveBeenCalledWith("ws-real-9")
  })

  it("surfaces the globally latest materialized workspace above the list", () => {
    const openWorkspace = vi.fn()
    mocked.useJobs.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          jobs: [
            {
              ...jobRow,
              id: "job_old",
              name: "older",
              events: [
                { at: "2026-09-23T01:00:00.000Z", kind: "materialized", workspaceId: "ws-old" },
              ],
            },
            {
              ...jobRow,
              id: "job_new",
              name: "newer",
              events: [
                { at: "2026-09-23T05:00:00.000Z", kind: "materialized", workspaceId: "ws-new" },
              ],
            },
          ],
        },
      }) as never,
    )
    renderWithQuery(<JobsPanel onOpenWorkspace={openWorkspace} />)
    const strip = screen.getByTestId("jobs-latest-materialized")
    // The newer fire wins even though its row is listed second.
    expect(strip.textContent).toContain("ws-new")
    expect(strip.textContent).toContain("newer")
    fireEvent.click(screen.getByTestId("jobs-latest-workspace"))
    expect(openWorkspace).toHaveBeenCalledTimes(1)
    expect(openWorkspace).toHaveBeenCalledWith("ws-new")
  })

  it("renders the three-state materialization icon per row", () => {
    mocked.useJobs.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: { jobs: [materializedRow(), failedRow(), recordOnlyRow()] },
      }) as never,
    )
    renderWithQuery(<JobsPanel />)
    const ok = screen.getByTestId("jobs-status-job_1")
    const bad = screen.getByTestId("jobs-status-job_fail")
    const recordOnly = screen.getByTestId("jobs-status-job_ro")
    // Cyan success, red failure, muted record-only — readable via title.
    expect(ok.getAttribute("title")).toBe("Materialized")
    expect(ok.className).toContain("text-cyan-600")
    expect(bad.getAttribute("title")).toBe("Materialize failed")
    expect(bad.className).toContain("text-destructive")
    expect(recordOnly.getAttribute("title")).toBe("Record-only")
    expect(recordOnly.className).toContain("text-muted-foreground")
  })
})
