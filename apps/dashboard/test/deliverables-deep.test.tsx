// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Deepening tests for the deliverables feature domain: the role filter,
 * the JSON export, and the per-deliverable review-score association
 * (model layer plus DeliverablesPanel render smoke). The ai-elements
 * mounts round covers the stats strip (StatCard counts, DonutStat review
 * coverage, DeltaBadge filter delta) and the workspace-id CopyField chip.
 * Complements — and must not break — the existing deliverables.test.tsx
 * suite.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import deliverablesEn from "../src/locales/deliverables.en-US.json"
import aiEn from "../src/locales/ai-elements.en-US.json"
import {
  filterByRole,
  reviewCoverage,
  reviewPerTask,
  reviewSummary,
  toDeliverableViews,
  toDeliverablesJson,
  workspaceIdOf,
} from "../src/features/deliverables/model"
import type { TaskReviewLink } from "../src/features/deliverables/model"
import { DeliverablesPanel } from "../src/features/deliverables/DeliverablesPanel"

/** The ai-elements dictionaries are nested trees; flatten to dotted keys. */
function flattenAi(tree: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === "object") {
      Object.assign(out, flattenAi(value as Record<string, unknown>, dotted))
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
    ...(deliverablesEn as Record<string, string>),
    ...flattenAi(aiEn as Record<string, unknown>),
  })
  setLocale("en-US")
})

vi.mock("@/api", () => ({
  chatApi: {
    getWorkspace: vi.fn(),
  },
}))

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const VIEWS = toDeliverableViews({
  results: [
    { taskId: "t1", agentRole: "planner", output: "the plan" },
    { taskId: "t2", agentRole: "executor", output: "the code" },
    { taskId: "t3", agentRole: "executor", output: "the tests" },
  ],
})

// ── Model layer ─────────────────────────────────────────────────────────────

describe("deliverables deepening — model", () => {
  it("filterByRole keeps only one role and preserves order", () => {
    const filtered = filterByRole(VIEWS, "executor")
    expect(filtered.map((v) => v.taskId)).toEqual(["t2", "t3"])
    expect(filterByRole(VIEWS, "planner").map((v) => v.taskId)).toEqual(["t1"])
    expect(filterByRole(VIEWS, "ghost")).toEqual([])
  })

  it("filterByRole treats an empty role as no filter and never mutates input", () => {
    const snapshot = VIEWS.map((v) => v.taskId)
    expect(filterByRole(VIEWS, "")).toEqual(VIEWS)
    expect(filterByRole(VIEWS, "   ")).toEqual(VIEWS)
    expect(filterByRole(VIEWS, "")).not.toBe(VIEWS)
    expect(VIEWS.map((v) => v.taskId)).toEqual(snapshot)
  })

  it("toDeliverablesJson exports a deterministic, valid document", () => {
    const json = toDeliverablesJson(VIEWS)
    const parsed = JSON.parse(json) as {
      count: number
      deliverables: Array<{ taskId: string; agentRole: string; output: string; metadata: unknown }>
    }
    expect(parsed.count).toBe(3)
    expect(parsed.deliverables).toEqual([
      { taskId: "t1", agentRole: "planner", output: "the plan", metadata: {} },
      { taskId: "t2", agentRole: "executor", output: "the code", metadata: {} },
      { taskId: "t3", agentRole: "executor", output: "the tests", metadata: {} },
    ])
    expect(json.endsWith("\n")).toBe(true)
    expect(toDeliverablesJson(VIEWS)).toBe(json)
  })

  it("toDeliverablesJson round-trips metadata and honors the role filter", () => {
    const withMeta = toDeliverableViews({
      results: [
        {
          taskId: "t1",
          agentRole: "executor",
          output: "out",
          metadata: { durationMs: 5, nested: { ok: true } },
        },
      ],
    })
    const parsed = JSON.parse(toDeliverablesJson(filterByRole(withMeta, "nobody"))) as {
      count: number
    }
    expect(parsed).toEqual({ count: 0, deliverables: [] })
    const kept = JSON.parse(toDeliverablesJson(withMeta)) as {
      deliverables: Array<{ metadata: Record<string, unknown> }>
    }
    expect(kept.deliverables[0].metadata).toEqual({ durationMs: 5, nested: { ok: true } })
  })

  it("reviewPerTask prefers the result's metadata.review score", () => {
    const views = toDeliverableViews({
      results: [
        { taskId: "t1", agentRole: "r", output: "a", metadata: { review: { score: 9 } } },
        { taskId: "t2", agentRole: "r", output: "b", metadata: { review: 7.5 } },
        { taskId: "t3", agentRole: "r", output: "c", metadata: { review: { score: "high" } } },
      ],
    })
    // Workspace-level score is the fallback — only t3 needs it (still null
    // here because none is passed).
    const links = reviewPerTask(views, 8)
    expect(links).toEqual([
      { taskId: "t1", score: 9, source: "metadata" },
      { taskId: "t2", score: 7.5, source: "metadata" },
      { taskId: "t3", score: 8, source: "workspace" },
    ])
  })

  it("reviewPerTask falls back to the workspace score and admits defeat honestly", () => {
    const views = toDeliverableViews({
      results: [
        { taskId: "t1", agentRole: "r", output: "a" },
        { taskId: "t2", agentRole: "r", output: "b", metadata: { review: { score: 6 } } },
        { taskId: "t3", agentRole: "r", output: "c", metadata: null },
      ],
    })
    expect(reviewPerTask(views)).toEqual([
      { taskId: "t1", score: null, source: null },
      { taskId: "t2", score: 6, source: "metadata" },
      { taskId: "t3", score: null, source: null },
    ])
    expect(reviewPerTask(views, reviewSummary({ review: { score: 4.5 } })?.score ?? null)).toEqual([
      { taskId: "t1", score: 4.5, source: "workspace" },
      { taskId: "t2", score: 6, source: "metadata" },
      { taskId: "t3", score: 4.5, source: "workspace" },
    ])
    // A garbage workspace score must not fabricate numbers.
    expect(reviewPerTask(views, Number.NaN)).toEqual([
      { taskId: "t1", score: null, source: null },
      { taskId: "t2", score: 6, source: "metadata" },
      { taskId: "t3", score: null, source: null },
    ])
  })
})

