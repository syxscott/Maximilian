// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the system-overview section: the health-derivation model
 * (defensive folding of the four subsystem payloads into ok/degraded/
 * unknown) plus a render smoke asserting the summary row's states with
 * the data hooks mocked (settings-deep.test.tsx pattern).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import settingsDeepEn from "../src/locales/settings-deep.en-US.json"
import {
  SUBSYSTEM_ORDER,
  toSystemHealthView,
  worstState,
  type SubsystemState,
} from "../src/components/settings/system-domain/model"
import { SystemOverviewSection } from "../src/components/settings/system-domain/SystemOverviewSection"

/** Flatten the nested locale subtree into the dictionary's dotted keys. */
function flatten(
  tree: Record<string, unknown>,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === "object") {
      flatten(value as Record<string, unknown>, dotted, out)
    } else {
      out[dotted] = String(value)
    }
  }
  return out
}

beforeAll(() => {
  const existing = getDictionary("en-US") ?? {}
  registerLocale("en-US", { ...existing, ...flatten(settingsDeepEn as Record<string, unknown>) })
  setLocale("en-US")
})

// ── Model layer ─────────────────────────────────────────────────────────────

describe("system-domain model: toSystemHealthView", () => {
  it("marks every configured-and-open subsystem ok, in stable order", () => {
    const view = toSystemHealthView({
      vault: { configured: true, open: true, path: "/v", entries: [] },
      store: { available: true, schemaVersion: 1, path: "/db", tables: {} },
      migrations: { api: { openapiRoutes: 113 }, i18n: { locales: 22, coreKeys: 1400 } },
      oracle: { configured: true, dir: "/lessons", lessons: [] },
    })
    expect(view.map((r) => r.id)).toEqual([...SUBSYSTEM_ORDER])
    expect(view.map((r) => r.state)).toEqual(["ok", "ok", "ok", "ok"])
  })

  it("maps explicit faults to degraded: locked vault, disabled store, unset oracle dir", () => {
    const view = toSystemHealthView({
      vault: { configured: true, open: false, path: "/v", entries: [] },
      store: { available: false, schemaVersion: null, path: null, tables: {} },
      migrations: { api: { openapiRoutes: null }, i18n: { locales: null, coreKeys: null } },
      oracle: { configured: false, dir: null, lessons: [] },
    })
    expect(view.map((r) => r.state)).toEqual(["degraded", "degraded", "degraded", "degraded"])
  })

  it("maps missing, errored or malformed payloads to unknown — never a guess", () => {
    const view = toSystemHealthView({})
    expect(view.map((r) => r.state)).toEqual(["unknown", "unknown", "unknown", "unknown"])
    expect(toSystemHealthView({ vault: null, store: "x", migrations: 7 })[0].state).toBe("unknown")
    // A not-configured vault is "unknown" (nothing to fault), and a
    // migrations payload with no readable metric is honestly degraded.
    expect(toSystemHealthView({ vault: { configured: false } })[0].state).toBe("unknown")
    expect(toSystemHealthView({ migrations: { api: null, i18n: null } })[2].state).toBe("degraded")
  })
})

describe("system-domain model: worstState", () => {
  it("degraded wins over ok; all-unknown stays unknown", () => {
    expect(worstState(["ok", "ok"])).toBe("ok")
    expect(worstState(["ok", "degraded", "ok"] as SubsystemState[])).toBe("degraded")
    expect(worstState(["unknown", "unknown"])).toBe("unknown")
    expect(worstState([])).toBe("unknown")
  })
})

// ── Render smoke: summary row over mocked subsystem queries ─────────────────

const mocks = vi.hoisted(() => ({
  vaultStatus: vi.fn(),
  oracleLessons: vi.fn(),
  mutateAsync: vi.fn(),
  useSessionStoreStatus: vi.fn(),
  useMigrationCandidates: vi.fn(),
}))

