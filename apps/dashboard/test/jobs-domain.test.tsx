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
  filterJobs,
  formatIntervalMs,
  formatTimestamp,
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
    })
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
    expect(validateJobDraft({ name: "x", schedule: "", description: "", payloadJson: "" })).toEqual(
      { field: "schedule", key: "jobs.errors.scheduleRequired" },
    )
    expect(
      validateJobDraft({ name: "x", schedule: "*", description: "", payloadJson: "{bad" }),
    ).toEqual({ field: "payloadJson", key: "jobs.errors.payloadInvalidJson" })
    expect(
      validateJobDraft({ name: "x", schedule: "*", description: "", payloadJson: "1" }),
    ).toBeNull()
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
})
