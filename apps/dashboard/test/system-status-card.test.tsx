// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the migrations card's system-status follow-ups: the refresh
 * clock model (formatClock), the raw-JSON drill-down helper (rawJsonText)
 * and the render wiring — last-refreshed stamp driven by the query's
 * dataUpdatedAt, the manual refresh button (invalidate + refetch) and the
 * per-section <details> raw JSON.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import settingsDeepEn from "../src/locales/settings-deep.en-US.json"
import { formatClock, rawJsonText } from "../src/components/settings/store-domain/model"
import { MigrationCandidatesCard } from "../src/components/settings/store-domain/MigrationCandidatesCard"

beforeAll(() => {
  const existing = getDictionary("en-US") ?? {}
  registerLocale("en-US", {
    ...existing,
    ...flatten(settingsDeepEn as Record<string, unknown>),
  })
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

// ── Model ───────────────────────────────────────────────────────────────────

describe("system status model helpers", () => {
  it("formats a dataUpdatedAt timestamp as local HH:MM:SS", () => {
    const ts = new Date(2026, 8, 24, 14, 3, 5).getTime()
    expect(formatClock(ts)).toBe("14:03:05")
    expect(formatClock(new Date(2026, 0, 2, 3, 7, 9).getTime())).toBe("03:07:09")
  })

  it("honestly reports no clock for undefined / junk timestamps", () => {
    expect(formatClock(undefined)).toBeNull()
    expect(formatClock(0)).toBeNull()
    expect(formatClock(Number.NaN)).toBeNull()
    expect(formatClock(-5)).toBeNull()
  })

  it("pretty-prints raw sections and returns null for missing data", () => {
    expect(rawJsonText({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(rawJsonText(undefined)).toBeNull()
    expect(rawJsonText(null)).toBeNull()
  })
})

// ── Render: refresh stamp, manual refresh, raw JSON drill-down ──────────────

vi.mock("@/hooks/useSettingsQueries", () => ({
  SUBAGENTS_QUERY_KEY: ["settings-deep", "subagents"],
  MIGRATIONS_QUERY_KEY: ["settings-deep", "migrations"],
  useSubagentProfiles: vi.fn(),
  useMigrationCandidates: vi.fn(),
  useMemoryImport: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

import * as settingsHooks from "@/hooks/useSettingsQueries"

const mockedSettings = vi.mocked(settingsHooks)

const data = {
  api: { openapiRoutes: 112 },
  sessionStore: {
    available: true,
    schemaVersion: 2,
    tables: { sessions: 3, messages: 40, events: 0, usage: null, steering_queue: 0 },
  },
  i18n: { locales: 10, coreKeys: 557 },
}

function q(props: Record<string, unknown>) {
  return { isFetching: false, ...props }
}

beforeEach(() => {
  vi.resetAllMocks()
})

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(client, "invalidateQueries")
  const utils = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return { ...utils, client, invalidateSpy }
}

describe("MigrationCandidatesCard system-status wiring", () => {
  it("shows the last refresh time from the query's dataUpdatedAt", () => {
    mockedSettings.useMigrationCandidates.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data,
        dataUpdatedAt: new Date(2026, 8, 24, 9, 30, 0).getTime(),
      }) as never,
    )
    renderWithQuery(<MigrationCandidatesCard />)
    const stamp = screen.getByTestId("migrations-refreshed-at")
    expect(stamp.textContent).toContain("Refreshed")
    expect(stamp.textContent).toContain("09:30:00")
  })

  it("shows no refresh stamp before the first successful fetch", () => {
    mockedSettings.useMigrationCandidates.mockReturnValue(
      q({ isLoading: false, isError: false, refetch: vi.fn(), data }) as never,
    )
    renderWithQuery(<MigrationCandidatesCard />)
    expect(screen.queryByTestId("migrations-refreshed-at")).toBeNull()
  })

  it("invalidates the migrations query and refetches on the refresh button", () => {
    const refetch = vi.fn()
    mockedSettings.useMigrationCandidates.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch,
        data,
        dataUpdatedAt: new Date(2026, 8, 24, 9, 30, 0).getTime(),
      }) as never,
    )
    const { invalidateSpy } = renderWithQuery(<MigrationCandidatesCard />)
    fireEvent.click(screen.getByTestId("migrations-refresh"))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["settings-deep", "migrations"],
    })
  })

  it("keeps the three status blocks with real values", () => {
    mockedSettings.useMigrationCandidates.mockReturnValue(
      q({ isLoading: false, isError: false, refetch: vi.fn(), data }) as never,
    )
    renderWithQuery(<MigrationCandidatesCard />)
    expect(screen.getByTestId("migrations-grid")).toBeTruthy()
    expect(screen.getByTestId("migrations-api-routes").textContent).toBe("112")
    expect(screen.getByTestId("migrations-store-tables").textContent).toBe("5")
    expect(screen.getByText("Running")).toBeTruthy()
    expect(screen.getByTestId("migrations-i18n-locales").textContent).toBe("10")
    expect(screen.getByTestId("migrations-i18n-coreKeys").textContent).toBe("557")
  })

  it("drills down into the raw JSON of each section", () => {
    mockedSettings.useMigrationCandidates.mockReturnValue(
      q({ isLoading: false, isError: false, refetch: vi.fn(), data }) as never,
    )
    renderWithQuery(<MigrationCandidatesCard />)
    // Native <details> blocks exist per section with the raw payload inside.
    for (const id of ["migrations-api-json", "migrations-store-json", "migrations-i18n-json"]) {
      expect(screen.getByTestId(id)).toBeTruthy()
    }
    expect(screen.getByTestId("migrations-api-json").textContent).toContain("openapiRoutes")
    expect(screen.getByTestId("migrations-api-json").textContent).toContain("112")
    expect(screen.getByTestId("migrations-store-json").textContent).toContain("schemaVersion")
    expect(screen.getByTestId("migrations-i18n-json").textContent).toContain("coreKeys")
  })

  it("renders no raw JSON block when the payload has not arrived", () => {
    mockedSettings.useMigrationCandidates.mockReturnValue(
      q({ isLoading: false, isError: false, refetch: vi.fn() }) as never,
    )
    renderWithQuery(<MigrationCandidatesCard />)
    expect(screen.queryByTestId("migrations-api-json")).toBeNull()
    expect(screen.queryByTestId("migrations-store-json")).toBeNull()
    expect(screen.queryByTestId("migrations-i18n-json")).toBeNull()
  })
})
