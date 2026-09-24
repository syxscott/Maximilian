// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the three new settings domains: automations (jobs API +
 * local toggles + dialogs), memory (read-only role memory viewer) and
 * skills (static capability catalog). Model-layer units plus render
 * smoke with the data hooks mocked (settings-deep.test.tsx pattern).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale, t } from "@max/i18n"

import automationsEn from "../src/locales/automations.en-US.json"
import memoryEn from "../src/locales/memory.en-US.json"
import skillsEn from "../src/locales/skills.en-US.json"
import {
  EMPTY_AUTOMATION_DRAFT,
  automationSummary,
  filterAutomations,
  toAutomationViews,
  triggerLabelKey,
  validateAutomationDraft,
} from "../src/components/settings/automations-domain/model"
import {
  MEMORY_BUCKETS,
  bucketCount,
  bucketPreviews,
  entryPreview,
  pickRole,
  toMemoryRoleViews,
} from "../src/components/settings/memory-domain/model"
import { SKILL_CATALOG } from "../src/components/settings/skills-domain/skills-catalog"
import {
  filterCatalog,
  groupCatalogByKind,
  kindCounts,
} from "../src/components/settings/skills-domain/model"
import { AutomationsDomain } from "../src/components/settings/automations-domain/AutomationsDomain"
import { MemoryDomain } from "../src/components/settings/memory-domain/MemoryDomain"
import { SkillsDomain } from "../src/components/settings/skills-domain/SkillsDomain"

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
    ...flatten(memoryEn as Record<string, unknown>),
    ...flatten(skillsEn as Record<string, unknown>),
  })
  setLocale("en-US")
})

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function q(props: Record<string, unknown>) {
  return { isFetching: false, ...props }
}

const jobRow = {
  id: "job_1",
  name: "nightly",
  schedule: "0 2 * * *",
  scheduleKind: "cron",
  createdAt: "2026-09-24T10:00:00.000Z",
  triggerCount: 5,
}

// ── Automations: model ───────────────────────────────────────────────────────

describe("automations-domain model", () => {
  it("wraps job rows with local enabled state (default on)", () => {
    const views = toAutomationViews({ jobs: [jobRow, { id: "job_2", name: "b", schedule: "*" }] })
    expect(views.map((v) => v.enabled)).toEqual([true, true])
    const toggled = toAutomationViews({ jobs: [jobRow] }, { job_1: false })
    expect(toggled[0]?.enabled).toBe(false)
  })

  it("defends against garbage and filters by name", () => {
    expect(toAutomationViews(null)).toEqual([])
    expect(toAutomationViews({ jobs: 9 })).toEqual([])
    const views = toAutomationViews({ jobs: [jobRow] })
    expect(filterAutomations(views, "NIGHT")).toHaveLength(1)
    expect(filterAutomations(views, "zzz")).toHaveLength(0)
  })

  it("summarizes enabled/disabled counts", () => {
    const views = toAutomationViews(
      {
        jobs: [
          jobRow,
          { id: "2", name: "x", schedule: "*" },
          { id: "3", name: "y", schedule: "*" },
        ],
      },
      { "2": false },
    )
    expect(automationSummary(views)).toEqual({ total: 3, enabled: 2, disabled: 1 })
    expect(automationSummary([])).toEqual({ total: 0, enabled: 0, disabled: 0 })
  })

  it("validates drafts and picks the trigger label", () => {
    expect(validateAutomationDraft(EMPTY_AUTOMATION_DRAFT)).toBe("automations.errors.nameRequired")
    expect(validateAutomationDraft({ name: "x", schedule: "", description: "" })).toBe(
      "automations.errors.scheduleRequired",
    )
    expect(validateAutomationDraft({ name: "x", schedule: "*", description: "" })).toBeNull()
    const views = toAutomationViews({
      jobs: [
        jobRow,
        { id: "2", name: "x", schedule: "60000", scheduleKind: "interval" },
        { id: "3", name: "y", schedule: "?", scheduleKind: "wat" },
      ],
    })
    expect(triggerLabelKey(views[0]!)).toBe("automations.trigger.cron")
    expect(triggerLabelKey(views[1]!)).toBe("automations.trigger.interval")
    expect(triggerLabelKey(views[2]!)).toBe("automations.trigger.unknown")
  })
})

// ── Memory: model ────────────────────────────────────────────────────────────

