// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * AutomationsDomain tests (dashboard): model-layer unit tests for the
 * automation↔job mapping (prefix filter, payload-derived enabled state,
 * toggle rebuild plans, draft/schedule validation), the slots panel
 * (status normalization, relative times, slot-key tails) and the event
 * log views (GET /jobs carries the log; newest-first, TimelineMini
 * input) plus render smoke for AutomationsDomain with the data hooks
 * mocked (jobs-domain.test.tsx pattern — React Query + fetch stubs
 * interact in fragile ways under jsdom; the contract under test is the
 * model layer and the UI's states, including the manual-trigger
 * feedback loop).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale, t } from "@max/i18n"
import { useNotificationStore } from "@/stores/notificationStore"

import automationsEn from "../src/locales/automations.en-US.json"
import automationsZh from "../src/locales/automations.zh-CN.json"
import {
  AUTOMATION_MIN_INTERVAL_MS,
  TRIGGER_FEEDBACK_MS,
  automationName,
  automationSummary,
  automationTimelineInput,
  eventKindLabelKey,
  filterAutomations,
  filterJobEvents,
  isAutomationEnabled,
  JOB_EVENT_FILTER_CHIPS,
  planToggle,
  slotKeyTail,
  slotStatusLabelKey,
  stripAutomationPrefix,
  toAutomationEventViews,
  toAutomationSlotRows,
  toAutomationViews,
  triggerLabelKey,
  validateAutomationDraft,
  validateScheduleText,
  EMPTY_AUTOMATION_DRAFT,
  type AutomationEventView,
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

/** Fixed clock for deterministic relative-time assertions. */
const NOW = Date.parse("2026-09-24T12:00:00.000Z")

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

  it("picks the trigger label from the schedule kind", () => {
    const views = toAutomationViews({ jobs: [enabledRow, disabledRow] })
    expect(triggerLabelKey(views[0]!)).toBe("automations.trigger.cron")
    expect(triggerLabelKey(views[1]!)).toBe("automations.trigger.interval")
  })

  it("keeps the zh-CN and en-US key sets in sync", () => {
    expect(Object.keys(flatten(automationsZh as Record<string, unknown>)).sort()).toEqual(
      Object.keys(flatten(automationsEn as Record<string, unknown>)).sort(),
    )
  })
})

// ── Model: slots panel + event log (trigger history read-back) ───────────────

