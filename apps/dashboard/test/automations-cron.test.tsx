// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Cron editing suite tests (conductor scheduler borrowing): model-layer
 * unit tests for cursor→field mapping, field palette, soft issues and the
 * fixed-clock schedule preview (5-minute-step cron via vi-controlled now
 * + cronjs-matcher with hasSeconds:false), plus render tests for the
 * CronScheduleField (template dropdown, cursor-linked field help, dual
 * timezone preview) and the create dialog's soft-issue confirm flow.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale, t } from "@max/i18n"

import automationsEn from "../src/locales/automations.en-US.json"
import {
  CRON_FIELD_COLORS,
  CRON_FIELD_HELP,
  CRON_TEMPLATES,
  AUTOMATION_CHATTY_INTERVAL_MS,
  AUTOMATION_MIN_INTERVAL_MS,
  SCHEDULE_PREVIEW_RUN_COUNT,
  buildSchedulePreview,
  collectScheduleSoftIssues,
  cursorToFieldIndex,
  toScheduleRunRows,
} from "../src/components/settings/automations-domain/model"
import { CronScheduleField } from "../src/components/settings/automations-domain/CronScheduleField"
import { AutomationsDomain } from "../src/components/settings/automations-domain/AutomationsDomain"
import { useNotificationStore } from "@/stores/notificationStore"

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
  // jsdom lacks the pointer-capture and scroll APIs Radix Select relies on
  // when it opens and an option is clicked — stub them (scoped to this
  // file's jsdom instance).
  if (typeof Element.prototype.hasPointerCapture !== "function") {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => {}
  }
})

/** Fixed clock for deterministic next-runs assertions. */
const FIXED_NOW = Date.parse("2026-11-14T09:47:03Z")

// ── Model: palette, templates, cursor mapping ────────────────────────────────

describe("automations-domain cron: palette + templates", () => {
  it("ships five distinct field colors and five help entries (5-field crons)", () => {
    expect(CRON_FIELD_COLORS).toHaveLength(5)
    expect(new Set(CRON_FIELD_COLORS).size).toBe(5)
    expect(CRON_FIELD_HELP).toHaveLength(5)
    expect(CRON_FIELD_HELP.map((f) => f.color)).toEqual([...CRON_FIELD_COLORS])
  })

  it("offers only plain 5-field templates the server accepts", () => {
    expect(CRON_TEMPLATES.length).toBeGreaterThanOrEqual(5)
    for (const template of CRON_TEMPLATES) {
      // No Quartz seconds slot, no `?` wildcard — plain 5-field cron.
      expect(template.expr.split(/\s+/)).toHaveLength(5)
      expect(template.expr).not.toContain("?")
      expect(buildSchedulePreview(template.expr, { now: FIXED_NOW }).errorKey).toBeNull()
    }
  })

  it("maps the caret onto the field it sits in", () => {
    const expr = "*/5 * * * *"
    expect(cursorToFieldIndex(expr, 0)).toBe(0)
    expect(cursorToFieldIndex(expr, 3)).toBe(0) // inside "*/5"
    expect(cursorToFieldIndex(expr, 4)).toBe(0) // trailing space keeps field 0
    expect(cursorToFieldIndex(expr, 5)).toBe(1) // start of "*"
    expect(cursorToFieldIndex(expr, 10)).toBe(3)
    // Clamped to five fields even with trailing whitespace.
    expect(cursorToFieldIndex(`${expr}   `, expr.length + 3)).toBe(4)
    expect(cursorToFieldIndex("", 0)).toBe(0)
  })
})

// ── Model: soft issues ───────────────────────────────────────────────────────

