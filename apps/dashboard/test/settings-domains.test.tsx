// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the memory (read-only role memory viewer) and skills
 * (static capability catalog) settings domains. Model-layer units plus
 * render smoke with the data hooks mocked (settings-deep.test.tsx
 * pattern). The automations domain lives in test/automations.test.tsx.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale, t } from "@max/i18n"

import memoryEn from "../src/locales/memory.en-US.json"
import skillsEn from "../src/locales/skills.en-US.json"
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

vi.mock("@/hooks/useSettingsQueries", () => ({
  useSubagentProfiles: vi.fn(),
}))

import * as settingsHooks from "@/hooks/useSettingsQueries"

const mockedSettings = vi.mocked(settingsHooks)

beforeEach(() => {
  vi.resetAllMocks()
})

describe("settings domains render smoke", () => {
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
