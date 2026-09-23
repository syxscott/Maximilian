// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the model-picker feature domain: model-layer unit tests
 * (defensive normalization, category/search filtering, the 24-card grid
 * window, base-domain URL matching) plus render smoke for each of the
 * three surfaces with the data hooks mocked (settings-deep.test.tsx
 * pattern — React Query + real fetch interacts in fragile ways under
 * jsdom; the contract under test is the model layer and the UI's three
 * states).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import modelPickerEn from "../src/locales/model-picker.en-US.json"
import {
  baseUrlHost,
  configurableProviders,
  durationTone,
  filterPresetCards,
  presetCategories,
  sameDomainPresets,
  toPresetCardViews,
  toProviderOptions,
  toSetModelResult,
  toTestChatCardView,
  windowCards,
  PRESET_GRID_MAX,
} from "../src/features/model-picker/model"
import { PresetGrid } from "../src/features/model-picker/PresetGrid"
import { ProviderModelSelect } from "../src/features/model-picker/ProviderModelSelect"
import { ModelTestPanel } from "../src/features/model-picker/ModelTestPanel"

beforeAll(() => {
  const existing = getDictionary("en-US") ?? {}
  registerLocale("en-US", { ...existing, ...(modelPickerEn as Record<string, string>) })
  setLocale("en-US")
})

vi.mock("@/hooks/useSettingsQueries", () => ({
  useProviderPresets: vi.fn(),
  useProviderTestChat: vi.fn(),
}))

vi.mock("@/api", () => ({
  chatApi: {
    listProviders: vi.fn(),
    setProviderModel: vi.fn(),
    getWorkspace: vi.fn(),
  },
}))

import * as hooks from "@/hooks/useSettingsQueries"
import { chatApi } from "@/api"

const mockedHooks = vi.mocked(hooks)
const mockedChat = vi.mocked(chatApi)

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

function presetCard(overrides: Record<string, unknown>) {
  return {
    id: "p",
    name: "P",
    category: "custom",
    apiFormat: "openai_chat",
    defaultModel: "m-1",
    baseUrl: "https://api.example.com",
    envKey: "P_API_KEY",
    envModel: null,
    configured: false,
    isOfficial: false,
    isPartner: false,
    ...overrides,
  }
}

const PRESETS_PAYLOAD = {
  presets: [
    presetCard({
      id: "anthropic",
      name: "Anthropic",
      category: "official",
      defaultModel: "claude-fable-5-1",
      baseUrl: "https://api.anthropic.com",
      configured: true,
      isOfficial: true,
    }),
    presetCard({
      id: "deepseek",
      name: "DeepSeek",
      category: "china",
      defaultModel: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
    }),
  ],
  total: 2,
}

// ── Model layer ─────────────────────────────────────────────────────────────