describe("deliverables deepening — stats-strip mount models", () => {
  it("reviewCoverage is the scored share and 0 on an empty set", () => {
    expect(reviewCoverage([])).toBe(0)
    const links: TaskReviewLink[] = [
      { taskId: "a", score: 9, source: "metadata" },
      { taskId: "b", score: null, source: null },
      { taskId: "c", score: 8.5, source: "workspace" },
    ]
    expect(reviewCoverage(links)).toBeCloseTo(2 / 3)
    expect(reviewCoverage(reviewPerTask(VIEWS, 7))).toBe(1)
  })

  it("workspaceIdOf prefers the prop and falls back to workspace.id", () => {
    expect(workspaceIdOf("ws-prop", { id: "ws-body" })).toBe("ws-prop")
    expect(workspaceIdOf(undefined, { id: "ws-body" })).toBe("ws-body")
    expect(workspaceIdOf(undefined, { id: 42 })).toBeUndefined()
    expect(workspaceIdOf(undefined, null)).toBeUndefined()
    expect(workspaceIdOf("", undefined)).toBeUndefined()
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

const PANEL_WORKSPACE = {
  id: "ws-1",
  userRequest: "Refactor the parser",
  status: "completed",
  results: [
    {
      taskId: "t1",
      agentRole: "planner",
      output: "the plan",
      metadata: { review: { score: 9 } },
    },
    { taskId: "t2", agentRole: "executor", output: "the code", metadata: {} },
  ],
  review: { score: 8.5, issues: [], suggestions: [], summary: "ok" },
}

describe("deliverables deepening — render smoke", () => {
  it("filters rows by role via the dropdown and shows the per-row count", () => {
    renderWithQuery(<DeliverablesPanel workspace={PANEL_WORKSPACE} />)
    expect(screen.getByTestId("deliverables-stats").textContent).toContain("2 deliverable(s)")
    expect(screen.getByTestId("deliverable-t1")).toBeTruthy()
    expect(screen.getByTestId("deliverable-t2")).toBeTruthy()

    const select = screen.getByLabelText("Filter by role") as HTMLSelectElement
    expect((select.options[select.selectedIndex] as HTMLOptionElement).value).toBe("")
    fireEvent.change(select, { target: { value: "executor" } })

    expect(screen.queryByTestId("deliverable-t1")).toBeNull()
    expect(screen.getByTestId("deliverable-t2")).toBeTruthy()
    expect(screen.getByTestId("deliverables-stats").textContent).toContain("1 deliverable(s)")
  })

  it("shows per-deliverable review badges: metadata source first, workspace fallback second", () => {
    renderWithQuery(<DeliverablesPanel workspace={PANEL_WORKSPACE} />)
    // t1 has its own metadata.review score.
    expect(screen.getByTestId("deliverable-review-t1").textContent).toBe("task review 9")
    // t2 inherits the workspace-level review score.
    expect(screen.getByTestId("deliverable-review-t2").textContent).toBe("review 8.5")
  })

  it("exports JSON via the clipboard (filtered rows only)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    renderWithQuery(<DeliverablesPanel workspace={PANEL_WORKSPACE} />)
    fireEvent.change(screen.getByLabelText("Filter by role"), {
      target: { value: "executor" },
    })
    fireEvent.click(screen.getByTestId("deliverables-export-json"))
    await waitFor(() => {
      expect(screen.getByTestId("deliverables-json-copied")).toBeTruthy()
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(writeText.mock.calls[0][0] as string) as {
      count: number
      deliverables: Array<{ taskId: string }>
    }
    expect(parsed.count).toBe(1)
    expect(parsed.deliverables.map((d) => d.taskId)).toEqual(["t2"])
  })

  it("degrades the JSON export to a manual-copy block without a clipboard", () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })
    renderWithQuery(<DeliverablesPanel workspace={PANEL_WORKSPACE} />)
    fireEvent.click(screen.getByTestId("deliverables-export-json"))
    const block = screen.getByTestId("deliverables-json-manual")
    const textarea = block.querySelector("textarea") as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(true)
    const parsed = JSON.parse(textarea.value) as { count: number }
    expect(parsed.count).toBe(2)
  })

  it("mounts the ai-elements stats strip: StatCards, coverage donut, filter delta", () => {
    const user = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, "clipboard", { value: user, configurable: true })
    renderWithQuery(<DeliverablesPanel workspace={PANEL_WORKSPACE} />)
    const strip = screen.getByTestId("deliverables-stat-cards")
    expect(strip).toHaveTextContent("Deliverables")
    expect(strip).toHaveTextContent("Tasks")
    expect(strip).toHaveTextContent("Roles")
    // Both rows carry an associated score (metadata first, workspace
    // fallback second) → the DonutStat ring reads full.
    expect(screen.getByLabelText("Review coverage")).toHaveTextContent("100%")
    // No role filter → no delta badge.
    expect(screen.queryByText("-1")).toBeNull()

    fireEvent.change(screen.getByLabelText("Filter by role"), {
      target: { value: "planner" },
    })
    // The filter hides one row → DeltaBadge reads the -1 delta.
    expect(screen.getByText("-1")).toBeInTheDocument()
    expect(screen.getByTitle("1 row(s) hidden by the role filter")).toBeInTheDocument()
  })

  it("copies the workspace id through the CopyField chip beside the exports", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    renderWithQuery(<DeliverablesPanel workspace={PANEL_WORKSPACE} />)
    const chip = screen.getByLabelText("Copyable field")
    expect(chip).toHaveTextContent("ws-1")
    fireEvent.click(within(chip).getByRole("button", { name: "Copy" }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("ws-1")
    })
  })

  it("hides the CopyField chip when no workspace id is known", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    renderWithQuery(<DeliverablesPanel workspace={{ results: PANEL_WORKSPACE.results }} />)
    expect(screen.queryByLabelText("Copyable field")).toBeNull()
  })
})
