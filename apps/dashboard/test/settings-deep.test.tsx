// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the settings deep domains: model-layer unit tests (pure
 * normalization + chart geometry) plus render smoke for each domain with
 * the data hooks mocked (UsagePanel.test.tsx pattern — React Query +
 * fetch stubs interact in fragile ways under jsdom; the contract under
 * test here is the model layer and the UI's three states).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import settingsDeepEn from "../src/locales/settings-deep.en-US.json"
import {
  toPresetViews,
  filterPresets,
  presetCategories,
  windowList,
  toTestChatView,
  testableProviders,
} from "../src/components/settings/providers-manager/model"
import {
  toSubagentProfileViews,
  filterProfiles,
  bucketPreview,
} from "../src/components/settings/subagents-domain/model"
import {
  toDailySeries,
  toSummaryView,
  toWindowRows,
  formatCompact,
  polylinePoints,
  dailyBars,
} from "../src/components/settings/usage-domain/model"
import { toStoreStatusView } from "../src/components/settings/store-domain/model"

beforeAll(() => {
  const existing = getDictionary("en-US") ?? {}
  registerLocale("en-US", { ...existing, ...(settingsDeepEn as Record<string, string>) })
  setLocale("en-US")
})

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** Loose query-result stub: components only read these fields. */
function q(props: Record<string, unknown>) {
  return { isFetching: false, ...props }
}

// ── Providers manager: model ────────────────────────────────────────────────

describe("providers-manager model", () => {
  const presets = toPresetViews({
    presets: [
      {
        id: "anthropic",
        name: "Anthropic",
        category: "official",
        apiFormat: "anthropic",
        defaultModel: "claude-fable-5-1",
        baseUrl: "https://api.anthropic.com",
        envKey: "ANTHROPIC_API_KEY",
        envModel: null,
        configured: true,
        isOfficial: true,
        isPartner: false,
      },
      {
        id: "deepseek",
        name: "DeepSeek",
        category: "china",
        apiFormat: "openai_chat",
        defaultModel: "deepseek-chat",
        baseUrl: "https://api.deepseek.com",
        envKey: "DEEPSEEK_API_KEY",
        configured: false,
      },
    ],
    total: 2,
  })

  it("normalizes passthrough JSON into typed views", () => {
    expect(presets).toHaveLength(2)
    expect(presets[0]).toMatchObject({
      id: "anthropic",
      category: "official",
      configured: true,
      envModel: null,
    })
    expect(presets[1].isOfficial).toBe(false)
  })

  it("defends against garbage payloads", () => {
    expect(toPresetViews(null)).toEqual([])
    expect(toPresetViews("nope")).toEqual([])
    expect(toPresetViews({ presets: "not-an-array" })).toEqual([])
    expect(toPresetViews({ presets: [null, 42, {}] })).toEqual([])
  })

  it("filters by category and case-insensitive query", () => {
    expect(presetCategories(presets)).toEqual(["official", "china"])
    expect(filterPresets(presets, "official", "")).toHaveLength(1)
    expect(filterPresets(presets, "all", "DEEPSEEK")).toHaveLength(1)
    expect(filterPresets(presets, "all", "fable")).toHaveLength(1)
    expect(filterPresets(presets, "china", "anthropic")).toHaveLength(0)
  })

  it("caps lists and reports the hidden remainder", () => {
    const many = filterPresets(
      Array.from({ length: 60 }, (_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
        category: "custom",
        apiFormat: "openai_chat",
        defaultModel: "m",
        baseUrl: "",
        envKey: "",
        envModel: null,
        configured: false,
        isOfficial: false,
        isPartner: false,
      })),
      "all",
      "",
    )
    const page = windowList(many, 50)
    expect(page.shown).toBe(50)
    expect(page.total).toBe(60)
    expect(page.hidden).toBe(10)
  })

  it("normalizes test-chat results and picks testable providers", () => {
    const view = toTestChatView({
      ok: true,
      providerId: "anthropic",
      model: "claude-fable-5-1",
      content: "hello",
      durationMs: 123,
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
    })
    expect(view).toMatchObject({ ok: true, durationMs: 123 })
    expect(view?.usage).toEqual({ promptTokens: 5, completionTokens: 7 })
    expect(toTestChatView(null)).toBeNull()
    expect(toTestChatView(undefined)).toBeNull()
    expect(testableProviders(presets)).toEqual([presets[0]])
  })
})