vi.mock("@/api", () => ({
  systemApi: {
    vaultStatus: mocks.vaultStatus,
    oracleLessons: mocks.oracleLessons,
  },
}))

vi.mock("@/hooks/useSettingsQueries", () => ({
  ORACLE_LESSONS_QUERY_KEY: ["settings", "oracle-lessons"],
  MIGRATIONS_QUERY_KEY: ["settings-deep", "migrations"],
  useSessionStoreStatus: mocks.useSessionStoreStatus,
  useMigrationCandidates: mocks.useMigrationCandidates,
  // The composed oracle editor calls the save hook; it never fires here.
  useSaveOracleLesson: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}))

function q(props: Record<string, unknown>) {
  return { isPending: false, isError: false, ...props }
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function primeSubsystems(overrides: {
  vault?: unknown
  store?: unknown
  migrations?: unknown
  oracle?: unknown
}) {
  mocks.vaultStatus.mockResolvedValue(overrides.vault)
  mocks.oracleLessons.mockResolvedValue(overrides.oracle)
  mocks.useSessionStoreStatus.mockReturnValue(q({ data: overrides.store }))
  mocks.useMigrationCandidates.mockReturnValue(q({ data: overrides.migrations }))
}

describe("SystemOverviewSection: render smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    primeSubsystems({
      vault: { configured: true, open: true, path: "/v", entries: [] },
      store: { available: true, schemaVersion: 1, path: "/db", tables: { sessions: 3 } },
      migrations: { api: { openapiRoutes: 114 }, i18n: { locales: 22, coreKeys: 1400 } },
      oracle: { configured: true, dir: "/lessons", lessons: [] },
    })
  })

  it("renders the four health chips with ok states and composes the cards", async () => {
    renderWithQuery(<SystemOverviewSection />)
    await waitFor(() => expect(screen.getByTestId("system-health-vault").dataset.state).toBe("ok"))
    expect(screen.getByTestId("system-health-store").dataset.state).toBe("ok")
    expect(screen.getByTestId("system-health-migrations").dataset.state).toBe("ok")
    expect(screen.getByTestId("system-health-oracle").dataset.state).toBe("ok")
    // The composed cards are present (testids from the existing components).
    expect(screen.getByTestId("settings-vault")).toBeTruthy()
    expect(screen.getByTestId("settings-session-store")).toBeTruthy()
    expect(screen.getByTestId("settings-migrations")).toBeTruthy()
    expect(screen.getByTestId("settings-oracle")).toBeTruthy()
  })

  it("flips a chip to degraded when its subsystem reports a fault", async () => {
    primeSubsystems({
      vault: { configured: true, open: false, path: "/v", entries: [] }, // locked
      store: { available: false, schemaVersion: null, path: null, tables: {} },
      migrations: { api: { openapiRoutes: 114 }, i18n: { locales: 22, coreKeys: 1400 } },
      oracle: { configured: true, dir: "/lessons", lessons: [] },
    })
    renderWithQuery(<SystemOverviewSection />)
    await waitFor(() =>
      expect(screen.getByTestId("system-health-vault").dataset.state).toBe("degraded"),
    )
    expect(screen.getByTestId("system-health-store").dataset.state).toBe("degraded")
    expect(screen.getByTestId("system-health-migrations").dataset.state).toBe("ok")
  })

  it("keeps a subsystem unknown while its query is still loading", () => {
    mocks.vaultStatus.mockReturnValue(new Promise(() => {})) // never settles
    mocks.oracleLessons.mockReturnValue(new Promise(() => {}))
    mocks.useSessionStoreStatus.mockReturnValue(q({ isPending: true }))
    mocks.useMigrationCandidates.mockReturnValue(q({ isPending: true }))
    renderWithQuery(<SystemOverviewSection />)
    expect(screen.getByTestId("system-health-vault").dataset.state).toBe("unknown")
    expect(screen.getByTestId("system-health-store").dataset.state).toBe("unknown")
  })
})