describe("model-picker model", () => {
  const views = toPresetCardViews(PRESETS_PAYLOAD)

  it("normalizes passthrough JSON into typed card views", () => {
    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({
      id: "anthropic",
      category: "official",
      configured: true,
      defaultModel: "claude-fable-5-1",
    })
    expect(views[1].isOfficial).toBe(false)
  })

  it("defends against garbage payloads", () => {
    expect(toPresetCardViews(null)).toEqual([])
    expect(toPresetCardViews(undefined)).toEqual([])
    expect(toPresetCardViews("nope")).toEqual([])
    expect(toPresetCardViews({ presets: "not-an-array" })).toEqual([])
    expect(toPresetCardViews({ presets: [null, 42, {}, { name: "no id" }] })).toEqual([])
  })

  it("orders categories canonically and appends unknown ones sorted", () => {
    const mixed = toPresetCardViews({
      presets: [
        presetCard({ id: "a", category: "zzz" }),
        presetCard({ id: "b", category: "official" }),
        presetCard({ id: "c", category: "aaa" }),
        presetCard({ id: "d", category: "china" }),
      ],
      total: 4,
    })
    expect(presetCategories(mixed)).toEqual(["official", "china", "aaa", "zzz"])
  })

  it("filters by category and case-insensitive query", () => {
    expect(filterPresetCards(views, "official", "")).toHaveLength(1)
    expect(filterPresetCards(views, "all", "DEEPSEEK")).toHaveLength(1)
    expect(filterPresetCards(views, "all", "fable")).toHaveLength(1)
    expect(filterPresetCards(views, "china", "anthropic")).toHaveLength(0)
  })

  it("caps the grid at 24 cards and reports the folded remainder", () => {
    expect(PRESET_GRID_MAX).toBe(24)
    const many = Array.from({ length: 30 }, (_, i) => presetCard({ id: `p${i}`, name: `P${i}` }))
    const page = windowCards(toPresetCardViews({ presets: many, total: 30 }))
    expect(page.shown).toBe(24)
    expect(page.total).toBe(30)
    expect(page.hidden).toBe(6)
    expect(windowCards([], 24).hidden).toBe(0)
  })

  it("parses base URL hosts defensively", () => {
    expect(baseUrlHost("https://api.deepseek.com/v1")).toBe("api.deepseek.com")
    expect(baseUrlHost("http://API.Example.COM:8080")).toBe("api.example.com")
    // Scheme-less hosts still parse (the common preset spelling).
    expect(baseUrlHost("api.deepseek.com")).toBe("api.deepseek.com")
    expect(baseUrlHost("  api.deepseek.com  ")).toBe("api.deepseek.com")
    expect(baseUrlHost("")).toBeNull()
    expect(baseUrlHost("not a url ://")).toBeNull()
    expect(baseUrlHost(42)).toBeNull()
    expect(baseUrlHost(null)).toBeNull()
    expect(baseUrlHost(undefined)).toBeNull()
  })

  it("matches presets only within the provider's own base domain", () => {
    const catalog = toPresetCardViews({
      presets: [
        presetCard({ id: "deepseek", baseUrl: "https://api.deepseek.com" }),
        presetCard({ id: "deepseek-alt", baseUrl: "api.deepseek.com/v2" }),
        presetCard({ id: "openai", baseUrl: "https://api.openai.com" }),
        presetCard({ id: "broken", baseUrl: "not a url ://" }),
      ],
      total: 4,
    })
    const same = sameDomainPresets("deepseek", catalog)
    expect(same.map((p) => p.id)).toEqual(["deepseek", "deepseek-alt"])
    // No self preset → no defensible domain → empty, not "everything".
    expect(sameDomainPresets("openai", catalog).map((p) => p.id)).toEqual(["openai"])
    expect(sameDomainPresets("unknown", catalog)).toEqual([])
    expect(sameDomainPresets("", catalog)).toEqual([])
  })

  it("normalizes provider options and keeps only configurable ones", () => {
    const options = toProviderOptions({
      providers: [
        { id: "deepseek", name: "DeepSeek", defaultModel: "deepseek-chat", configured: true },
        { id: "ghost", name: "Ghost", defaultModel: "", configured: false },
        null,
        { noId: true },
      ],
      default: "deepseek",
    })
    expect(options).toHaveLength(2)
    expect(configurableProviders(options).map((p) => p.id)).toEqual(["deepseek"])
    expect(toProviderOptions(null)).toEqual([])
    expect(toProviderOptions({ providers: 7 })).toEqual([])
  })

  it("normalizes the set-model and test-chat responses defensively", () => {
    expect(
      toSetModelResult({ ok: true, providerId: "deepseek", model: "deepseek-reasoner" }),
    ).toEqual({
      ok: true,
      providerId: "deepseek",
      model: "deepseek-reasoner",
    })
    expect(toSetModelResult({ ok: "yes" })).toEqual({ ok: false, providerId: "", model: "" })
    expect(toSetModelResult(null)).toBeNull()

    const test = toTestChatCardView({
      ok: true,
      providerId: "deepseek",
      model: "deepseek-chat",
      content: "pong",
      durationMs: 812,
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
    })
    expect(test).toMatchObject({ ok: true, content: "pong", durationMs: 812 })
    expect(test?.usage).toEqual({ promptTokens: 5, completionTokens: 7, totalTokens: 12 })
    expect(toTestChatCardView(null)).toBeNull()
    expect(toTestChatCardView({})?.durationMs).toBeNull()
  })

  it("buckets probe duration into badge tones", () => {
    expect(durationTone(1999)).toBe("fast")
    expect(durationTone(2000)).toBe("slow")
    expect(durationTone(null)).toBe("unknown")
  })
})