// ── Subagents domain: model ─────────────────────────────────────────────────

describe("subagents-domain model", () => {
  it("normalizes profiles with current MemoryEntry objects", () => {
    const views = toSubagentProfileViews({
      profiles: [
        {
          id: "planner",
          role: "planner",
          currentVersion: "v3",
          avgScore: 8.25,
          successRate: 0.9,
          totalTasks: 12,
          memory: {
            userFeedback: [
              { content: "prefer tables", mime: "text/plain" },
              { content: "shorter plans", mime: "text/plain" },
            ],
            reviewSuggestions: [],
            commonErrors: [],
            goodExamples: [],
          },
        },
      ],
    })
    expect(views).toHaveLength(1)
    const p = views[0]
    expect(p.role).toBe("planner")
    expect(p.version).toBe("v3")
    expect(p.avgScore).toBe(8.25)
    expect(p.executionCount).toBe(12)
    expect(p.recentFeedbackCount).toBe(2)
    expect(p.memoryBuckets.find((b) => b.name === "userFeedback")?.entries).toHaveLength(2)
  })

  it("coerces legacy string buckets and flattens the archived quarantine", () => {
    const views = toSubagentProfileViews({
      profiles: [
        {
          role: "executor",
          memory: {
            userFeedback: ["plain string entry"],
            archived: { userFeedback: [{ content: "retired dup" }] },
          },
        },
      ],
    })
    const p = views[0]
    expect(p.version).toBe("v1")
    expect(p.avgScore).toBeNull()
    expect(p.memoryBuckets.find((b) => b.name === "userFeedback")?.entries).toEqual([
      "plain string entry",
    ])
    expect(p.memoryBuckets.find((b) => b.name === "archived")?.entries).toEqual(["retired dup"])
  })

  it("defends against garbage and filters by role query", () => {
    expect(toSubagentProfileViews(null)).toEqual([])
    expect(toSubagentProfileViews({ profiles: 7 })).toEqual([])
    const views = toSubagentProfileViews({
      profiles: [{ role: "reviewer" }, null, { noRole: true }],
    })
    expect(views.map((v) => v.role)).toEqual(["reviewer"])
    expect(filterProfiles(views, "REV")).toHaveLength(1)
    expect(filterProfiles(views, "zzz")).toHaveLength(0)
  })

  it("previews buckets with a length cap", () => {
    const bucket = {
      name: "userFeedback",
      entries: ["x".repeat(200), "short", "third", "fourth"],
    }
    const preview = bucketPreview(bucket)
    expect(preview).toHaveLength(3)
    expect(preview[0].endsWith("…")).toBe(true)
    expect(preview[1]).toBe("short")
  })
})

// ── Usage domain: model ─────────────────────────────────────────────────────