describe("automations slots panel + event log model", () => {
  it("strips the job: namespace prefix from slot keys, defensively", () => {
    expect(slotKeyTail("job:job_ab12", "fb")).toBe("job_ab12")
    expect(slotKeyTail("other:key", "fb")).toBe("other:key")
    expect(slotKeyTail("job:", "fb")).toBe("fb")
    expect(slotKeyTail(undefined, "fb")).toBe("fb")
    expect(slotKeyTail("", "fb")).toBe("fb")
  })

  it("normalizes a pending slot into one row with key tail and relative times", () => {
    const rows = toAutomationSlotRows(
      {
        jobId: "job_a1",
        hasPendingSlot: true,
        slot: {
          scheduledAt: "2026-09-24T11:58:00.000Z",
          at: "2026-09-24T11:57:00.000Z",
          by: "api",
        },
      },
      "job_a1",
      NOW,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: "pending", keyTail: "job_a1" })
    expect(rows[0]?.scheduledAt).toBe("2026-09-24T11:58:00.000Z")
    expect(rows[0]?.scheduledAtRelative).toBe("2 minutes ago")
    expect(rows[0]?.updatedAtRelative).toBe("3 minutes ago")
  })

  it("maps a released slot to a cleared row synthesized from the job id", () => {
    expect(toAutomationSlotRows({ hasPendingSlot: false }, "job_a1", NOW)).toEqual([
      {
        status: "cleared",
        keyTail: "job_a1",
        scheduledAt: null,
        scheduledAtRelative: null,
        updatedAt: null,
        updatedAtRelative: null,
      },
    ])
  })

  it("falls back to an unknown row on garbage responses and unparseable stamps", () => {
    expect(toAutomationSlotRows(null, "job_a1")[0]?.status).toBe("unknown")
    expect(toAutomationSlotRows(undefined, "job_a1")[0]?.status).toBe("unknown")
    expect(toAutomationSlotRows("nope", "job_a1")[0]?.status).toBe("unknown")
    expect(toAutomationSlotRows({}, "job_a1")[0]?.status).toBe("unknown")
    const pending = toAutomationSlotRows(
      { hasPendingSlot: true, slot: { scheduledAt: "not-a-date" } },
      "job_a1",
      NOW,
    )[0]
    expect(pending?.status).toBe("pending")
    expect(pending?.scheduledAtRelative).toBeNull()
    expect(pending?.keyTail).toBe("job_a1")
  })

  it("labels the three slot statuses for the badge", () => {
    expect(slotStatusLabelKey("pending")).toBe("automations.slot.pending")
    expect(slotStatusLabelKey("cleared")).toBe("automations.slot.cleared")
    expect(slotStatusLabelKey("unknown")).toBe("automations.slot.unknown")
  })

  it("turns the append-only event log into newest-first views with relative times", () => {
    const views = toAutomationEventViews(
      [
        { at: "2026-09-24T10:00:00.000Z", kind: "scheduled-trigger", note: "older fire" },
        {
          at: "2026-09-24T11:59:00.000Z",
          kind: "manual-trigger",
          note: "executor v0: dispatch is record-only",
        },
      ],
      NOW,
    )
    expect(views.map((v) => v.kind)).toEqual(["manual-trigger", "scheduled-trigger"])
    expect(views[0]?.atRelative).toBe("1 minute ago")
    expect(views[0]?.labelKey).toBe("automations.event.manual")
    expect(views[0]?.note).toBe("executor v0: dispatch is record-only")
    expect(views[1]?.atRelative).toBe("2 hours ago")
    expect(views[1]?.labelKey).toBe("automations.event.scheduled")
  })

  it("maps trigger kinds to labels and defends against garbage log entries", () => {
    expect(eventKindLabelKey("manual-trigger")).toBe("automations.event.manual")
    expect(eventKindLabelKey("scheduled-trigger")).toBe("automations.event.scheduled")
    expect(eventKindLabelKey("recovered-trigger")).toBe("automations.event.recovered")
    expect(eventKindLabelKey("whatever")).toBe("automations.event.unknown")
    expect(eventKindLabelKey(undefined)).toBe("automations.event.unknown")
    expect(toAutomationEventViews(null, NOW)).toEqual([])
    expect(toAutomationEventViews("nope", NOW)).toEqual([])
    // Non-object entries are skipped; object entries map defensively.
    expect(toAutomationEventViews([null, 42, { at: 5, kind: 7 }], NOW)).toEqual([
      {
        at: null,
        atRelative: null,
        kind: "unknown",
        labelKey: "automations.event.unknown",
        note: null,
      },
    ])
  })

  it("builds TimelineMini input: kind label + note, relative time, completed tone", () => {
    const events = toAutomationEventViews(
      [{ at: "2026-09-24T11:59:00.000Z", kind: "manual-trigger", note: "record-only" }],
      NOW,
    )
    expect(automationTimelineInput(events, (key) => t(key)).items).toEqual([
      { label: "Manual trigger · record-only", time: "1 minute ago", status: "completed" },
    ])
    const bare = automationTimelineInput(
      [{ ...events[0]!, note: null, atRelative: null }],
      () => "X",
    )
    expect(bare.items).toEqual([{ label: "X", status: "completed" }])
  })

  it("carries the raw event log and payload through toAutomationViews", () => {
    const withEvents = {
      ...enabledRow,
      events: [{ at: "2026-09-23T02:00:00.000Z", kind: "manual-trigger" }],
    }
    const views = toAutomationViews({ jobs: [withEvents] })
    expect(views[0]?.events).toEqual(withEvents.events)
    const bare = toAutomationViews({
      jobs: [{ id: "j", name: "automation:x", schedule: "*", scheduleKind: "cron" }],
    })
    expect(bare[0]?.events).toBeUndefined()
  })
})

