// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the deepened memory viewer: entry-level bucket expansion,
 * cross-bucket search, the per-bucket efficacy ledger and the gating
 * inference badge (thresholds mirrored from @max/evolution
 * gatingDecisions: eps 0.25, minSamples 3). Model-layer units plus render
 * smoke with the data hook mocked (settings-deep.test.tsx pattern).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import memoryEn from "../src/locales/memory.en-US.json"
import {
  GATING_EPS,
  GATING_MIN_SAMPLES,
  toEfficacyLedgerView,
  toMemoryRoleView,
  toMemoryRoleViews,
  searchRoleEntries,
} from "../src/components/settings/memory-domain/model"
import { MemoryDomain } from "../src/components/settings/memory-domain/MemoryDomain"

beforeAll(() => {
  const existing = getDictionary("en-US") ?? {}
  registerLocale("en-US", { ...existing, ...flatten(memoryEn as Record<string, unknown>) })
  setLocale("en-US")
})

/** Domain JSON is nested; t() looks up flat dotted keys — flatten first. */
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

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function q(props: Record<string, unknown>) {
  return { isFetching: false, ...props }
}

// ── Model: entries, efficacy ledger, gating inference ───────────────────────

describe("memory viewer model", () => {
  const profile = {
    role: "planner",
    currentVersion: "v3",
    memory: {
      userFeedback: [
        { content: "prefer tables", mime: "text/plain", metadata: { at: "2026-09-20T10:00:00Z" } },
        { content: "json payload", mime: "application/json", metadata: {} },
        "legacy string entry",
        { noContent: true },
      ],
      reviewSuggestions: [],
      commonErrors: [{ content: "forgot cleanup" }],
      goodExamples: [{ content: "nice diff", metadata: { timestamp: "2026-09-21T08:30:00Z" } }],
      efficacy: {
        userFeedback: { injectedCount: 6, deltaSum: -2.4 },
        commonErrors: { injectedCount: 2, deltaSum: -1.0 },
        goodExamples: { injectedCount: 4, deltaSum: 1.2 },
        reviewSuggestions: { injectedCount: 0, deltaSum: 0 },
      },
    },
  }

  it("extracts mime and best-effort recent time per entry, defensively", () => {
    const view = toMemoryRoleView(profile)
    const bucket = view?.buckets.find((b) => b.name === "userFeedback")
    expect(bucket?.count).toBe(3) // the noContent object is dropped
    expect(bucket?.entries[0]).toEqual({
      content: "prefer tables",
      mime: "text/plain",
      at: "2026-09-20T10:00:00Z",
    })
    expect(bucket?.entries[1]?.mime).toBe("application/json")
    expect(bucket?.entries[1]?.at).toBeNull() // empty metadata → honest null
    expect(bucket?.entries[2]).toEqual({
      content: "legacy string entry",
      mime: "text/plain",
      at: null,
    })
  })

  it("computes the efficacy ledger mean per bucket", () => {
    const view = toMemoryRoleView(profile)
    const uf = view?.efficacy.userFeedback
    expect(uf?.injectedCount).toBe(6)
    expect(uf?.deltaSum).toBe(-2.4)
    expect(uf?.mean).toBeCloseTo(-0.4, 10)
    expect(uf?.wouldSkipUnderEnforce).toBe(true)
    expect(view?.efficacy.goodExamples?.wouldSkipUnderEnforce).toBe(false)
    // Empty bucket: never ledgered (the gate skips empty buckets).
    expect(view?.efficacy.reviewSuggestions).toBeUndefined()
  })

  it("mirrors the gating thresholds (mean < -eps, samples >= min)", () => {
    expect(GATING_EPS).toBe(0.25)
    expect(GATING_MIN_SAMPLES).toBe(3)
    // -0.25 itself is not below -eps.
    expect(toEfficacyLedgerView({ injectedCount: 5, deltaSum: -1.25 })?.wouldSkipUnderEnforce).toBe(
      false,
    )
    // Below -eps but not enough samples.
    expect(toEfficacyLedgerView({ injectedCount: 2, deltaSum: -3 })?.wouldSkipUnderEnforce).toBe(
      false,
    )
    // Exactly at the sample floor with a clearly negative mean.
    expect(toEfficacyLedgerView({ injectedCount: 3, deltaSum: -0.9 })?.wouldSkipUnderEnforce).toBe(
      true,
    )
    // Zero injectedCount → no evidence, no ledger row at all.
    expect(toEfficacyLedgerView({ injectedCount: 0, deltaSum: -5 })).toBeNull()
    expect(toEfficacyLedgerView("garbage")).toBeNull()
    expect(toEfficacyLedgerView(null)).toBeNull()
  })

  it("searches entries across buckets case-insensitively and counts matches", () => {
    const view = toMemoryRoleView(profile)
    const role = view !== null ? view : null
    if (role === null) throw new Error("profile must parse")
    // Empty query → the full ledger table (all four buckets, no filtering).
    expect(searchRoleEntries(role, "  ").buckets).toHaveLength(4)
    expect(searchRoleEntries(role, "").matches).toBe(role.totalEntries)
    // Substring, case-insensitive, across buckets.
    const hits = searchRoleEntries(role, "CLEAN")
    expect(hits.buckets.map((b) => b.name)).toEqual(["commonErrors"])
    expect(hits.matches).toBe(1)
    // Multi-bucket hits ("json payload" has no 'e' → 4 of 5).
    const wide = searchRoleEntries(role, "e")
    expect(wide.matches).toBe(4)
    expect(wide.buckets).toHaveLength(3)
    // No hits anywhere.
    expect(searchRoleEntries(role, "zzz")).toEqual({ buckets: [], matches: 0 })
  })

  it("keeps defending against garbage payloads", () => {
    expect(toMemoryRoleViews({ profiles: [{ role: "x", memory: { efficacy: 7 } }] }).length).toBe(1)
    const views = toMemoryRoleViews({
      profiles: [{ role: "x", memory: { efficacy: { userFeedback: "no" } } }],
    })
    expect(views[0]?.efficacy.userFeedback).toBeUndefined()
  })
})

