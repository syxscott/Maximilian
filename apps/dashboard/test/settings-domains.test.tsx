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
import settingsDeepEn from "../src/locales/settings-deep.en-US.json"
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
import { toMigrationsStatusView } from "../src/components/settings/store-domain/model"
import { MigrationCandidatesCard } from "../src/components/settings/store-domain/MigrationCandidatesCard"
import {
  SETTINGS_SECTION_DOMAINS,
  SETTINGS_SECTIONS,
  SettingsSectionNav,
} from "../src/components/settings/sections"
import { filterSections, type SettingsSearchSection } from "../src/components/settings/search-model"

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
    ...flatten(settingsDeepEn as Record<string, unknown>),
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
    expect(
      executor?.buckets.find((b) => b.name === "userFeedback")?.entries.map((e) => e.content),
    ).toEqual(["be terse"])
    expect(executor?.buckets.every((b) => !b.entries.some((e) => e.content === "retired"))).toBe(
      true,
    )
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
    const asEntry = (content: string) => ({ content, mime: "text/plain", at: null })
    expect(entryPreview("short")).toBe("short")
    expect(entryPreview("x".repeat(200))).toMatch(/…$/)
    expect(
      bucketPreviews({
        name: "userFeedback",
        count: 4,
        entries: ["a", "b", "c", "d"].map(asEntry),
      }),
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
  SUBAGENTS_QUERY_KEY: ["settings-deep", "subagents"],
  MIGRATIONS_QUERY_KEY: ["settings-deep", "migrations"],
  useSubagentProfiles: vi.fn(),
  useMigrationCandidates: vi.fn(),
  useMemoryImport: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

import * as settingsHooks from "@/hooks/useSettingsQueries"

const mockedSettings = vi.mocked(settingsHooks)

beforeEach(() => {
  vi.resetAllMocks()
  // resetAllMocks clears the module-factory implementation; MemoryDomain
  // renders useMemoryImport() on every pass, so re-seed it.
  mockedSettings.useMemoryImport.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never)
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
    // Buckets start collapsed; expand userFeedback to see its entries.
    fireEvent.click(screen.getByTestId("memory-bucket-userFeedback-toggle"))
    expect(screen.getByText("prefer tables")).toBeTruthy()
    // Switch to executor (bucket expansion state persists across roles).
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

// ── Migration candidates card (store domain) ─────────────────────────────────

describe("migrations status model", () => {
  it("normalizes the /system/migrations payload", () => {
    const view = toMigrationsStatusView({
      api: { openapiRoutes: 112 },
      sessionStore: {
        available: true,
        schemaVersion: 2,
        tables: { messages: 40, sessions: 3, custom_table: 7, usage: null },
      },
      i18n: { locales: 10, coreKeys: 557 },
    })
    expect(view.apiRoutes).toBe(112)
    expect(view.sessionStore).toEqual({
      available: true,
      schemaVersion: 2,
      // Known tables first in display order, then unknown keys in API order.
      tables: [
        { name: "sessions", count: 3 },
        { name: "messages", count: 40 },
        { name: "usage", count: null },
        { name: "custom_table", count: 7 },
      ],
    })
    expect(view.i18n).toEqual({ locales: 10, coreKeys: 557 })
  })

  it("falls back to the empty view for garbage and partial payloads", () => {
    expect(toMigrationsStatusView(null)).toEqual({
      apiRoutes: null,
      sessionStore: { available: false, schemaVersion: null, tables: [] },
      i18n: { locales: null, coreKeys: null },
    })
    expect(toMigrationsStatusView("x")).toEqual(toMigrationsStatusView(undefined))
    const partial = toMigrationsStatusView({ api: { openapiRoutes: "12" }, i18n: {} })
    expect(partial.apiRoutes).toBeNull() // non-numeric → honest unknown
    expect(partial.i18n).toEqual({ locales: null, coreKeys: null })
    expect(partial.sessionStore.available).toBe(false)
  })
})

describe("MigrationCandidatesCard render smoke", () => {
  it("renders the three status blocks with real values", () => {
    mockedSettings.useMigrationCandidates.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          api: { openapiRoutes: 112 },
          sessionStore: {
            available: true,
            schemaVersion: 2,
            tables: { sessions: 3, messages: 40, events: 0, usage: null, steering_queue: 0 },
          },
          i18n: { locales: 10, coreKeys: 557 },
        },
      }) as never,
    )
    renderWithQuery(<MigrationCandidatesCard />)
    expect(screen.getByTestId("migrations-grid")).toBeTruthy()
    expect(screen.getByTestId("migrations-api-routes").textContent).toBe("112")
    expect(screen.getByTestId("migrations-store-tables").textContent).toBe("5")
    expect(screen.getByText("Running")).toBeTruthy()
    expect(screen.getByTestId("migrations-i18n-locales").textContent).toBe("10")
    expect(screen.getByTestId("migrations-i18n-coreKeys").textContent).toBe("557")
  })

  it("renders honest unknowns when the backend cannot read a metric", () => {
    mockedSettings.useMigrationCandidates.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          api: { openapiRoutes: null },
          sessionStore: { available: false, schemaVersion: null, tables: {} },
          i18n: { locales: null, coreKeys: null },
        },
      }) as never,
    )
    renderWithQuery(<MigrationCandidatesCard />)
    expect(screen.getByTestId("migrations-api-routes").textContent).toBe("Unknown")
    expect(screen.getByTestId("migrations-store-tables").textContent).toBe("Unknown")
    expect(screen.getByTestId("migrations-i18n-locales").textContent).toBe("Unknown")
    expect(screen.getByTestId("migrations-i18n-coreKeys").textContent).toBe("Unknown")
    expect(screen.getByText("Disabled")).toBeTruthy()
  })

  it("shows the loading and error states with retry", () => {
    mockedSettings.useMigrationCandidates.mockReturnValue(
      q({ isLoading: true, isError: false, refetch: vi.fn() }) as never,
    )
    const { rerender } = renderWithQuery(<MigrationCandidatesCard />)
    expect(screen.getByText("Loading…")).toBeTruthy()

    mockedSettings.useMigrationCandidates.mockReturnValue(
      q({ isLoading: false, isError: true, refetch: vi.fn() }) as never,
    )
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MigrationCandidatesCard />
      </QueryClientProvider>,
    )
    expect(screen.getByText("Failed to load")).toBeTruthy()
    expect(screen.getByText("Retry")).toBeTruthy()
  })
})

