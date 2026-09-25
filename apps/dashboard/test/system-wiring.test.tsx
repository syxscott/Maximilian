// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * System-overview mount + memory gating wiring — the round-15 deepening
 * on top of the round-14 components:
 *
 *   1. settingsUiStore      ↔ the "system" section id is canonical
 *   2. SettingsPanel nav    ↔ clicking "System overview" mounts the
 *                             aggregate (store migration + full render)
 *   3. SystemOverviewSection↔ the four status cards composed as-is
 *   4. health row           ↔ payload faults surface as degraded chips
 *   5. MemoryDomain         ↔ one glyph per bucket
 *   6. MemoryDomain         ↔ clicking the enforce-skip badge opens the
 *                             gating decision tooltip (mean + samples,
 *                             straight from the efficacy ledger)
 *
 * SettingsPanel tests stub global fetch with per-URL payloads (the
 * store-wiring.test.tsx pattern); MemoryDomain mocks the data hook
 * (settings-domains.test.tsx pattern).
 */

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"

import { SETTINGS_SECTIONS, useSettingsUiStore } from "../src/stores/settingsUiStore"
import { SettingsPanel } from "../src/components/SettingsPanel"
import { MemoryDomain } from "../src/components/settings/memory-domain/MemoryDomain"

beforeAll(() => {
  // The aggregator globs every domain JSON pair (memory + settings-deep
  // included), so the merged dictionary carries the system/gating keys.
  applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
  setLocale("en-US")
})

// ── Data-hook mocks (one module, both surfaces) ──────────────────────────────

const mocks = vi.hoisted(() => ({
  useSubagentProfiles: vi.fn(),
  useSessionStoreStatus: vi.fn(),
  useMigrationCandidates: vi.fn(),
}))

vi.mock("@/hooks/useSettingsQueries", () => ({
  ORACLE_LESSONS_QUERY_KEY: ["settings", "oracle-lessons"],
  MIGRATIONS_QUERY_KEY: ["settings-deep", "migrations"],
  SUBAGENTS_QUERY_KEY: ["settings-deep", "subagents"],
  useSubagentProfiles: mocks.useSubagentProfiles,
  useSessionStoreStatus: mocks.useSessionStoreStatus,
  useMigrationCandidates: mocks.useMigrationCandidates,
  useSaveOracleLesson: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMemoryImport: () => ({ mutate: vi.fn(), isPending: false }),
}))

function q(props: Record<string, unknown>) {
  return { isFetching: false, ...props }
}

// ── fetch stub for the SettingsPanel path (systemApi → /api/*) ──────────────

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

/** Payloads keyed by URL fragment; everything else answers {} (permissions). */
const FETCH_PAYLOADS: Array<[string, unknown]> = [
  ["/system/vault", { configured: true, path: "/v", open: true, entries: [] }],
  ["/evolution/oracle-lessons", { configured: true, dir: "/lessons", lessons: [] }],
  ["/system/session-store", { available: true, schemaVersion: 1, path: "/db", tables: {} }],
  [
    "/system/migrations",
    {
      api: { openapiRoutes: 114 },
      sessionStore: { available: true },
      i18n: { locales: 22, coreKeys: 1400 },
    },
  ],
]