describe("memory-domain model", () => {
  const profilesPayload = {
    profiles: [
      {
        role: "planner",
        currentVersion: "v2",
        memory: {
          userFeedback: [{ content: "prefer tables" }, "shorter plans"],
          reviewSuggestions: [],
          commonErrors: [{ content: "forgot cleanup" }],
          goodExamples: [{ content: "nice diff" }],
        },
      },
      {
        role: "executor",
        memory: {
          userFeedback: [{ content: "be terse" }],
          archived: { userFeedback: [{ content: "retired" }] },
        },
      },
      null,
      { noRole: true },
    ],
  }

  it("extracts the four buckets with counts and entries", () => {
    const views = toMemoryRoleViews(profilesPayload)
    expect(views.map((v) => v.role)).toEqual(["planner", "executor"])
    const planner = views[0]
    expect(planner?.version).toBe("v2")
    expect(planner?.totalEntries).toBe(4)
    expect(planner?.buckets.map((b) => b.name)).toEqual([...MEMORY_BUCKETS])
    expect(bucketCount(planner ?? null, "userFeedback")).toBe(2)
    expect(bucketCount(planner ?? null, "goodExamples")).toBe(1)
    expect(bucketCount(planner ?? null, "reviewSuggestions")).toBe(0)
  })

  it("ignores non-bucket keys like the archived quarantine", () => {
    const views = toMemoryRoleViews(profilesPayload)
    const executor = views[1]
    expect(executor?.buckets.find((b) => b.name === "userFeedback")?.entries).toEqual(["be terse"])
    expect(executor?.buckets.every((b) => !b.entries.includes("retired"))).toBe(true)
  })

  it("defends against garbage payloads", () => {
    expect(toMemoryRoleViews(null)).toEqual([])
    expect(toMemoryRoleViews({ profiles: "x" })).toEqual([])
    expect(toMemoryRoleViews({ profiles: [7, "x", {}] })).toEqual([])
  })

  it("picks the requested role, else the richest role, else null", () => {
    const views = toMemoryRoleViews(profilesPayload)
    expect(pickRole(views, "executor")?.role).toBe("executor")
    expect(pickRole(views, "ghost")?.role).toBe("planner") // most entries
    expect(pickRole(views, null)?.role).toBe("planner")
    expect(pickRole([], "x")).toBeNull()
  })

  it("previews entries with truncation", () => {
    expect(entryPreview("short")).toBe("short")
    expect(entryPreview("x".repeat(200))).toMatch(/…$/)
    expect(
      bucketPreviews({ name: "userFeedback", count: 4, entries: ["a", "b", "c", "d"] }),
    ).toEqual(["a", "b", "c"])
    expect(bucketCount(null, "userFeedback")).toBe(0)
  })
})

// ── Skills: model + honest static catalog ────────────────────────────────────