describe("automations-domain cron: soft issues", () => {
  it("flags sub-minute intervals as chatty but accepts a quiet minute", () => {
    expect(collectScheduleSoftIssues("30000")).toEqual([
      { key: "automations.softIssues.chattyInterval", params: { seconds: 30 } },
    ])
    expect(collectScheduleSoftIssues(String(AUTOMATION_CHATTY_INTERVAL_MS))).toEqual([])
    expect(collectScheduleSoftIssues(String(AUTOMATION_MIN_INTERVAL_MS))).toEqual([
      { key: "automations.softIssues.chattyInterval", params: { seconds: 1 } },
    ])
  })

  it("flags restricted dom+dow together (standard cron ORs them)", () => {
    expect(collectScheduleSoftIssues("0 9 1 * 1")).toEqual([
      { key: "automations.softIssues.domDowBoth" },
    ])
    // Either field unrestricted → no gotcha.
    expect(collectScheduleSoftIssues("0 9 * * 1")).toEqual([])
    expect(collectScheduleSoftIssues("0 9 1 * *")).toEqual([])
    expect(collectScheduleSoftIssues("*/5 * * * *")).toEqual([])
    expect(collectScheduleSoftIssues("")).toEqual([])
  })
})

// ── Model: schedule preview (fixed clock) ────────────────────────────────────

describe("automations-domain cron: buildSchedulePreview", () => {
  it("computes the next ten runs for */5 * * * * from a fixed clock", () => {
    const preview = buildSchedulePreview("*/5 * * * *", { now: FIXED_NOW })
    expect(preview.kind).toBe("cron")
    expect(preview.errorKey).toBeNull()
    expect(preview.nextRuns).toHaveLength(SCHEDULE_PREVIEW_RUN_COUNT)
    // First run is the next 5-minute boundary after 09:47:03Z.
    expect(preview.nextRuns[0]).toBe(Date.parse("2026-11-14T09:50:00Z"))
    expect(preview.nextRuns[1]).toBe(Date.parse("2026-11-14T09:55:00Z"))
    expect(preview.nextRuns[2]).toBe(Date.parse("2026-11-14T10:00:00Z"))
    for (let i = 1; i < preview.nextRuns.length; i += 1) {
      expect(preview.nextRuns[i] - preview.nextRuns[i - 1]).toBe(300_000)
    }
    expect(preview.description).toBe("Every 5 minutes")
  })

  it("localizes the human description (zh_CN via cronstrue/i18n)", () => {
    const preview = buildSchedulePreview("*/5 * * * *", { now: FIXED_NOW, locale: "zh-CN" })
    expect(preview.description).toContain("5 分钟")
  })

  it("computes interval runs with a local loop, no cron parser involved", () => {
    const preview = buildSchedulePreview("30000", { now: FIXED_NOW })
    expect(preview.kind).toBe("interval")
    expect(preview.description).toBeNull()
    expect(preview.nextRuns[0]).toBe(FIXED_NOW + 30_000)
    expect(preview.nextRuns[1]).toBe(FIXED_NOW + 60_000)
    expect(preview.nextRuns).toHaveLength(SCHEDULE_PREVIEW_RUN_COUNT)
  })

  it("rejects too-short intervals with the hard error key", () => {
    const preview = buildSchedulePreview("500", { now: FIXED_NOW })
    expect(preview.kind).toBe("invalid")
    expect(preview.errorKey).toBe("automations.errors.intervalTooShort")
    expect(preview.nextRuns).toEqual([])
  })

  it("rejects non-5-field cron shapes", () => {
    expect(buildSchedulePreview("*/5 * * *", { now: FIXED_NOW }).errorKey).toBe(
      "automations.errors.cronFields",
    )
    expect(buildSchedulePreview("0 */5 * * * *", { now: FIXED_NOW }).errorKey).toBe(
      "automations.errors.cronFields",
    )
  })

  it("surfaces out-of-range field values as cronInvalid with the parser detail", () => {
    const preview = buildSchedulePreview("99 * * * *", { now: FIXED_NOW })
    expect(preview.kind).toBe("invalid")
    expect(preview.errorKey).toBe("automations.errors.cronInvalid")
    expect(preview.errorDetail).toContain("minute")
  })

  it("never-matching expressions parse clean but produce no runs", () => {
    // Feb 30 never exists — valid shape, empty calendar.
    const preview = buildSchedulePreview("0 0 30 2 *", { now: FIXED_NOW })
    expect(preview.errorKey).toBeNull()
    expect(preview.description).not.toBeNull()
    expect(preview.nextRuns).toEqual([])
  })

  it("renders each run in both the scheduler (UTC) and local timezone", () => {
    const rows = toScheduleRunRows([Date.parse("2026-11-14T10:00:00Z")], "en-US", "Asia/Shanghai")
    expect(rows).toHaveLength(1)
    expect(rows[0].schedulerText).toContain("10:00:00")
    expect(rows[0].localText).toContain("18:00:00")
    expect(rows[0].schedulerText).not.toBe(rows[0].localText)
  })
})