// ── Settings global search: model + nav wiring ───────────────────────────────

describe("settings search model (filterSections)", () => {
  const fixtures: SettingsSearchSection[] = [
    {
      id: "providers",
      titleKey: "settings.providersHealth.title",
      title: "Providers health",
      descriptionKey: "settings.providersHealth.description",
      entries: [
        { id: "providers", titleKey: "nav.providers", title: "Providers" },
        { id: "model-picker", titleKey: "modelPicker.title", title: "Model picker" },
      ],
    },
    {
      id: "store",
      titleKey: "settingsDeep.store.title",
      title: "Session store",
      descriptionKey: "settingsDeep.store.description",
      entries: [{ id: "sessions", titleKey: "sessions.title", title: "Sessions" }],
    },
    {
      id: "memory",
      titleKey: "memory.title",
      title: "Role memory",
      descriptionKey: "memory.description",
      entries: [{ id: "memory", titleKey: "memory.title", title: "Role memory" }],
    },
  ]
  const ids = (query: string) => filterSections(fixtures, query).map((s) => s.id)

  it("keeps every section in order for an empty or whitespace query", () => {
    expect(filterSections(fixtures, "").map((s) => s.id)).toEqual(["providers", "store", "memory"])
    expect(filterSections(fixtures, "   ").map((s) => s.id)).toEqual([
      "providers",
      "store",
      "memory",
    ])
    // New array, input untouched.
    expect(filterSections(fixtures, "")).not.toBe(fixtures)
  })

  it("matches localized section titles case-insensitively", () => {
    expect(ids("session store")).toEqual(["store"])
    expect(ids("ROLE MEMORY")).toEqual(["memory"])
    expect(ids("health")).toEqual(["providers"])
  })

  it("matches a section through the subdomains it surfaces", () => {
    // "model-picker" is only a registry entry of the providers section.
    expect(ids("model-picker")).toEqual(["providers"])
    // "sessions" is the store section's subdomain (entry id and title).
    expect(ids("sessions")).toEqual(["store"])
  })

  it("falls back to titleKeys and section ids for matching", () => {
    expect(ids("settingsDeep.store")).toEqual(["store"])
    expect(ids("memory.title")).toEqual(["memory"])
    expect(ids("store")).toEqual(["store"])
  })

  it("returns nothing for a no-hit query (the nav shows its empty state)", () => {
    expect(filterSections(fixtures, "zzz-nothing")).toEqual([])
    expect(ids("providerss")).toEqual([])
  })

  it("projects the real settings bridge into searchable rows", () => {
    // Same projection the nav renders with: sections + their registry
    // subdomains, matched on keys (labels resolve via t() at render time).
    const bridge: SettingsSearchSection[] = SETTINGS_SECTIONS.map((section) => ({
      id: section.id,
      titleKey: section.titleKey,
      title: section.titleKey,
      descriptionKey: section.descriptionKey,
      entries: (SETTINGS_SECTION_DOMAINS.find((d) => d.id === section.id)?.domains ?? []).map(
        (domainId) => ({ id: domainId, titleKey: domainId, title: domainId }),
      ),
    }))
    expect(bridge).toHaveLength(SETTINGS_SECTIONS.length)
    expect(filterSections(bridge, "")).toHaveLength(bridge.length)
    expect(filterSections(bridge, "memory").map((s) => s.id)).toEqual(["memory"])
    expect(filterSections(bridge, "model-picker").map((s) => s.id)).toEqual(["providers"])
    expect(filterSections(bridge, "usageCharts").map((s) => s.id)).toEqual(["usageCharts"])
  })
})