describe("skills-domain model", () => {
  it("ships a static catalog of the eight built-in tool artifacts", () => {
    expect(SKILL_CATALOG).toHaveLength(8)
    const names = SKILL_CATALOG.map((e) => e.name)
    expect(names).toEqual(["bash", "bash-stream", "read", "write", "edit", "glob", "grep", "lsp"])
    // Every entry carries provenance and an i18n key that resolves.
    for (const entry of SKILL_CATALOG) {
      expect(entry.source).toMatch(/\.ts$/)
      expect(t(entry.purposeKey)).not.toEqual(entry.purposeKey) // key resolved
    }
  })

  it("groups by kind in display order, alphabetical inside", () => {
    const groups = groupCatalogByKind()
    expect(groups.map((g) => g.kind)).toEqual(["read", "edit", "search", "execute"])
    expect(groups[0]?.entries.map((e) => e.name)).toEqual(["lsp", "read"])
    expect(groups[2]?.entries.map((e) => e.name)).toEqual(["glob", "grep"])
  })

  it("filters and counts", () => {
    expect(kindCounts()).toEqual({ read: 2, edit: 2, search: 2, execute: 2 })
    expect(filterCatalog(SKILL_CATALOG, "GRE").map((e) => e.name)).toEqual(["grep"])
    expect(filterCatalog(SKILL_CATALOG, "zzz")).toEqual([])
    expect(filterCatalog(SKILL_CATALOG, "  ")).toHaveLength(8)
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
vi.mock("@/hooks/useSettingsQueries", () => ({
  useSubagentProfiles: vi.fn(),
}))

import * as jobsHooks from "@/hooks/useJobsQueries"
import * as settingsHooks from "@/hooks/useSettingsQueries"

const mockedJobs = vi.mocked(jobsHooks)
const mockedSettings = vi.mocked(settingsHooks)

beforeEach(() => {
  vi.resetAllMocks()
  mockedJobs.useCreateJob.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  mockedJobs.useDeleteJob.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
})

describe("settings domains render smoke", () => {
  it("AutomationsDomain lists rows, flips local toggles, creates and deletes with confirmation", async () => {
    const create = vi.fn().mockImplementation((_input, opts) => opts?.onSuccess?.({}))
    const remove = vi.fn()
    mockedJobs.useCreateJob.mockReturnValue({ mutate: create, isPending: false } as never)
    mockedJobs.useDeleteJob.mockReturnValue({ mutate: remove, isPending: false } as never)
    mockedJobs.useJobs.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: { jobs: [jobRow, { ...jobRow, id: "job_2", name: "hourly" }] },
      }) as never,
    )
    renderWithQuery(<AutomationsDomain />)
    expect(screen.getByTestId("automations-list")).toBeTruthy()
    expect(screen.getByTestId("automations-summary").textContent).toContain("2 total")

    // Local toggle: off (dimmed row), does not touch the API.
    const toggle = screen.getByTestId("automations-toggle-job_1")
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(toggle)
    expect(screen.getByTestId("automations-toggle-job_1").getAttribute("aria-checked")).toBe(
      "false",
    )

    // Delete goes through the confirmation dialog.
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId("automations-delete-job_1"))
    expect(screen.getByTestId("automations-delete-dialog")).toBeTruthy()
    fireEvent.click(screen.getByTestId("automations-delete-confirm"))
    await waitFor(() => expect(remove).toHaveBeenCalledWith("job_1", expect.anything()))

    // Create dialog validation + submit.
    fireEvent.click(screen.getByTestId("automations-new"))
    fireEvent.click(screen.getByTestId("automations-create-submit"))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByTestId("automations-draft-error").textContent).toBe("Name is required")
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "pulse" } })
    fireEvent.change(screen.getByLabelText("Schedule"), { target: { value: "30000" } })
    fireEvent.click(screen.getByTestId("automations-create-submit"))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        { name: "pulse", schedule: "30000" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      ),
    )
  })

  it("AutomationsDomain shows loading, error and empty states", () => {
    mockedJobs.useJobs.mockReturnValue(q({ isLoading: true }) as never)
    const view = renderWithQuery(<AutomationsDomain />)
    expect(screen.getByText("Loading…")).toBeTruthy()

    mockedJobs.useJobs.mockReturnValue(
      q({ isLoading: false, isError: true, refetch: vi.fn() }) as never,
    )
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AutomationsDomain />
      </QueryClientProvider>,
    )
    expect(screen.getByText("Failed to load")).toBeTruthy()

    mockedJobs.useJobs.mockReturnValue(
      q({ isLoading: false, isError: false, refetch: vi.fn(), data: { jobs: [] } }) as never,
    )
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AutomationsDomain />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId("automations-empty")).toBeTruthy()
  })

  it("MemoryDomain renders the role selector and bucket previews", () => {
    mockedSettings.useSubagentProfiles.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          profiles: [
            {
              role: "planner",
              currentVersion: "v2",
              memory: {
                userFeedback: [{ content: "prefer tables" }],
                commonErrors: [],
                reviewSuggestions: [],
                goodExamples: [],
              },
            },
            {
              role: "executor",
              memory: { userFeedback: [{ content: "be terse" }] },
            },
          ],
        },
      }) as never,
    )
    renderWithQuery(<MemoryDomain />)
    expect(screen.getByTestId("memory-role-selector")).toBeTruthy()
    // Richest role (planner, 1 entry vs executor 1 → first wins on ties).
    expect(screen.getByTestId("memory-role-planner")).toBeTruthy()
    expect(screen.getByText("prefer tables")).toBeTruthy()
    // Switch to executor.
    fireEvent.click(screen.getByText("executor"))
    expect(screen.getByTestId("memory-role-executor")).toBeTruthy()
    expect(screen.getByText("be terse")).toBeTruthy()
    // Empty bucket shows its hint.
    const bucket = screen.getByTestId("memory-bucket-reviewSuggestions")
    expect(bucket.textContent).toContain("No entries in this bucket")
  })

  it("MemoryDomain shows the empty and error states", () => {
    mockedSettings.useSubagentProfiles.mockReturnValue(
      q({ isLoading: false, isError: false, refetch: vi.fn(), data: { profiles: [] } }) as never,
    )
    const { rerender } = renderWithQuery(<MemoryDomain />)
    expect(screen.getByTestId("memory-empty")).toBeTruthy()

    mockedSettings.useSubagentProfiles.mockReturnValue(
      q({ isLoading: false, isError: true, refetch: vi.fn() }) as never,
    )
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryDomain />
      </QueryClientProvider>,
    )
    expect(screen.getByText("Failed to load")).toBeTruthy()
  })

  it("SkillsDomain renders the static catalog with source note and search", () => {
    renderWithQuery(<SkillsDomain />)
    expect(screen.getByTestId("skills-source-note").textContent).toContain("dynamic tool registry")
    expect(screen.getByTestId("skills-tool-bash")).toBeTruthy()
    expect(screen.getByTestId("skills-tool-lsp")).toBeTruthy()
    // Search narrows to a single tool.
    fireEvent.change(screen.getByLabelText("Search capabilities…"), {
      target: { value: "grep" },
    })
    expect(screen.getByTestId("skills-tool-grep")).toBeTruthy()
    expect(screen.queryByTestId("skills-tool-bash")).toBeNull()
    // No match at all → explicit empty state.
    fireEvent.change(screen.getByLabelText("Search capabilities…"), {
      target: { value: "zzz" },
    })
    expect(screen.getByTestId("skills-empty")).toBeTruthy()
  })
})
