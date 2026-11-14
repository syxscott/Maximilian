// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ProvidersHealthSection tests — the tri-state health badge (cc-switch
 * ProviderCard HealthChip borrowing): pure badge derivation unit tests
 * (operational / degraded / circuitOpen / fallbacks) plus render tests
 * over the breaker-stats query and the reset mutation (success
 * invalidates the stats query; a failed reset rolls back to the derived
 * badge with the server reason inline).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import providersHealthEn from "../src/locales/providers-health.en-US.json"
import { providerHealthBadge, type ProviderBreakerStats } from "../src/components/settings/sections"
import { ProvidersHealthSection } from "../src/components/settings/sections"

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
    ...flatten(providersHealthEn as Record<string, unknown>),
  })
  setLocale("en-US")
})

// ── Badge derivation ────────────────────────────────────────────────────────

describe("providerHealthBadge", () => {
  it("keeps unconfigured providers two-state", () => {
    expect(providerHealthBadge(false, null)).toEqual({ kind: "unconfigured" })
    expect(providerHealthBadge(false, { state: "open", failures: 9 })).toEqual({
      kind: "unconfigured",
    })
  })

  it("falls back to the legacy configured badge while stats are missing", () => {
    expect(providerHealthBadge(true, null)).toEqual({ kind: "unverified" })
    expect(providerHealthBadge(true, undefined)).toEqual({ kind: "unverified" })
  })

  it("resolves closed/half-open/open states against the failure count", () => {
    const stats = (
      state: ProviderBreakerStats["state"],
      failures: number,
    ): ProviderBreakerStats => ({
      state,
      failures,
    })
    expect(providerHealthBadge(true, stats("closed", 0))).toEqual({ kind: "operational" })
    expect(providerHealthBadge(true, stats("closed", 2))).toEqual({
      kind: "degraded",
      failures: 2,
    })
    expect(providerHealthBadge(true, stats("half-open", 0))).toEqual({
      kind: "degraded",
      failures: 0,
    })
    expect(providerHealthBadge(true, stats("open", 5))).toEqual({ kind: "circuitOpen" })
  })
})

// ── Render: breaker query + reset mutation ──────────────────────────────────

const mocks = vi.hoisted(() => ({
  providersHealth: vi.fn(),
  breakerStats: vi.fn(),
  resetBreaker: vi.fn(),
}))

vi.mock("@/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api")>()
  return {
    ...actual,
    // The provider list lives on systemApi; the circuit-breaker endpoints
    // live on chatApi (both mocked — the tests must not hit the network).
    systemApi: {
      ...actual.systemApi,
      providersHealth: mocks.providersHealth,
    },
    chatApi: {
      ...actual.chatApi,
      getCircuitBreakerStats: mocks.breakerStats,
      resetCircuitBreaker: mocks.resetBreaker,
    },
  }
})

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const healthyProvider = { id: "prov-ok", name: "OK", defaultModel: "m", configured: true }
const brokenProvider = { id: "prov-broken", name: "Broken", defaultModel: "m", configured: true }
const ghostProvider = { id: "prov-ghost", name: "Ghost", defaultModel: "m", configured: false }

const closedStats = { state: "closed", failures: 0 }
const openStats = { state: "open", failures: 3 }

describe("ProvidersHealthSection render", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resetBreaker.mockResolvedValue({ ok: true, providerId: "prov-broken" })
  })

  it("shows operational for a clean breaker and unconfigured for a ghost", async () => {
    mocks.providersHealth.mockResolvedValue({
      providers: [healthyProvider, ghostProvider],
      default: "prov-ok",
    })
    mocks.breakerStats.mockResolvedValue(closedStats)

    renderWithQuery(<ProvidersHealthSection />)
    // Wait for the stats query to land — the badge starts as the
    // "unverified" fallback while the query is in flight.
    await waitFor(() =>
      expect(screen.getByTestId("providers-health-state-prov-ok").textContent).toBe("operational"),
    )
    expect(screen.getByTestId("providers-health-state-prov-ghost").textContent).toBe("unconfigured")
    // No reset action when nothing is broken.
    expect(screen.queryByTestId("providers-health-reset-prov-ok")).toBeNull()
    // The breaker query never runs for unconfigured providers.
    expect(mocks.breakerStats).toHaveBeenCalledTimes(1)
  })

  it("shows degraded on recorded failures and circuitOpen with a reset action", async () => {
    mocks.providersHealth.mockResolvedValue({
      providers: [{ ...healthyProvider, id: "prov-degraded" }, brokenProvider],
      default: "",
    })
    mocks.breakerStats.mockImplementation((id: string) =>
      Promise.resolve(id === "prov-degraded" ? { state: "closed", failures: 4 } : openStats),
    )

    renderWithQuery(<ProvidersHealthSection />)
    await waitFor(() =>
      expect(screen.getByTestId("providers-health-state-prov-degraded").textContent).toBe(
        "degraded (4 failures)",
      ),
    )
    expect(screen.getByTestId("providers-health-state-prov-broken").textContent).toBe(
      "circuit open",
    )
    expect(screen.getByTestId("providers-health-reset-prov-broken")).toBeTruthy()
    expect(screen.queryByTestId("providers-health-reset-prov-degraded")).toBeNull()
  })

  it("resets an open circuit and invalidates the stats query on success", async () => {
    mocks.providersHealth.mockResolvedValue({ providers: [brokenProvider], default: "" })
    mocks.breakerStats.mockResolvedValue(openStats)

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidate = vi.spyOn(client, "invalidateQueries")
    render(
      <QueryClientProvider client={client}>
        <ProvidersHealthSection />
      </QueryClientProvider>,
    )
    await screen.findByTestId("providers-health-reset-prov-broken")

    fireEvent.click(screen.getByTestId("providers-health-reset-prov-broken"))
    await waitFor(() => expect(mocks.resetBreaker).toHaveBeenCalledWith("prov-broken"))
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(screen.queryByTestId("providers-health-reset-error-prov-broken")).toBeNull()
  })

  it("rolls a failed reset back: badge stays circuit-open with the reason inline", async () => {
    mocks.providersHealth.mockResolvedValue({ providers: [brokenProvider], default: "" })
    mocks.breakerStats.mockResolvedValue(openStats)
    mocks.resetBreaker.mockRejectedValue(new Error("breaker busy"))

    renderWithQuery(<ProvidersHealthSection />)
    await screen.findByTestId("providers-health-reset-prov-broken")

    fireEvent.click(screen.getByTestId("providers-health-reset-prov-broken"))
    const errorLine = await screen.findByTestId("providers-health-reset-error-prov-broken")
    expect(errorLine.textContent).toContain("Reset failed:")
    expect(errorLine.textContent).toContain("breaker busy")
    // The badge is still derived from the (uninvalidated) open stats.
    expect(screen.getByTestId("providers-health-state-prov-broken").textContent).toBe(
      "circuit open",
    )
    expect(mocks.breakerStats).toHaveBeenCalledTimes(1)
  })
})
