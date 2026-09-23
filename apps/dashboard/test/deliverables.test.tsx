// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the deliverables feature domain: model-layer unit tests
 * (empty-output filtering, role grouping, stats, the 12-line collapsed
 * preview, Markdown export incl. fence escaping) plus render smoke for
 * DeliverablesPanel in both data modes (workspace prop / fetch by id with
 * chatApi mocked) and both export paths (clipboard + degraded manual
 * copy).
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import deliverablesEn from "../src/locales/deliverables.en-US.json"
import {
  DELIVERABLE_PREVIEW_LINES,
  canUseClipboard,
  deliverableStats,
  groupByRole,
  previewLines,
  reviewSummary,
  toDeliverableViews,
  toDeliverablesMarkdown,
} from "../src/features/deliverables/model"
import { DeliverablesPanel } from "../src/features/deliverables/DeliverablesPanel"

beforeAll(() => {
  const existing = getDictionary("en-US") ?? {}
  registerLocale("en-US", { ...existing, ...(deliverablesEn as Record<string, string>) })
  setLocale("en-US")
})

vi.mock("@/api", () => ({
  chatApi: {
    getWorkspace: vi.fn(),
  },
}))

import { chatApi } from "@/api"

const mockedGetWorkspace = vi.mocked(chatApi.getWorkspace)

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const WORKSPACE = {
  id: "ws-1",
  userRequest: "Refactor the parser\nand add tests",
  status: "completed",
  results: [
    {
      taskId: "task-1",
      agentRole: "planner",
      output: "Plan: parse, then test.",
      metadata: { durationMs: 1200 },
    },
    {
      taskId: "task-2",
      agentRole: "executor",
      output: Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n"),
      metadata: {},
    },
    { taskId: "task-3", agentRole: "executor", output: "   \n  ", metadata: null },
    { taskId: "task-4", agentRole: "reviewer", output: "" },
    null,
    { noOutput: true },
  ],
  review: {
    id: "rev-1",
    score: 8.5,
    issues: ["minor naming"],
    suggestions: [],
    summary: "Solid work overall.",
    reviewedAt: "2026-09-24T00:00:00Z",
  },
}

// ── Model layer ─────────────────────────────────────────────────────────────

describe("deliverables model", () => {
  const views = toDeliverableViews(WORKSPACE)

  it("extracts deliverable rows and drops blank outputs", () => {
    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({ taskId: "task-1", agentRole: "planner" })
    expect(views[1].taskId).toBe("task-2")
    expect(views[1].metadata).toEqual({})
  })

  it("defaults a missing role to unknown and tolerates missing metadata", () => {
    const loose = toDeliverableViews({ results: [{ taskId: "t", output: "out" }] })
    expect(loose).toEqual([{ taskId: "t", agentRole: "unknown", output: "out", metadata: null }])
  })

  it("defends against garbage payloads", () => {
    expect(toDeliverableViews(null)).toEqual([])
    expect(toDeliverableViews(undefined)).toEqual([])
    expect(toDeliverableViews("ws")).toEqual([])
    expect(toDeliverableViews({ results: "nope" })).toEqual([])
    expect(toDeliverableViews({ results: [42, {}, { output: 7 }] })).toEqual([])
  })

  it("groups by role in first-seen order", () => {
    const groups = groupByRole(views)
    expect(groups.map((g) => g.role)).toEqual(["planner", "executor"])
    expect(groups[1].items.map((i) => i.taskId)).toEqual(["task-2"])
    expect(groupByRole([])).toEqual([])
  })

  it("computes header stats", () => {
    expect(deliverableStats(views)).toEqual({
      total: 2,
      tasks: 2,
      roles: 2,
      chars: views[0].output.length + views[1].output.length,
    })
    expect(deliverableStats([])).toEqual({ total: 0, tasks: 0, roles: 0, chars: 0 })
  })

  it("previews the first 12 lines and reports the hidden remainder", () => {
    expect(DELIVERABLE_PREVIEW_LINES).toBe(12)
    const long = previewLines(views[1].output)
    expect(long.text.split("\n")).toHaveLength(12)
    expect(long.text).toBe(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n"))
    expect(long.hidden).toBe(3)
    expect(previewLines("short")).toEqual({ text: "short", hidden: 0 })
    expect(previewLines("a\nb\nc", 2)).toEqual({ text: "a\nb", hidden: 1 })
  })

  it("summarizes the review defensively", () => {
    expect(reviewSummary(WORKSPACE)).toEqual({
      score: 8.5,
      issues: 1,
      suggestions: 0,
      summary: "Solid work overall.",
    })
    expect(reviewSummary({ review: { score: "high", issues: "many" } })).toEqual({
      score: null,
      issues: 0,
      suggestions: 0,
      summary: "",
    })
    expect(reviewSummary({})).toBeNull()
    expect(reviewSummary(null)).toBeNull()
  })

  it("exports the full document: header, roles, fenced outputs, review", () => {
    const md = toDeliverablesMarkdown(WORKSPACE)
    expect(md).toContain("# Deliverables")
    expect(md).toContain("> Refactor the parser")
    expect(md).toContain("and add tests")
    expect(md).toContain("## planner")
    expect(md).toContain("## executor")
    expect(md).toContain("### task-1")
    expect(md).toContain("Plan: parse, then test.")
    expect(md).toContain("line 15")
    expect(md).toContain("## Review")
    expect(md).toContain("Score: 8.5")
    expect(md).toContain("Issues: 1 · Suggestions: 0")
    expect(md).toContain("Solid work overall.")
    // Blank-output tasks must not leak into the document.
    expect(md).not.toContain("task-3")
    expect(md).not.toContain("task-4")
  })

  it("escapes a code fence inside the output", () => {
    const md = toDeliverablesMarkdown({
      results: [{ taskId: "t", agentRole: "executor", output: "```\nhi\n```" }],
    })
    // The output's triple backticks force a longer outer fence.
    expect(md).toContain("````\n```\nhi\n```\n````")
  })

  it("degrades to a minimal document on garbage input", () => {
    expect(toDeliverablesMarkdown(null)).toBe("# Deliverables\n")
    expect(toDeliverablesMarkdown({})).toBe("# Deliverables\n")
  })

  it("guards the clipboard capability", () => {
    expect(canUseClipboard(undefined)).toBe(false)
    expect(canUseClipboard({})).toBe(false)
    expect(canUseClipboard({ clipboard: null })).toBe(false)
    expect(canUseClipboard({ clipboard: {} })).toBe(false)
    expect(canUseClipboard({ clipboard: { writeText: "nope" } })).toBe(false)
    expect(canUseClipboard({ clipboard: { writeText: () => Promise.resolve() } })).toBe(true)
  })
})

// ── Render smoke ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks()
})