describe("usage-domain model", () => {
  const daily = {
    range: "7d",
    daily: [
      {
        date: "2026-09-01",
        requestCount: 5,
        totalTokens: 1500,
        totalCostUsd: 0.1,
      },
      {
        date: "2026-09-02",
        requestCount: 10,
        totalTokens: 3000,
        totalCostUsd: 0.2,
      },
    ],
  }

  it("extracts metric-specific daily series", () => {
    expect(toDailySeries(daily, "requests")).toEqual([
      { date: "2026-09-01", value: 5 },
      { date: "2026-09-02", value: 10 },
    ])
    expect(toDailySeries(daily, "cost")[1].value).toBeCloseTo(0.2)
    expect(toDailySeries(null, "tokens")).toEqual([])
    expect(toDailySeries({ daily: [{}] }, "tokens")).toEqual([])
  })

  it("normalizes summary and window rows defensively", () => {
    const summary = toSummaryView({
      totalRequests: 42,
      realTotalTokens: 75_000,
      totalCostUsd: 1.5,
      totalCostUsdKnown: true,
      successRate: 0.95,
      cacheHitRate: 0.8,
    })
    expect(summary.requests).toBe(42)
    expect(summary.costKnown).toBe(true)
    expect(toSummaryView(null).requests).toBe(0)

    const rows = toWindowRows({
      windows: [
        { window: "5h", requests: 3, inputTokens: 100, outputTokens: 50, costUsd: null },
        { window: "24h", requests: 9, inputTokens: 300, outputTokens: 150, costUsd: 0.4 },
      ],
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].costUsd).toBeNull()
    expect(rows[1].costUsd).toBeCloseTo(0.4)
    expect(toWindowRows("x")).toEqual([])
  })

  it("formats compact metrics", () => {
    expect(formatCompact(999)).toBe("999")
    expect(formatCompact(1500)).toBe("1.5k")
    expect(formatCompact(3_400_000)).toBe("3.4M")
    expect(formatCompact(Number.NaN)).toBe("—")
  })

  it("computes polyline geometry incl. degenerate cases", () => {
    expect(polylinePoints([], 100, 50, 6)).toBe("")
    // Single point → centered.
    expect(polylinePoints([5], 100, 50, 6)).toBe("50.00,25.00")
    // Flat series → mid-height line across the full width.
    const flat = polylinePoints([7, 7, 7], 100, 50, 6)
    expect(flat.split(" ")).toHaveLength(3)
    expect(flat.split(" ").every((pt) => pt.endsWith(",25.00"))).toBe(true)
    // Rising series: SVG y grows downward, so a rising value must produce a
    // falling y — first point low on screen (large y), last high (small y).
    const rising = polylinePoints([0, 10], 100, 50, 6).split(" ")
    const [x0, y0] = rising[0].split(",").map(Number)
    const [x1, y1] = rising[1].split(",").map(Number)
    expect(x0).toBeLessThan(x1)
    expect(y0).toBeGreaterThan(y1)
  })

  it("computes bar rectangles incl. zero-value days", () => {
    expect(dailyBars([], [], 100, 50, 6)).toEqual([])
    expect(dailyBars(["a"], [], 100, 50, 6)).toEqual([])
    const bars = dailyBars(["2026-09-01", "2026-09-02"], [0, 100], 100, 50, 6)
    expect(bars).toHaveLength(2)
    expect(bars[0].h).toBeGreaterThanOrEqual(1) // zero days stay visible
    expect(bars[1].h).toBeGreaterThan(bars[0].h)
    expect(bars[1].y).toBeLessThan(bars[0].y)
  })
})

// ── Store domain: model ─────────────────────────────────────────────────────

describe("store-domain model", () => {
  it("normalizes a full status payload with stable table order", () => {
    const view = toStoreStatusView({
      available: true,
      schemaVersion: 2,
      path: "/data/session-store.sqlite",
      tables: {
        usage: 12,
        sessions: 3,
        messages: 40,
        events: 99,
        steering_queue: 0,
      },
    })
    expect(view.available).toBe(true)
    expect(view.schemaVersion).toBe(2)
    expect(view.tables.map((tb) => tb.name)).toEqual([
      "sessions",
      "messages",
      "events",
      "usage",
      "steering_queue",
    ])
    expect(view.tables[3].count).toBe(12)
  })

  it("maps unknown counts to null and defends against garbage", () => {
    const view = toStoreStatusView({
      available: true,
      tables: { sessions: "not-a-number", custom_table: 5 },
    })
    expect(view.tables[0].name).toBe("sessions")
    expect(view.tables[0].count).toBeNull()
    expect(view.tables[1]).toEqual({ name: "custom_table", count: 5 })
    expect(toStoreStatusView(null)).toEqual({
      available: false,
      schemaVersion: null,
      path: null,
      tables: [],
    })
  })
})

// ── Render smoke: each domain, with hooks mocked ────────────────────────────

vi.mock("@/hooks/useSettingsQueries", () => ({
  ProviderPresetSummarySchema: { parse: (v: unknown) => v },
  useProviderPresets: vi.fn(),
  useProviderTestChat: vi.fn(),
  useSubagentProfiles: vi.fn(),
  useUsageSummary: vi.fn(),
  useUsageDaily: vi.fn(),
  useUsageWindows: vi.fn(),
  useSessionStoreStatus: vi.fn(),
}))