describe("settings search nav smoke", () => {
  it("narrows the section buttons to the query matches and still selects", () => {
    const onSelect = vi.fn()
    renderWithQuery(<SettingsSectionNav active="appearance" onSelect={onSelect} />)
    const nav = screen.getByTestId("settings-nav")
    expect(nav.querySelectorAll("button")).toHaveLength(SETTINGS_SECTIONS.length)

    fireEvent.change(screen.getByTestId("settings-section-search"), {
      target: { value: "memory" },
    })
    // Only the matching section remains, with the match count beside the input.
    expect(screen.getByText("Role memory")).toBeTruthy()
    expect(nav.querySelectorAll("button")).toHaveLength(1)
    expect(screen.getByTestId("settings-search-count").textContent).toBe("1 sections match")
    // The filtered button still drives section selection.
    fireEvent.click(screen.getByText("Role memory"))
    expect(onSelect).toHaveBeenCalledWith("memory")

    // Subdomain matching: "model-picker" surfaces the providers section.
    fireEvent.change(screen.getByTestId("settings-section-search"), {
      target: { value: "model-picker" },
    })
    expect(nav.querySelectorAll("button")).toHaveLength(1)
    expect(screen.getByText("Provider health")).toBeTruthy()
  })

  it("shows the empty state when nothing matches and recovers on clear", () => {
    renderWithQuery(<SettingsSectionNav active="memory" onSelect={vi.fn()} />)
    const nav = screen.getByTestId("settings-nav")
    fireEvent.change(screen.getByTestId("settings-section-search"), {
      target: { value: "zzz-nothing" },
    })
    expect(screen.getByTestId("settings-search-empty")).toBeTruthy()
    expect(nav.querySelectorAll("button")).toHaveLength(0)

    // Clearing the query restores the full section list.
    fireEvent.change(screen.getByTestId("settings-section-search"), { target: { value: "" } })
    expect(screen.queryByTestId("settings-search-empty")).toBeNull()
    expect(screen.queryByTestId("settings-search-count")).toBeNull()
    expect(nav.querySelectorAll("button")).toHaveLength(SETTINGS_SECTIONS.length)
  })
})