// ── CronScheduleField render ─────────────────────────────────────────────────

describe("CronScheduleField render", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows the memoized preview with dual timezone columns for a cron", () => {
    render(
      <CronScheduleField
        value="*/5 * * * *"
        onChange={vi.fn()}
        previewOptions={{ now: FIXED_NOW }}
      />,
    )
    expect(screen.getByTestId("automations-preview-desc").textContent).toBe("Every 5 minutes")
    expect(screen.getByTestId("automations-preview-runs")).toBeTruthy()
    expect(screen.getAllByTestId(/^automations-preview-run-/)).toHaveLength(10)
    const headers = screen.getByTestId("automations-preview-runs").querySelectorAll("th")
    expect(headers[0]?.textContent).toBe(t("automations.preview.tzUtc"))
    expect(headers[1]?.textContent).toBe(t("automations.preview.tzLocal"))
    // First row: the deterministic UTC column shows the 5-minute boundary;
    // the local column is rendered next to it (its actual stamp depends on
    // the runner timezone — covered exactly in the model test above).
    const firstRow = screen.getByTestId("automations-preview-run-0")
    const cells = firstRow.querySelectorAll("td")
    expect(cells).toHaveLength(2)
    expect(cells[0]?.textContent).toContain("09:50:00")
  })

  it("shows the hard error line for an invalid expression", () => {
    render(
      <CronScheduleField
        value="99 * * * *"
        onChange={vi.fn()}
        previewOptions={{ now: FIXED_NOW }}
      />,
    )
    const error = screen.getByTestId("automations-preview-error")
    expect(error.textContent).toContain(t("automations.errors.cronInvalid"))
    expect(error.textContent).toContain("minute")
    expect(screen.queryByTestId("automations-preview-runs")).toBeNull()
  })

  it("fills the schedule from a template option (colored fields + subtitle)", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<CronScheduleField value="" onChange={onChange} previewOptions={{ now: FIXED_NOW }} />)

    await user.click(screen.getByTestId("automations-template-trigger"))
    const listbox = screen.getByRole("listbox")
    // Each option carries the cronstrue subtitle for its expression.
    expect(listbox.textContent).toContain("Every 5 minutes")
    const option = screen.getAllByRole("option").find((el) => el.textContent?.includes("*/5"))
    expect(option).toBeTruthy()
    await user.click(option!)
    expect(onChange).toHaveBeenCalledWith("*/5 * * * *")
  })

  it("highlights the field the caret sits in (cursor-linked help)", () => {
    render(
      <CronScheduleField
        value="*/5 * * * *"
        onChange={vi.fn()}
        previewOptions={{ now: FIXED_NOW }}
      />,
    )
    const help = screen.getByTestId("automations-cron-help")
    expect(help).toBeTruthy()

    const input = screen.getByTestId("automations-schedule-input") as HTMLInputElement
    // Move the caret into the hour field (index 1) via a key event.
    Object.defineProperty(input, "selectionStart", { value: 5, configurable: true })
    fireEvent.keyUp(input)
    expect(screen.getByTestId("automations-cron-help-1").getAttribute("data-active")).toBe("true")
    expect(screen.getByTestId("automations-cron-help-0").getAttribute("data-active")).toBe("false")
  })
})