function stubFetch(overrides: Array<[string, unknown]> = []) {
  // Overrides go first so a more specific payload wins over the default.
  const table = [...overrides, ...FETCH_PAYLOADS]
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      for (const [fragment, body] of table) {
        if (url.includes(fragment)) return okJson(body)
      }
      return okJson({})
    }),
  )
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  useSettingsUiStore.getState().reset()
  // MemoryDomain reads useSubagentProfiles; the SettingsPanel path never
  // mounts it but the mock must still answer shape-correctly if it did.
  mocks.useSubagentProfiles.mockReturnValue(q({ data: { profiles: [] } }))
  mocks.useSessionStoreStatus.mockReturnValue(q({ data: null }))
  mocks.useMigrationCandidates.mockReturnValue(q({ data: null }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

// ── 1. the store knows the system section ────────────────────────────────────

describe("settingsUiStore ↔ system section", () => {
  it("the canonical section list contains system and setSection accepts it", () => {
    expect(SETTINGS_SECTIONS).toContain("system")
    expect(useSettingsUiStore.getState().activeSection).toBeNull()
    useSettingsUiStore.getState().setSection("system")
    expect(useSettingsUiStore.getState().activeSection).toBe("system")
  })
})

// ── 2-4. SettingsPanel mounts the system overview ────────────────────────────

describe("SettingsPanel ↔ SystemOverviewSection", () => {
  it("the nav lists System overview and clicking it mounts the aggregate", async () => {
    stubFetch()
    renderWithQuery(<SettingsPanel />)
    const navButton = screen.getByRole("button", { name: "System overview" })
    expect(screen.queryByTestId("settings-system-overview")).toBeNull()

    fireEvent.click(navButton)
    await waitFor(() => expect(screen.getByTestId("settings-system-overview")).toBeTruthy())
    expect(useSettingsUiStore.getState().activeSection).toBe("system")
  })

  it("the system section composes the four status cards as-is", async () => {
    stubFetch()
    renderWithQuery(<SettingsPanel />)
    fireEvent.click(screen.getByRole("button", { name: "System overview" }))
    await waitFor(() => expect(screen.getByTestId("settings-system-overview")).toBeTruthy())

    // The reused cards (not copies) render inside the aggregate. The vault
    // card renders null until its query settles, so wait for each.
    await waitFor(() => expect(screen.getByTestId("settings-vault")).toBeTruthy())
    expect(screen.getByTestId("settings-session-store")).toBeTruthy()
    expect(screen.getByTestId("settings-migrations")).toBeTruthy()
    expect(screen.getByTestId("settings-oracle")).toBeTruthy()
    // Healthy payloads → the vault chip reads ok.
    await waitFor(() => expect(screen.getByTestId("system-health-vault").dataset.state).toBe("ok"))
  })

  it("a locked vault flips the health chip to degraded through the real payload", async () => {
    stubFetch([["/system/vault", { configured: true, path: "/v", open: false, entries: [] }]])
    renderWithQuery(<SettingsPanel />)
    fireEvent.click(screen.getByRole("button", { name: "System overview" }))
    await waitFor(() =>
      expect(screen.getByTestId("system-health-vault").dataset.state).toBe("degraded"),
    )
  })
})

// ── 5-6. MemoryDomain: bucket glyphs + gating decision tooltip ───────────────

/** planner with one entry in every bucket; per-bucket efficacy overrides. */
function plannerProfile(efficacy: Record<string, { injectedCount: number; deltaSum: number }>) {
  return {
    profiles: [
      {
        role: "planner",
        currentVersion: "v3",
        memory: {
          userFeedback: [{ content: "prefer tables", mime: "text/plain" }],
          reviewSuggestions: [{ content: "trim intro", mime: "text/plain" }],
          commonErrors: [{ content: "forgets locale", mime: "text/plain" }],
          goodExamples: [{ content: "crisp summary", mime: "text/plain" }],
          efficacy,
        },
      },
    ],
  }
}

describe("MemoryDomain bucket glyphs + gating tooltip", () => {
  function mountMemory(efficacy: Record<string, { injectedCount: number; deltaSum: number }>) {
    mocks.useSubagentProfiles.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: plannerProfile(efficacy),
      }) as never,
    )
    return renderWithQuery(<MemoryDomain />)
  }

  it("renders one glyph per memory bucket", () => {
    mountMemory({})
    for (const name of ["userFeedback", "reviewSuggestions", "commonErrors", "goodExamples"]) {
      expect(screen.getByTestId(`memory-bucket-icon-${name}`)).toBeTruthy()
    }
  })

  it("clicking the enforce-skip badge opens the decision tooltip with mean and samples", () => {
    // injectedCount 4, deltaSum -2 → mean -0.5 → strictly below -0.25 → skip.
    mountMemory({ userFeedback: { injectedCount: 4, deltaSum: -2 } })
    expect(screen.getByTestId("memory-gating-userFeedback")).toBeTruthy()
    expect(screen.queryByTestId("memory-gating-detail-userFeedback")).toBeNull()

    fireEvent.click(screen.getByTestId("memory-gating-userFeedback"))
    const detail = screen.getByTestId("memory-gating-detail-userFeedback")
    expect(detail.textContent).toContain("-0.5")
    expect(detail.textContent).toContain("4")
  })

  it("the tooltip hides again on a second click", () => {
    mountMemory({ userFeedback: { injectedCount: 4, deltaSum: -2 } })
    const badge = screen.getByTestId("memory-gating-userFeedback")
    fireEvent.click(badge)
    expect(screen.getByTestId("memory-gating-detail-userFeedback")).toBeTruthy()
    fireEvent.click(badge)
    expect(screen.queryByTestId("memory-gating-detail-userFeedback")).toBeNull()
  })

  it("no skip badge when the ledger misses the rule (mean -0.25 is not below it)", () => {
    // injectedCount 4, deltaSum -1 → mean exactly -0.25 → not < -0.25.
    mountMemory({ userFeedback: { injectedCount: 4, deltaSum: -1 } })
    expect(screen.queryByTestId("memory-gating-userFeedback")).toBeNull()
    expect(screen.queryByTestId("memory-gating-detail-userFeedback")).toBeNull()
  })
})