// ── Render smoke ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks()
})

describe("model-picker render smoke", () => {
  it("PresetGrid shows loading, then the card grid with filters and the 24 cap", () => {
    mockedHooks.useProviderPresets.mockReturnValue(
      q({ isLoading: true, isError: false, refetch: vi.fn() }) as never,
    )
    const { rerender } = renderWithQuery(<PresetGrid />)
    expect(screen.getByText("Loading…")).toBeTruthy()

    const many = Array.from({ length: 26 }, (_, i) =>
      presetCard({
        id: i === 25 ? "deepseek" : `p${i}`,
        name: i === 25 ? "DeepSeek" : `P${i}`,
        category: i === 25 ? "china" : "custom",
      }),
    )
    mockedHooks.useProviderPresets.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: { presets: many, total: many.length },
      }) as never,
    )
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PresetGrid />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId("model-picker-cards").children).toHaveLength(24)
    expect(screen.getByTestId("model-picker-more")).toBeTruthy()
    // Category filter narrows to the single china card.
    fireEvent.click(within(screen.getByTestId("model-picker-category-filter")).getByText("China"))
    expect(screen.getByTestId("preset-card-deepseek")).toBeTruthy()
    expect(screen.getByTestId("model-picker-cards").children).toHaveLength(1)
    // Search filters by name.
    fireEvent.click(
      within(screen.getByTestId("model-picker-category-filter")).getByText("All categories"),
    )
    const search = screen.getByLabelText("Search by name / id / default model…")
    fireEvent.change(search, { target: { value: "deepseek" } })
    expect(screen.getByTestId("model-picker-cards").children).toHaveLength(1)
    fireEvent.change(search, { target: { value: "zzz-no-match" } })
    expect(screen.getByText("No matching model presets")).toBeTruthy()
  })

  it("PresetGrid shows the error state with retry", () => {
    mockedHooks.useProviderPresets.mockReturnValue(
      q({ isLoading: false, isError: true, refetch: vi.fn() }) as never,
    )
    renderWithQuery(<PresetGrid />)
    expect(screen.getByTestId("model-picker-grid-error")).toBeTruthy()
    expect(screen.getByText("Retry")).toBeTruthy()
  })

  it("ProviderModelSelect applies a same-domain model and reports success", async () => {
    mockedChat.listProviders.mockResolvedValue({
      providers: [
        { id: "deepseek", name: "DeepSeek", defaultModel: "deepseek-chat", configured: true },
        { id: "ghost", name: "Ghost", defaultModel: "g", configured: false },
      ],
    } as never)
    mockedChat.setProviderModel.mockResolvedValue({
      ok: true,
      providerId: "deepseek",
      model: "deepseek-reasoner",
    } as never)
    mockedHooks.useProviderPresets.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          presets: [
            presetCard({
              id: "deepseek",
              name: "DeepSeek",
              defaultModel: "deepseek-chat",
              baseUrl: "https://api.deepseek.com",
              configured: true,
            }),
            presetCard({
              id: "deepseek-reasoner",
              name: "DeepSeek Reasoner",
              defaultModel: "deepseek-reasoner",
              baseUrl: "api.deepseek.com",
              configured: true,
            }),
            presetCard({
              id: "openai",
              name: "OpenAI",
              defaultModel: "gpt-6",
              baseUrl: "https://api.openai.com",
              configured: true,
            }),
          ],
          total: 3,
        },
      }) as never,
    )
    renderWithQuery(<ProviderModelSelect />)
    // Unconfigured providers are not offered.
    const providerSelect = await screen.findByTestId("model-picker-provider-select")
    expect(within(providerSelect).queryByText("Ghost")).toBeNull()

    fireEvent.change(providerSelect, { target: { value: "deepseek" } })
    expect(screen.getByTestId("model-picker-current").textContent).toContain("deepseek-chat")
    // Only same-base-domain models are candidates; gpt-6 is excluded.
    const modelSelect = screen.getByTestId("model-picker-model-select")
    expect(modelSelect.textContent).toContain("deepseek-reasoner")
    expect(modelSelect.textContent).not.toContain("gpt-6")

    fireEvent.change(modelSelect, { target: { value: "deepseek-reasoner" } })
    fireEvent.click(screen.getByText("Set as default"))
    await waitFor(() => {
      expect(mockedChat.setProviderModel).toHaveBeenCalledWith("deepseek", "deepseek-reasoner")
    })
    await waitFor(() => {
      expect(screen.getByText("Default updated")).toBeTruthy()
    })
  })

  it("ProviderModelSelect surfaces the failure hint when the route errors", async () => {
    mockedChat.listProviders.mockResolvedValue({
      providers: [
        { id: "deepseek", name: "DeepSeek", defaultModel: "deepseek-chat", configured: true },
      ],
    } as never)
    mockedChat.setProviderModel.mockRejectedValue(new Error("invalid model") as never)
    mockedHooks.useProviderPresets.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: { presets: [presetCard({ id: "deepseek", configured: true })], total: 1 },
      }) as never,
    )
    renderWithQuery(<ProviderModelSelect />)
    fireEvent.change(await screen.findByTestId("model-picker-provider-select"), {
      target: { value: "deepseek" },
    })
    const apply = screen.getByText("Set as default").closest("button") as HTMLButtonElement
    expect(apply.disabled).toBe(true) // no model picked yet
    fireEvent.change(screen.getByTestId("model-picker-model-select"), {
      target: { value: "m-1" },
    })
    fireEvent.click(apply)
    await waitFor(() => {
      expect(screen.getByTestId("model-picker-apply-error")).toBeTruthy()
    })
    expect(screen.getByText("invalid model")).toBeTruthy()
  })

  it("ModelTestPanel runs the probe and renders the duration badge and content", async () => {
    const mutate = vi.fn()
    mockedHooks.useProviderPresets.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: {
          presets: [
            presetCard({ id: "deepseek", name: "DeepSeek", configured: true }),
            presetCard({ id: "ghost", name: "Ghost", configured: false }),
          ],
          total: 2,
        },
      }) as never,
    )
    mockedHooks.useProviderTestChat.mockReturnValue({
      isPending: false,
      isIdle: true,
      isError: false,
      error: null,
      data: undefined,
      mutate,
    } as never)
    const { rerender } = renderWithQuery(<ModelTestPanel />)
    // Unconfigured presets are not offered as probe targets.
    const providerSelect = screen.getByLabelText("Pick a provider…")
    expect(within(providerSelect).queryByText("Ghost")).toBeNull()

    const run = screen.getByText("Run test").closest("button") as HTMLButtonElement
    expect(run.disabled).toBe(true)
    fireEvent.change(providerSelect, { target: { value: "deepseek" } })
    expect(run.disabled).toBe(true) // prompt still empty
    fireEvent.change(screen.getByLabelText("Type the probe prompt…"), {
      target: { value: "ping" },
    })
    expect(run.disabled).toBe(false)
    fireEvent.click(run)
    expect(mutate).toHaveBeenCalledWith({ providerId: "deepseek", prompt: "ping" })

    mockedHooks.useProviderTestChat.mockReturnValue({
      isPending: false,
      isIdle: false,
      isError: false,
      error: null,
      data: {
        ok: true,
        providerId: "deepseek",
        model: "deepseek-chat",
        content: "pong",
        durationMs: 812,
        usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
      },
      mutate,
    } as never)
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ModelTestPanel />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId("model-picker-test-result")).toBeTruthy()
    expect(screen.getByText("pong")).toBeTruthy()
    expect(screen.getByText("812ms")).toBeTruthy()
    expect(screen.getByText("tokens: 5 in / 7 out")).toBeTruthy()
  })

  it("ModelTestPanel shows the probe failure state", () => {
    mockedHooks.useProviderPresets.mockReturnValue(
      q({
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: { presets: [presetCard({ id: "deepseek", configured: true })], total: 1 },
      }) as never,
    )
    mockedHooks.useProviderTestChat.mockReturnValue({
      isPending: false,
      isIdle: false,
      isError: true,
      error: new Error("provider call failed"),
      data: undefined,
      mutate: vi.fn(),
    } as never)
    renderWithQuery(<ModelTestPanel />)
    expect(screen.getByTestId("model-picker-test-error")).toBeTruthy()
    expect(screen.getByText("provider call failed")).toBeTruthy()
  })
})