describe("automations event kind filter (filterJobEvents)", () => {
  // Newest-first views straight out of toAutomationEventViews' reversal.
  const events = toAutomationEventViews(
    [
      { at: "2026-09-24T08:00:00.000Z", kind: "scheduled-trigger", note: "oldest" },
      { at: "2026-09-24T11:00:00.000Z", kind: "recovered-trigger", note: "mid" },
      { at: "2026-09-24T11:30:00.000Z", kind: "manual-trigger", note: "later" },
      { at: "2026-09-24T11:59:00.000Z", kind: "manual-trigger", note: "newest" },
      { at: "2026-09-24T11:58:00.000Z", kind: "mystery-trigger", note: "unknown kind" },
    ],
    NOW,
  )

  it("passes the full newest-first list through under the all chip", () => {
    expect(filterJobEvents(events, "all")).toBe(events)
    expect(filterJobEvents(events, "all").map((e) => e.note)).toEqual([
      "unknown kind",
      "newest",
      "later",
      "mid",
      "oldest",
    ])
  })

  it("maps each chip onto exactly its server trigger kind", () => {
    expect(filterJobEvents(events, "manual").map((e) => e.kind)).toEqual([
      "manual-trigger",
      "manual-trigger",
    ])
    expect(filterJobEvents(events, "scheduled").map((e) => e.kind)).toEqual(["scheduled-trigger"])
    expect(filterJobEvents(events, "recovered").map((e) => e.kind)).toEqual(["recovered-trigger"])
  })

  it("keeps unknown raw kinds visible only under all, never under a chip", () => {
    for (const kind of ["manual", "scheduled", "recovered"] as const) {
      expect(filterJobEvents(events, kind).some((e) => e.kind === "mystery-trigger")).toBe(false)
    }
    expect(filterJobEvents(events, "all").some((e) => e.kind === "mystery-trigger")).toBe(true)
  })

  it("preserves the newest-first time order within each filtered scope", () => {
    const manual = filterJobEvents(events, "manual")
    expect(manual.map((e) => e.note)).toEqual(["newest", "later"])
    const parsed = manual.map((e) => Date.parse(e.at as string))
    expect([...parsed].sort((a, b) => b - a)).toEqual(parsed)
  })

  it("defends against non-array input and yields empty lists", () => {
    expect(filterJobEvents(null as unknown as AutomationEventView[], "manual")).toEqual([])
    expect(filterJobEvents(undefined as unknown as AutomationEventView[], "all")).toEqual([])
    expect(filterJobEvents([], "scheduled")).toEqual([])
  })

  it("exposes the chip row in canonical order with resolving label keys", () => {
    expect(JOB_EVENT_FILTER_CHIPS.map((c) => c.kind)).toEqual([
      "all",
      "manual",
      "scheduled",
      "recovered",
    ])
    for (const chip of JOB_EVENT_FILTER_CHIPS) {
      expect(t(chip.labelKey)).not.toBe(chip.labelKey)
    }
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

  it("unfolds into a slots panel and trigger history timeline read back from the server", () => {
    mocked.useJobSlots.mockReturnValue(
      q({
        data: {
          jobId: "job_a1",
          hasPendingSlot: true,
          slot: { scheduledAt: "2026-09-24T11:58:00.000Z", at: "2026-09-24T11:57:00.000Z" },
        },
      }) as never,
    )
    showList({
      jobs: [
        {
          ...enabledRow,
          events: [
            {
              at: "2026-09-23T02:00:00.000Z",
              kind: "scheduled-trigger",
              note: "executor v0: dispatch is record-only",
            },
            { at: "2026-09-24T06:00:00.000Z", kind: "manual-trigger" },
          ],
        },
        disabledRow,
        foreignRow,
      ],
      total: 3,
    })
    renderWithQuery(<AutomationsDomain />)
    expect(screen.queryByTestId("automations-detail-job_a1")).toBeNull()
    fireEvent.click(screen.getByTestId("automations-row-job_a1"))
    expect(screen.getByTestId("automations-detail-job_a1")).toBeTruthy()

    // Slots panel: pending badge, stripped key tail, labeled relative times.
    expect(screen.getByTestId("automations-slot-job_a1").textContent).toBe("Pending")
    const slotRow = screen.getByTestId("automations-slot-row-job_a1").textContent ?? ""
    expect(slotRow).toContain("job_a1")
    expect(slotRow).toContain("Scheduled")
    expect(slotRow).toContain("Updated")
    expect(slotRow).not.toContain("job:")

    // Event log → vertical mini timeline, newest first, note composed in.
    const timeline = screen.getByTestId("automations-timeline-job_a1").textContent ?? ""
    expect(timeline).toContain("Manual trigger")
    expect(timeline).toContain("Scheduled trigger · executor v0: dispatch is record-only")
    expect(timeline.indexOf("Manual trigger")).toBeLessThan(timeline.indexOf("Scheduled trigger"))

    // lastTriggeredAt still part of the read-back.
    expect(screen.getByTestId("automations-detail-job_a1").textContent).toContain("Last triggered:")
  })

  it("shows a cleared slot row and the history empty state without data", () => {
    mocked.useJobSlots.mockReturnValue(
      q({ data: { jobId: "job_a1", hasPendingSlot: false } }) as never,
    )
    showList()
    renderWithQuery(<AutomationsDomain />)
    fireEvent.click(screen.getByTestId("automations-row-job_a1"))
    expect(screen.getByTestId("automations-slot-job_a1").textContent).toBe("Cleared")
    expect(screen.getByTestId("automations-history-job_a1").textContent).toContain(
      "No triggers recorded yet",
    )
    expect(screen.queryByTestId("automations-timeline-job_a1")).toBeNull()
  })

  it("filters the history timeline by kind chip and shows the filtered-empty state", () => {
    showList({
      jobs: [
        {
          ...enabledRow,
          events: [
            { at: "2026-09-23T02:00:00.000Z", kind: "scheduled-trigger", note: "oldest" },
            { at: "2026-09-24T06:00:00.000Z", kind: "manual-trigger", note: "earlier run" },
            { at: "2026-09-24T11:30:00.000Z", kind: "manual-trigger", note: "latest run" },
          ],
        },
        disabledRow,
        foreignRow,
      ],
      total: 3,
    })
    renderWithQuery(<AutomationsDomain />)
    fireEvent.click(screen.getByTestId("automations-row-job_a1"))

    // The chips render as a pressed-state group; "all" starts active.
    const group = screen.getByTestId("automations-event-filter-job_a1")
    expect(group.textContent).toContain("All")
    expect(screen.getByTestId("automations-event-chip-all").getAttribute("aria-pressed")).toBe(
      "true",
    )
    expect(screen.getByTestId("automations-event-chip-manual").getAttribute("aria-pressed")).toBe(
      "false",
    )

    const timelineText = () => screen.getByTestId("automations-timeline-job_a1").textContent ?? ""
    // All events, newest first: the newest manual fire leads the timeline.
    expect(timelineText().indexOf("latest run")).toBeLessThan(
      timelineText().lastIndexOf("Manual trigger"),
    )
    expect(timelineText().lastIndexOf("Manual trigger")).toBeLessThan(
      timelineText().indexOf("Scheduled trigger · oldest"),
    )

    // Manual chip: only the manual fires survive, still newest-first.
    fireEvent.click(screen.getByTestId("automations-event-chip-manual"))
    expect(screen.getByTestId("automations-event-chip-manual").getAttribute("aria-pressed")).toBe(
      "true",
    )
    expect(timelineText()).toContain("Manual trigger")
    expect(timelineText()).not.toContain("Scheduled trigger")
    expect(timelineText().indexOf("latest run")).toBeLessThan(
      timelineText().lastIndexOf("Manual trigger"),
    )

    // Recovered chip: no recovered fires exist → the filtered-empty state
    // replaces the timeline instead of an empty TimelineMini.
    fireEvent.click(screen.getByTestId("automations-event-chip-recovered"))
    expect(screen.queryByTestId("automations-timeline-job_a1")).toBeNull()
    expect(screen.getByTestId("automations-history-filtered-empty-job_a1").textContent).toContain(
      "No triggers of this kind yet",
    )

    // Back to all: the full newest-first timeline returns.
    fireEvent.click(screen.getByTestId("automations-event-chip-all"))
    expect(screen.getByTestId("automations-timeline-job_a1")).toBeTruthy()
    expect(timelineText()).toContain("Scheduled trigger · oldest")
  })

  it("runs the trigger feedback loop: spinner, inline success, auto-dismiss", () => {
    vi.useFakeTimers()
    try {
      let settle: { onSuccess?: (d: unknown) => void; onError?: (e: Error) => void } | undefined
      const trigger = vi.fn().mockImplementation((_id, opts) => {
        settle = opts
      })
      mocked.useTriggerJob.mockReturnValue({ mutate: trigger, isPending: false } as never)
      showList()
      renderWithQuery(<AutomationsDomain />)
      fireEvent.click(screen.getByTestId("automations-row-job_a1"))

      // Optimistic pending state: spinner + disabled button.
      fireEvent.click(screen.getByTestId("automations-trigger-job_a1"))
      expect(screen.getByTestId("automations-trigger-spinner-job_a1")).toBeTruthy()
      expect(screen.getByTestId("automations-trigger-job_a1").hasAttribute("disabled")).toBe(true)

      act(() => settle?.onSuccess?.({}))
      expect(screen.queryByTestId("automations-trigger-spinner-job_a1")).toBeNull()
      const feedback = screen.getByTestId("automations-trigger-feedback-job_a1")
      expect(feedback.textContent).toContain('Triggered "nightly"')

      // Inline note auto-dismisses after 3s.
      act(() => {
        vi.advanceTimersByTime(TRIGGER_FEEDBACK_MS)
      })
      expect(screen.queryByTestId("automations-trigger-feedback-job_a1")).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows the inline failure note with the server error message", () => {
    let settle: { onSuccess?: (d: unknown) => void; onError?: (e: Error) => void } | undefined
    const trigger = vi.fn().mockImplementation((_id, opts) => {
      settle = opts
    })
    mocked.useTriggerJob.mockReturnValue({ mutate: trigger, isPending: false } as never)
    showList()
    renderWithQuery(<AutomationsDomain />)
    fireEvent.click(screen.getByTestId("automations-row-job_a1"))
    fireEvent.click(screen.getByTestId("automations-trigger-job_a1"))
    act(() => settle?.onError?.(new Error("Unknown job: job_a1")))
    const feedback = screen.getByTestId("automations-trigger-feedback-job_a1")
    expect(feedback.textContent).toContain("Trigger failed")
    expect(feedback.textContent).toContain("Unknown job: job_a1")
    expect(trigger).toHaveBeenCalledWith("job_a1", expect.anything())
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