import * as hooks from "@/hooks/useSettingsQueries"
import { PresetCatalogBrowser } from "../src/components/settings/providers-manager/PresetCatalogBrowser"
import { ProviderModelTester } from "../src/components/settings/providers-manager/ProviderModelTester"
import { SubagentsDomain } from "../src/components/settings/subagents-domain/SubagentsDomain"
import { UsageDomain } from "../src/components/settings/usage-domain/UsageDomain"
import { SessionStoreStatusCard } from "../src/components/settings/store-domain/SessionStoreStatusCard"

const mocked = vi.mocked(hooks)

// Persistent mockReturnValue per test (reset here): fireEvent-driven state
// updates re-run the component, so Once-queued values would run dry mid-test.
beforeEach(() => {
  vi.resetAllMocks()
})

describe("settings deep domains: render smoke", () => {
  it("PresetCatalogBrowser shows loading, then the preset list with filters", () => {
    mocked.useProviderPresets.mockReturnValue(
      q({ isLoading: true, isError: false, refetch: vi.fn() }) as never,
    )
    const { rerender } = renderWithQuery(<PresetCatalogBrowser />)
    expect(screen.getByText("Loading…")).toBeTruthy()

    mocked.useProviderPresets.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          presets: [
            {
              id: "anthropic",
              name: "Anthropic",
              category: "official",
              apiFormat: "anthropic",
              defaultModel: "claude-fable-5-1",
              baseUrl: "https://api.anthropic.com",
              envKey: "ANTHROPIC_API_KEY",
              envModel: null,
              configured: true,
              isOfficial: true,
              isPartner: false,
            },
            {
              id: "deepseek",
              name: "DeepSeek",
              category: "china",
              apiFormat: "openai_chat",
              defaultModel: "deepseek-chat",
              baseUrl: "https://api.deepseek.com",
              envKey: "DEEPSEEK_API_KEY",
              envModel: null,
              configured: false,
              isOfficial: false,
              isPartner: false,
            },
          ],
          total: 2,
        },
      }) as never,
    )
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PresetCatalogBrowser />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId("settings-providers-catalog")).toBeTruthy()
    expect(screen.getAllByText("Anthropic").length).toBeGreaterThan(0)
    // Expand the detail row and see metadata (env var NAME, never a key).
    fireEvent.click(screen.getAllByText("Anthropic")[0])
    expect(screen.getByTestId("providers-detail-anthropic")).toBeTruthy()
    expect(screen.getByText("ANTHROPIC_API_KEY")).toBeTruthy()
    // The category filter narrows the list to the china row only.
    fireEvent.click(within(screen.getByTestId("providers-category-filter")).getByText("China"))
    expect(screen.getByText("DeepSeek")).toBeTruthy()
    expect(screen.queryByText("claude-fable-5-1")).toBeNull()
  })

  it("PresetCatalogBrowser shows the error state with retry", () => {
    mocked.useProviderPresets.mockReturnValue(
      q({ isLoading: false, isError: true, refetch: vi.fn() }) as never,
    )
    renderWithQuery(<PresetCatalogBrowser />)
    expect(screen.getByText("Failed to load")).toBeTruthy()
    expect(screen.getByText("Retry")).toBeTruthy()
  })

  it("ProviderModelTester renders providers, prompt + run, and blocks empty runs", () => {
    const mutate = vi.fn()
    mocked.useProviderPresets.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          presets: [
            {
              id: "anthropic",
              name: "Anthropic",
              category: "official",
              apiFormat: "anthropic",
              defaultModel: "claude-fable-5-1",
              baseUrl: "",
              envKey: "ANTHROPIC_API_KEY",
              envModel: null,
              configured: true,
              isOfficial: true,
              isPartner: false,
            },
          ],
          total: 1,
        },
      }) as never,
    )
    mocked.useProviderTestChat.mockReturnValue({
      isPending: false,
      isIdle: true,
      isError: false,
      error: null,
      data: undefined,
      mutate,
    } as never)
    renderWithQuery(<ProviderModelTester />)
    expect(screen.getByTestId("settings-provider-tester")).toBeTruthy()
    const run = screen.getByText("Run test").closest("button") as HTMLButtonElement
    expect(run.disabled).toBe(true) // no provider selected, no prompt yet
    fireEvent.click(run)
    expect(mutate).not.toHaveBeenCalled()
  })

  it("SubagentsDomain renders role cards and expands memory buckets", () => {
    mocked.useSubagentProfiles.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          profiles: [
            {
              role: "planner",
              currentVersion: "v2",
              avgScore: 7.5,
              totalTasks: 4,
              memory: { userFeedback: [{ content: "be concise" }] },
            },
          ],
        },
      }) as never,
    )
    renderWithQuery(<SubagentsDomain />)
    expect(screen.getByTestId("subagents-list")).toBeTruthy()
    fireEvent.click(screen.getByText("planner"))
    expect(screen.getByTestId("subagents-detail-planner")).toBeTruthy()
    expect(screen.getByText("be concise")).toBeTruthy()
  })

  it("SubagentsDomain shows the empty state", () => {
    mocked.useSubagentProfiles.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: { profiles: [] },
      }) as never,
    )
    renderWithQuery(<SubagentsDomain />)
    expect(screen.getByText("No agent profiles yet")).toBeTruthy()
  })

  it("UsageDomain renders tiles, charts and the windows table", () => {
    mocked.useUsageSummary.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          range: "7d",
          totalRequests: 42,
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          totalCacheReadTokens: 0,
          totalCacheCreationTokens: 0,
          realTotalTokens: 1500,
          totalCostUsd: 1.25,
          totalCostUsdKnown: true,
          successRate: 0.95,
          cacheHitRate: 0.8,
          unpricedRequestCount: 0,
          latency: { p50Ms: 1, p95Ms: 2, p99Ms: 3, avgMs: 1.5, sampleCount: 42 },
          byProvider: [],
        },
      }) as never,
    )
    mocked.useUsageDaily.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          range: "7d",
          daily: [
            { date: "2026-09-01", requestCount: 2, totalTokens: 100, totalCostUsd: 0.5 },
            { date: "2026-09-02", requestCount: 4, totalTokens: 200, totalCostUsd: 0.75 },
          ],
          nextCursor: null,
          total: 2,
        },
      }) as never,
    )
    mocked.useUsageWindows.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          windows: [{ window: "5h", requests: 1, inputTokens: 10, outputTokens: 5, costUsd: null }],
        },
      }) as never,
    )
    renderWithQuery(<UsageDomain />)
    expect(screen.getByTestId("usage-line")).toBeTruthy()
    expect(screen.getByTestId("usage-bars")).toBeTruthy()
    expect(screen.getByTestId("usage-windows-table")).toBeTruthy()
    expect(screen.getByText("5h")).toBeTruthy()
    expect(screen.getByText("Unknown")).toBeTruthy() // unpriced window cost
  })

  it("SessionStoreStatusCard shows counts, or the disabled hint", () => {
    mocked.useSessionStoreStatus.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          available: true,
          schemaVersion: 2,
          path: "/tmp/session-store.sqlite",
          tables: { sessions: 3, messages: 40, events: 0, usage: null, steering_queue: 0 },
        },
      }) as never,
    )
    const { unmount } = renderWithQuery(<SessionStoreStatusCard />)
    expect(screen.getByTestId("store-table-grid")).toBeTruthy()
    expect(screen.getByText("Running")).toBeTruthy()
    expect(screen.getByText("Unknown")).toBeTruthy() // usage count null
    unmount()

    mocked.useSessionStoreStatus.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: { available: false, schemaVersion: null, path: null, tables: {} },
      }) as never,
    )
    renderWithQuery(<SessionStoreStatusCard />)
    expect(screen.getByText("Disabled")).toBeTruthy()
    expect(
      screen.getByText("Set SESSION_STORE_ENABLED=true to enable the session history side store"),
    ).toBeTruthy()
  })
})
