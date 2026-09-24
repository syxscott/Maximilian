// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Automations domain tests (dashboard): model-layer unit tests for the
 * automation↔job mapping (prefix filter, payload-derived enabled state,
 * toggle rebuild plans, draft/schedule validation, slot views) plus
 * render smoke for AutomationsDomain with the data hooks mocked
 * (jobs-domain.test.tsx pattern — React Query + fetch stubs interact in
 * fragile ways under jsdom; the contract under test is the model layer
 * and the UI's states).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"
import { useNotificationStore } from "@/stores/notificationStore"

import automationsEn from "../src/locales/automations.en-US.json"
import automationsZh from "../src/locales/automations.zh-CN.json"
import {
  AUTOMATION_MIN_INTERVAL_MS,
  automationName,
  automationSummary,
  filterAutomations,
  isAutomationEnabled,
  planToggle,
  stripAutomationPrefix,
  toAutomationSlotView,
  toAutomationViews,
  triggerLabelKey,
  validateAutomationDraft,
  validateScheduleText,
  EMPTY_AUTOMATION_DRAFT,
} from "../src/components/settings/automations-domain/model"
import { AutomationsDomain } from "../src/components/settings/automations-domain/AutomationsDomain"

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
  registerLocale("en-US", {
    ...existing,
    ...flatten(automationsEn as Record<string, unknown>),
  })
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

const enabledRow = {
  id: "job_a1",
  name: "automation:nightly",
  schedule: "0 2 * * *",
  scheduleKind: "cron",
  description: "nightly check",
  payload: { enabled: true },
  createdAt: "2026-09-24T10:00:00.000Z",
  lastTriggeredAt: "2026-09-23T02:00:00.000Z",
  triggerCount: 3,
}

const disabledRow = {
  ...enabledRow,
  id: "job_a2",
  name: "automation:sweep",
  schedule: "60000",
  scheduleKind: "interval",
  payload: { enabled: false },
  triggerCount: 0,
}

const foreignRow = { id: "job_x", name: "plain-job", schedule: "*", scheduleKind: "cron" }

// ── Model: automation ↔ job mapping ─────────────────────────────────────────

describe("automations-domain model", () => {
  it("derives automations only from jobs carrying the automation: prefix", () => {
    const views = toAutomationViews({ jobs: [enabledRow, foreignRow] })
    expect(views).toHaveLength(1)
    const v = views[0]
    expect(v).toMatchObject({
      id: "job_a1",
      name: "automation:nightly",
      bareName: "nightly",
      scheduleKind: "cron",
      enabled: true,
    })
    expect(views[0]?.payload).toEqual({ enabled: true })
  })

  it("derives the enabled state from the payload marker, defensively", () => {
    const views = toAutomationViews({ jobs: [enabledRow, disabledRow] })
    expect(views.map((v) => v.enabled)).toEqual([true, false])
    // Only an explicit false inside an object disables; garbage reads enabled.
    expect(isAutomationEnabled(undefined)).toBe(true)
    expect(isAutomationEnabled(null)).toBe(true)
    expect(isAutomationEnabled("garbage")).toBe(true)
    expect(isAutomationEnabled({})).toBe(true)
    expect(isAutomationEnabled({ enabled: true })).toBe(true)
    expect(isAutomationEnabled({ enabled: false, keep: 1 })).toBe(false)
    const payloadLess = toAutomationViews({
      jobs: [{ id: "a", name: "automation:bare", schedule: "*", scheduleKind: "cron" }],
    })
    expect(payloadLess[0]?.enabled).toBe(true)
  })

  it("defends against garbage /jobs payloads", () => {
    expect(toAutomationViews(null)).toEqual([])
    expect(toAutomationViews("nope")).toEqual([])
    expect(toAutomationViews({ jobs: 9 })).toEqual([])
    expect(toAutomationViews({ jobs: [null, 42, {}, { noId: true }, foreignRow] })).toEqual([])
  })

  it("forces the automation: prefix on user-entered names, idempotently", () => {
    expect(automationName("pulse")).toBe("automation:pulse")
    expect(automationName("  pulse ")).toBe("automation:pulse")
    expect(automationName("automation:already")).toBe("automation:already")
    expect(stripAutomationPrefix("automation:nightly")).toBe("nightly")
    expect(stripAutomationPrefix("plain-job")).toBeNull()
  })

  it("filters case-insensitively over full and bare names", () => {
    const views = toAutomationViews({ jobs: [enabledRow, disabledRow] })
    expect(filterAutomations(views, "NIGHT")).toHaveLength(1)
    expect(filterAutomations(views, "automation:sweep")).toHaveLength(1)
    expect(filterAutomations(views, "zzz")).toHaveLength(0)
    expect(filterAutomations(views, "  ")).toHaveLength(2)
  })

  it("summarizes enabled/disabled counts from the derived state", () => {
    const views = toAutomationViews({ jobs: [enabledRow, disabledRow] })
    expect(automationSummary(views)).toEqual({ total: 2, enabled: 1, disabled: 1 })
    expect(automationSummary([])).toEqual({ total: 0, enabled: 0, disabled: 0 })
  })

  it("validates schedules: intervalMs floor and cron arity", () => {
    expect(validateScheduleText(String(AUTOMATION_MIN_INTERVAL_MS))).toBeNull()
    expect(validateScheduleText("500")).toEqual({
      field: "schedule",
      key: "automations.errors.intervalTooShort",
    })
    expect(validateScheduleText("*/5 * * * *")).toBeNull()
    expect(validateScheduleText("* * *")).toEqual({
      field: "schedule",
      key: "automations.errors.cronFields",
    })
    expect(validateScheduleText("1 2 3 4 5 6")).toEqual({
      field: "schedule",
      key: "automations.errors.cronFields",
    })
  })

  it("validates the create draft (presence, prefix length, schedule shape)", () => {
    expect(validateAutomationDraft(EMPTY_AUTOMATION_DRAFT)).toEqual({
      field: "name",
      key: "automations.errors.nameRequired",
    })
    expect(
      validateAutomationDraft({ name: "x".repeat(115), schedule: "*/5 * * * *", description: "" }),
    ).toEqual({ field: "name", key: "automations.errors.nameTooLong" })
    expect(
      validateAutomationDraft({ name: "x".repeat(109), schedule: "*/5 * * * *", description: "" }),
    ).toBeNull()
    expect(validateAutomationDraft({ name: "pulse", schedule: "", description: "" })).toEqual({
      field: "schedule",
      key: "automations.errors.scheduleRequired",
    })
    expect(validateAutomationDraft({ name: "pulse", schedule: "* * *", description: "" })).toEqual({
      field: "schedule",
      key: "automations.errors.cronFields",
    })
    expect(
      validateAutomationDraft({ name: "pulse", schedule: "30000", description: "d" }),
    ).toBeNull()
  })

  it("plans a disable as a rebuild with an enabled:false marker, keeping fields", () => {
    const view = toAutomationViews({ jobs: [enabledRow] })[0]
    expect(view).toBeDefined()
    const plan = planToggle(view!, false)
    expect(plan).toMatchObject({ action: "rebuild", deleteId: "job_a1" })
    if (plan.action !== "rebuild") return
    expect(plan.create).toEqual({
      name: "automation:nightly",
      schedule: "0 2 * * *",
      description: "nightly check",
      payload: { enabled: false },
    })
    // Restore recreates the pre-toggle job verbatim.
    expect(plan.restore.payload).toEqual({ enabled: true })
  })

  it("plans an enable as a rebuild that strips the disabled marker", () => {
    const view = toAutomationViews({ jobs: [disabledRow] })[0]
    const plan = planToggle(view!, true)
    if (plan.action !== "rebuild") return
    expect(plan.create.payload).toEqual({ enabled: true })
    expect(plan.restore.payload).toEqual({ enabled: false })
  })

  it("skips no-op toggles and preserves unknown payload fields", () => {
    const view = toAutomationViews({ jobs: [enabledRow] })[0]
    expect(planToggle(view!, true)).toEqual({ action: "none" })
    const off = toAutomationViews({ jobs: [disabledRow] })[0]
    expect(planToggle(off!, false)).toEqual({ action: "none" })
    const fancy = toAutomationViews({
      jobs: [
        {
          ...enabledRow,
          payload: { enabled: true, workspaceId: "ws_1", nested: { deep: true } },
        },
      ],
    })[0]
    const plan = planToggle(fancy!, false)
    if (plan.action !== "rebuild") return
    expect(plan.create.payload).toEqual({
      enabled: false,
      workspaceId: "ws_1",
      nested: { deep: true },
    })
  })

  it("disables a payload-less job with a bare {enabled:false} marker", () => {
    const view = toAutomationViews({
      jobs: [{ ...enabledRow, payload: undefined }],
    })[0]
    expect(view?.enabled).toBe(true)
    const plan = planToggle(view!, false)
    if (plan.action !== "rebuild") return
    expect(plan.create.payload).toEqual({ enabled: false })
    expect(plan.restore).not.toHaveProperty("payload")
  })

  it("picks the trigger label and maps slot responses for the history panel", () => {
    const views = toAutomationViews({ jobs: [enabledRow, disabledRow] })
    expect(triggerLabelKey(views[0]!)).toBe("automations.trigger.cron")
    expect(triggerLabelKey(views[1]!)).toBe("automations.trigger.interval")

    expect(toAutomationSlotView(null)).toEqual({ kind: "unknown", scheduledAt: null })
    expect(toAutomationSlotView({})).toEqual({ kind: "unknown", scheduledAt: null })
    expect(toAutomationSlotView({ hasPendingSlot: false })).toEqual({
      kind: "idle",
      scheduledAt: null,
    })
    expect(
      toAutomationSlotView({
        hasPendingSlot: true,
        slot: { scheduledAt: "2026-09-24T00:00:00.000Z", at: "x", by: "y" },
      }),
    ).toEqual({ kind: "pending", scheduledAt: "2026-09-24T00:00:00.000Z" })
    expect(toAutomationSlotView({ hasPendingSlot: true })).toEqual({
      kind: "pending",
      scheduledAt: null,
    })
  })

  it("keeps the zh-CN and en-US key sets in sync", () => {
    expect(Object.keys(flatten(automationsZh as Record<string, unknown>)).sort()).toEqual(
      Object.keys(flatten(automationsEn as Record<string, unknown>)).sort(),
    )
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
  useNotificationStore.getState().clear()
  mocked.useCreateJob.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  mocked.useDeleteJob.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  mocked.useTriggerJob.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  mocked.useJobSlots.mockReturnValue(
    q({ data: { jobId: "job_a1", hasPendingSlot: false } }) as never,
  )
})

describe("AutomationsDomain render smoke", () => {
  const listData = {
    jobs: [enabledRow, disabledRow, foreignRow],
    total: 3,
  }

  function showList(data: unknown = listData) {
    mocked.useJobs.mockReturnValue(
      q({ isLoading: false, isError: false, refetch: vi.fn(), data }) as never,
    )
  }

  it("renders server-derived automations only, switches reflecting the marker", () => {
    showList()
    renderWithQuery(<AutomationsDomain />)
    expect(screen.getByTestId("automations-list")).toBeTruthy()
    expect(screen.getByTestId("automations-summary").textContent).toContain("2 total")
    // The plain (non-automation) job never becomes a card.
    expect(screen.queryByTestId("automations-row-job_x")).toBeNull()
    expect(screen.getByTestId("automations-toggle-job_a1").getAttribute("aria-checked")).toBe(
      "true",
    )
    // Disabled = payload marker, rendered dimmed via the switch state.
    expect(screen.getByTestId("automations-toggle-job_a2").getAttribute("aria-checked")).toBe(
      "false",
    )
  })

  it("switch off rebuilds the job with an enabled:false marker", async () => {
    const remove = vi.fn().mockImplementation((_id, opts) => opts?.onSuccess?.())
    const create = vi.fn().mockImplementation((_input, opts) => opts?.onSuccess?.())
    mocked.useDeleteJob.mockReturnValue({ mutate: remove, isPending: false } as never)
    mocked.useCreateJob.mockReturnValue({ mutate: create, isPending: false } as never)
    showList()
    renderWithQuery(<AutomationsDomain />)

    fireEvent.click(screen.getByTestId("automations-toggle-job_a1"))
    // Optimistic flip, then the rebuild chain: DELETE + POST with the marker.
    expect(screen.getByTestId("automations-toggle-job_a1").getAttribute("aria-checked")).toBe(
      "false",
    )
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(remove).toHaveBeenCalledWith("job_a1", expect.anything())
    expect(create.mock.calls[0]?.[0]).toEqual({
      name: "automation:nightly",
      schedule: "0 2 * * *",
      description: "nightly check",
      payload: { enabled: false },
    })
  })

  it("rolls the optimistic switch back and notifies when the toggle fails", async () => {
    const remove = vi.fn().mockImplementation((_id, opts) => opts?.onError?.(new Error("boom")))
    mocked.useDeleteJob.mockReturnValue({ mutate: remove, isPending: false } as never)
    showList()
    renderWithQuery(<AutomationsDomain />)

    fireEvent.click(screen.getByTestId("automations-toggle-job_a1"))
    await waitFor(() =>
      expect(screen.getByTestId("automations-toggle-error").textContent).toContain("boom"),
    )
    // Rolled back to the server-derived state.
    expect(screen.getByTestId("automations-toggle-job_a1").getAttribute("aria-checked")).toBe(
      "true",
    )
    expect(
      useNotificationStore
        .getState()
        .items.some(
          (n) => n.kind === "error" && n.messageKey === "automations.notify.toggleFailed",
        ),
    ).toBe(true)
  })

  it("unfolds trigger history: slot badge, last trigger, and a working trigger button", () => {
    const trigger = vi.fn().mockImplementation((_id, opts) => opts?.onSuccess?.({}))
    mocked.useTriggerJob.mockReturnValue({ mutate: trigger, isPending: false } as never)
    mocked.useJobSlots.mockReturnValue(
      q({
        data: {
          jobId: "job_a1",
          hasPendingSlot: true,
          slot: { scheduledAt: "2026-09-24T00:00:00.000Z" },
        },
      }) as never,
    )
    showList()
    renderWithQuery(<AutomationsDomain />)

    expect(screen.queryByTestId("automations-detail-job_a1")).toBeNull()
    fireEvent.click(screen.getByTestId("automations-row-job_a1"))
    expect(screen.getByTestId("automations-detail-job_a1")).toBeTruthy()
    expect(screen.getByTestId("automations-slot-job_a1").textContent).toContain("Pending")
    expect(screen.getByText(/Last triggered:/)).toBeTruthy()

    fireEvent.click(screen.getByTestId("automations-trigger-job_a1"))
    expect(trigger).toHaveBeenCalledWith("job_a1", expect.anything())
    expect(
      useNotificationStore
        .getState()
        .items.some((n) => n.messageKey === "automations.notify.triggered"),
    ).toBe(true)
  })

  it("creates through the dialog with a forced prefix and echoes server errors", async () => {
    const create = vi
      .fn()
      .mockImplementation((_input, opts) =>
        opts?.onError?.(new Error("invalid cron expression: zz")),
      )
    mocked.useCreateJob.mockReturnValue({ mutate: create, isPending: false } as never)
    showList({ jobs: [], total: 0 })
    renderWithQuery(<AutomationsDomain />)

    // Empty state still offers creation.
    expect(screen.getByTestId("automations-empty")).toBeTruthy()
    fireEvent.click(screen.getByTestId("automations-new"))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "pulse" } })
    fireEvent.change(screen.getByLabelText("Schedule"), { target: { value: "*/1 * * * *" } })
    fireEvent.click(screen.getByTestId("automations-create-submit"))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toEqual({
      name: "automation:pulse",
      schedule: "*/1 * * * *",
      payload: { enabled: true },
    })
    // Server-side schedule error echoed verbatim; the dialog stays open.
    expect(screen.getByTestId("automations-draft-error").textContent).toBe(
      "invalid cron expression: zz",
    )

    create.mockImplementation((_input, opts) => opts?.onSuccess?.())
    fireEvent.click(screen.getByTestId("automations-create-submit"))
    await waitFor(() => expect(screen.queryByTestId("automations-create-dialog")).toBeNull())
  })

  it("pre-validates the schedule client-side before any request", () => {
    const create = vi.fn()
    mocked.useCreateJob.mockReturnValue({ mutate: create, isPending: false } as never)
    showList()
    renderWithQuery(<AutomationsDomain />)
    fireEvent.click(screen.getByTestId("automations-new"))

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "pulse" } })
    fireEvent.change(screen.getByLabelText("Schedule"), { target: { value: "500" } })
    fireEvent.click(screen.getByTestId("automations-create-submit"))
    expect(screen.getByTestId("automations-draft-error").textContent).toBe(
      "intervalMs must be an integer of at least 1000",
    )

    fireEvent.change(screen.getByLabelText("Schedule"), { target: { value: "* * *" } })
    fireEvent.click(screen.getByTestId("automations-create-submit"))
    expect(screen.getByTestId("automations-draft-error").textContent).toBe(
      "A cron expression needs exactly 5 fields (minute hour dom month dow)",
    )
    expect(create).not.toHaveBeenCalled()
  })

  it("shows the loading, error and empty states", () => {
    mocked.useJobs.mockReturnValue(q({ isLoading: true }) as never)
    const view = renderWithQuery(<AutomationsDomain />)
    expect(screen.getByText("Loading…")).toBeTruthy()

    mocked.useJobs.mockReturnValue(
      q({ isLoading: false, isError: true, refetch: vi.fn() }) as never,
    )
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AutomationsDomain />
      </QueryClientProvider>,
    )
    expect(screen.getByText("Failed to load")).toBeTruthy()

    showList({ jobs: [], total: 0 })
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AutomationsDomain />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId("automations-empty")).toBeTruthy()
  })

  it("deletes an automation through the confirmation dialog", async () => {
    const remove = vi.fn().mockImplementation((_id, opts) => opts?.onSuccess?.())
    mocked.useDeleteJob.mockReturnValue({ mutate: remove, isPending: false } as never)
    showList()
    renderWithQuery(<AutomationsDomain />)

    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId("automations-delete-job_a1"))
    expect(screen.getByTestId("automations-delete-dialog")).toBeTruthy()
    fireEvent.click(screen.getByTestId("automations-delete-confirm"))
    await waitFor(() => expect(remove).toHaveBeenCalledWith("job_a1", expect.anything()))
  })
})