const realClipboard = navigator.clipboard

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: realClipboard,
    configurable: true,
  })
})

describe("deliverables render smoke", () => {
  it("lists rows grouped by role with collapse/expand previews (workspace prop)", () => {
    renderWithQuery(<DeliverablesPanel workspace={WORKSPACE} />)
    expect(screen.getByTestId("deliverables-panel")).toBeTruthy()
    expect(screen.getByTestId("deliverables-stats").textContent).toContain("2 deliverable(s)")
    expect(screen.getByText("planner")).toBeTruthy()
    expect(screen.getByText("executor")).toBeTruthy()
    // Collapsed: only the first 12 lines of the long output.
    expect(screen.getByTestId("deliverable-task-2").textContent).not.toContain("line 15")
    expect(screen.getByText("+3 lines")).toBeTruthy()
    // Review badges render.
    expect(screen.getByText("Review score 8.5")).toBeTruthy()
    expect(screen.getByText("1 issue(s)")).toBeTruthy()
    // Expanding reveals the full output.
    fireEvent.click(screen.getByTestId("deliverable-task-2").querySelector("button")!)
    expect(screen.getByTestId("deliverable-task-2").textContent).toContain("line 15")
  })

  it("shows the empty state when nothing has output", () => {
    renderWithQuery(<DeliverablesPanel workspace={{ results: [] }} />)
    expect(screen.getByTestId("deliverables-empty")).toBeTruthy()
    const exportButton = screen
      .getByText("Export all as Markdown")
      .closest("button") as HTMLButtonElement
    expect(exportButton.disabled).toBe(true)
  })

  it("exports via the clipboard and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    renderWithQuery(<DeliverablesPanel workspace={WORKSPACE} />)
    fireEvent.click(screen.getByText("Export all as Markdown"))
    await waitFor(() => {
      expect(screen.getByTestId("deliverables-copied")).toBeTruthy()
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    const markdown = writeText.mock.calls[0][0] as string
    expect(markdown).toContain("# Deliverables")
    expect(markdown).toContain("### task-1")
  })

  it("degrades to a manual-copy block when the clipboard is unavailable", () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })
    renderWithQuery(<DeliverablesPanel workspace={WORKSPACE} />)
    fireEvent.click(screen.getByText("Export all as Markdown"))
    expect(screen.getByTestId("deliverables-manual")).toBeTruthy()
    const textarea = screen
      .getByLabelText("Select all text, then copy")
      .closest("textarea") as HTMLTextAreaElement
    expect(textarea.value).toContain("# Deliverables")
    expect(textarea.readOnly).toBe(true)
  })

  it("fetches by workspaceId: loading, then rows; error keeps a retry", async () => {
    let resolveWorkspace: (value: unknown) => void = () => {}
    mockedGetWorkspace.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWorkspace = resolve
        }),
    )
    const first = renderWithQuery(<DeliverablesPanel workspaceId="ws-1" />)
    expect(screen.getByText("Loading…")).toBeTruthy()

    resolveWorkspace(WORKSPACE)
    await screen.findByTestId("deliverables-stats")
    first.unmount()

    mockedGetWorkspace.mockRejectedValue(new Error("boom"))
    renderWithQuery(<DeliverablesPanel workspaceId="ws-err" />)
    await waitFor(() => {
      expect(screen.getByTestId("deliverables-error")).toBeTruthy()
    })
    expect(screen.getByText("Retry")).toBeTruthy()
  })
})