// ── Create dialog: soft-issue confirm flow ───────────────────────────────────

vi.mock("@/hooks/useJobsQueries", () => ({
  useJobs: vi.fn(),
  useCreateJob: vi.fn(),
  useDeleteJob: vi.fn(),
  useTriggerJob: vi.fn(),
  useJobSlots: vi.fn(),
}))

import * as hooks from "@/hooks/useJobsQueries"

const mocked = vi.mocked(hooks)

/** Loose query-result stub: components only read these fields. */
function q(props: Record<string, unknown>) {
  return { isFetching: false, ...props }
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe("AutomationsDomain create dialog: soft-issue confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useNotificationStore.getState().clear()
    mocked.useCreateJob.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    mocked.useDeleteJob.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    mocked.useTriggerJob.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    mocked.useJobSlots.mockReturnValue(
      q({ data: { jobId: "job_a1", hasPendingSlot: false } }) as never,
    )
    mocked.useJobs.mockReturnValue(q({ isLoading: false, data: { jobs: [] } }) as never)
  })

  const openDialog = () => {
    fireEvent.click(screen.getByTestId("automations-new"))
    return screen.getByTestId("automations-create-dialog")
  }

  it("hard validation still blocks submission without a soft-issue detour", () => {
    renderWithQuery(<AutomationsDomain />)
    openDialog()
    fireEvent.change(screen.getByTestId("automations-draft-name"), {
      target: { value: "pulse" },
    })
    fireEvent.change(screen.getByTestId("automations-schedule-input"), {
      target: { value: "500" },
    })
    fireEvent.click(screen.getByTestId("automations-create-submit"))
    expect(screen.getByTestId("automations-draft-error").textContent).toBe(
      t("automations.errors.intervalTooShort"),
    )
    expect(screen.queryByTestId("automations-soft-issues-dialog")).toBeNull()
  })

  it("collects soft issues into a confirm dialog; save anyway proceeds", () => {
    const create = vi.fn().mockImplementation((_input, opts) => opts?.onSuccess?.())
    mocked.useCreateJob.mockReturnValue({ mutate: create, isPending: false } as never)
    renderWithQuery(<AutomationsDomain />)
    openDialog()

    fireEvent.change(screen.getByTestId("automations-draft-name"), {
      target: { value: "pulse" },
    })
    fireEvent.change(screen.getByTestId("automations-schedule-input"), {
      target: { value: "30000" },
    })
    fireEvent.click(screen.getByTestId("automations-create-submit"))

    // Soft dialog lists the chatty-interval concern; nothing created yet.
    expect(screen.getByTestId("automations-soft-issues-dialog")).toBeTruthy()
    expect(screen.getByTestId("automations-soft-issues").textContent).toContain(
      "more than once a minute",
    )
    expect(create).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId("automations-soft-save-anyway"))
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      name: "automation:pulse",
      schedule: "30000",
      payload: { enabled: true },
    })
  })

  it("cancelling the soft-issue confirm keeps the draft for editing", () => {
    const create = vi.fn()
    mocked.useCreateJob.mockReturnValue({ mutate: create, isPending: false } as never)
    renderWithQuery(<AutomationsDomain />)
    openDialog()

    fireEvent.change(screen.getByTestId("automations-draft-name"), {
      target: { value: "pulse" },
    })
    fireEvent.change(screen.getByTestId("automations-schedule-input"), {
      target: { value: "30000" },
    })
    fireEvent.click(screen.getByTestId("automations-create-submit"))
    expect(screen.getByTestId("automations-soft-issues-dialog")).toBeTruthy()

    fireEvent.click(screen.getByTestId("automations-soft-cancel"))
    expect(create).not.toHaveBeenCalled()
    expect((screen.getByTestId("automations-schedule-input") as HTMLInputElement).value).toBe(
      "30000",
    )
  })
})