// ── Render smoke: expansion, search, ledger, gating badge ───────────────────

vi.mock("@/hooks/useSettingsQueries", () => ({
  useSubagentProfiles: vi.fn(),
  useMigrationCandidates: vi.fn(),
}))

import * as settingsHooks from "@/hooks/useSettingsQueries"

const mockedSettings = vi.mocked(settingsHooks)

beforeEach(() => {
  vi.resetAllMocks()
})

const payload = {
  profiles: [
    {
      role: "planner",
      currentVersion: "v3",
      memory: {
        userFeedback: [
          {
            content: "x".repeat(200) + " FULLTAIL",
            mime: "application/json",
            metadata: { at: "2026-09-20T10:00:00Z" },
          },
          { content: "short entry" },
        ],
        reviewSuggestions: [],
        commonErrors: [{ content: "forgot cleanup" }],
        goodExamples: [{ content: "nice diff" }],
        efficacy: {
          userFeedback: { injectedCount: 6, deltaSum: -2.4 },
          commonErrors: { injectedCount: 1, deltaSum: 0.5 },
        },
      },
    },
  ],
}

function mockProfiles() {
  mockedSettings.useSubagentProfiles.mockReturnValue(
    q({ isLoading: false, isError: false, refetch: vi.fn(), data: payload }) as never,
  )
}

describe("memory viewer render smoke", () => {
  it("expands a bucket to the full entry list with mime and time", () => {
    mockProfiles()
    renderWithQuery(<MemoryDomain />)
    // Collapsed by default: content is not listed yet.
    expect(screen.getByTestId("memory-bucket-userFeedback-toggle")).toBeTruthy()
    expect(screen.queryByTestId("memory-bucket-userFeedback-entries")).toBeNull()
    fireEvent.click(screen.getByTestId("memory-bucket-userFeedback-toggle"))
    const list = screen.getByTestId("memory-bucket-userFeedback-entries")
    // Entries render truncated previews; the full tail needs an entry click.
    expect(list.textContent).not.toContain("FULLTAIL")
    expect(list.textContent).toContain("application/json")
    expect(list.textContent).toContain("2026-09-20T10:00:00Z")
    expect(list.textContent).toContain("Time unknown") // entry without metadata
    fireEvent.click(screen.getByTestId("memory-bucket-userFeedback-toggle"))
    expect(screen.queryByTestId("memory-bucket-userFeedback-entries")).toBeNull()
  })

  it("expands a single entry from the truncated preview to full content", () => {
    mockProfiles()
    renderWithQuery(<MemoryDomain />)
    fireEvent.click(screen.getByTestId("memory-bucket-userFeedback-toggle"))
    const entry = screen.getByTestId("memory-entry-userFeedback-0")
    // Collapsed entry shows the 140-char preview, not the tail.
    expect(entry.textContent).not.toContain("FULLTAIL")
    fireEvent.click(entry)
    expect(entry.textContent).toContain("FULLTAIL")
    // Second entry unaffected.
    expect(screen.getByTestId("memory-entry-userFeedback-1").textContent).toContain("short entry")
  })

  it("filters entries across buckets and shows the match count", () => {
    mockProfiles()
    renderWithQuery(<MemoryDomain />)
    fireEvent.change(screen.getByTestId("memory-search"), {
      target: { value: "cleanup" },
    })
    expect(screen.getByTestId("memory-matches").textContent).toContain("1")
    // Only the bucket with a hit remains.
    expect(screen.getByTestId("memory-bucket-commonErrors")).toBeTruthy()
    expect(screen.queryByTestId("memory-bucket-userFeedback")).toBeNull()
    // No match anywhere → explicit empty state.
    fireEvent.change(screen.getByTestId("memory-search"), { target: { value: "zzz" } })
    expect(screen.getByTestId("memory-search-empty")).toBeTruthy()
  })

  it("renders the efficacy ledger and the gating badge only for skip buckets", () => {
    mockProfiles()
    renderWithQuery(<MemoryDomain />)
    // userFeedback: mean -0.4 over 6 samples → skipped under enforce.
    const skipBadge = screen.getByTestId("memory-gating-userFeedback")
    expect(skipBadge.textContent).toContain("would be skipped under enforce")
    expect(skipBadge.getAttribute("title")).toContain("-0.25")
    const ledger = screen.getByTestId("memory-efficacy-userFeedback")
    expect(ledger.textContent).toContain("6") // injectedCount
    expect(ledger.textContent).toContain("-2.4") // deltaSum
    expect(ledger.textContent).toContain("-0.4") // mean
    // commonErrors: 1 sample → never skipped, ledger shown without badge.
    expect(screen.queryByTestId("memory-gating-commonErrors")).toBeNull()
    expect(screen.getByTestId("memory-efficacy-commonErrors").textContent).toContain("0.5")
    // goodExamples has an entry but no ledger row → honest no-injection hint.
    expect(screen.getByTestId("memory-bucket-goodExamples").textContent).toContain(
      "No injections recorded",
    )
    // Empty bucket collapsed shows its hint.
    expect(screen.getByTestId("memory-bucket-reviewSuggestions").textContent).toContain(
      "No entries in this bucket",
    )
  })
})
