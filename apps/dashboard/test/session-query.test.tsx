// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the session-query feature domain:
 *   - model.ts pure functions (highlight split / grouping), and
 *   - SessionSearchPanel render smoke across the three UI states
 *     (idle / loading / error / empty / results), mocking the data hook
 *     the UsagePanel way (@tanstack/react-query test mode).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDictionary } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"
import {
  splitHighlight,
  groupSearchResults,
  SessionSearchPanel,
} from "../src/features/session-query/index"
import type { SessionSearchResponse } from "../src/features/session-query/index"

// Register the aggregated dashboard dictionaries exactly like main.tsx so
// the panel's t() calls resolve (setup.ts pins the locale to en-US).
applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})

// Mock the data hook — the panel is the contract under test, not the
// fetch wiring (mirrors test/UsagePanel.test.tsx).
const useSessionSearchMock = vi.fn()

vi.mock("../src/features/session-query/useSessionSearch", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>
  return {
    ...mod,
    useSessionSearch: (...args: unknown[]) => useSessionSearchMock(...args),
  }
})

function makeResponse(
  results: SessionSearchResponse["results"],
): SessionSearchResponse | undefined {
  return { query: "login", results }
}

function mockHook(opts: {
  data?: SessionSearchResponse
  isPending?: boolean
  error?: Error | null
}) {
  useSessionSearchMock.mockReturnValue({
    data: opts.data,
    isPending: opts.isPending ?? false,
    error: opts.error ?? null,
  } as never)
}

function renderPanel(props: { onOpenSession?: (id: string) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SessionSearchPanel {...props} />
    </QueryClientProvider>,
  )
}

/**
 * Render the panel and drive the input past the 300ms debounce, so the
 * non-idle branches (loading / error / empty / results) become visible.
 */
function renderPanelWithQuery(query: string, props: { onOpenSession?: (id: string) => void } = {}) {
  vi.useFakeTimers()
  const utils = renderPanel(props)
  fireEvent.change(screen.getByTestId("session-search-input"), {
    target: { value: query },
  })
  act(() => {
    vi.advanceTimersByTime(300)
  })
  return utils
}

const HIT = {
  sessionId: "sess-1",
  workspaceId: "ws-1",
  role: "user",
  content: "Please FIX the Login bug",
  createdAt: "2026-01-01T00:00:00.000Z",
}

beforeEach(() => {
  useSessionSearchMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("splitHighlight", () => {
  it("splits content into before/match/after around the first match", () => {
    expect(splitHighlight("Please FIX the Login bug", "login")).toEqual({
      before: "Please FIX the ",
      match: "Login",
      after: " bug",
    })
  })

  it("marks truncated context with ellipses and bounds the window", () => {
    const content = "a".repeat(100) + "needle" + "b".repeat(100)
    const out = splitHighlight(content, "needle")
    expect(out).not.toBeNull()
    expect(out?.before.startsWith("…")).toBe(true)
    expect(out?.after.endsWith("…")).toBe(true)
    expect(out?.match).toBe("needle")
    // 60 chars of context each side (+ the leading/trailing "…").
    expect(out?.before.length).toBe(61)
    expect(out?.after.length).toBe(61)
  })

  it("returns null for misses and unusable input (defensive)", () => {
    expect(splitHighlight("hello", "world")).toBeNull()
    expect(splitHighlight("hello", "")).toBeNull()
    expect(splitHighlight("hello", "   ")).toBeNull()
    expect(splitHighlight(undefined, "x")).toBeNull()
    expect(splitHighlight("hello", 42)).toBeNull()
    expect(splitHighlight(null, null)).toBeNull()
  })
})

describe("groupSearchResults", () => {
  const hits = [
    { ...HIT },
    { ...HIT, sessionId: "sess-2", role: "assistant", content: "login fixed in auth.ts" },
    { sessionId: "sess-1", role: "user", content: "second login mention" },
  ]

  it("groups hits by session preserving input order and counts hits", () => {
    const view = groupSearchResults(hits, "login")
    expect(view.groups.map((g) => g.sessionId)).toEqual(["sess-1", "sess-2"])
    expect(view.groups[0]?.hits).toHaveLength(2)
    expect(view.groups[1]?.hits).toHaveLength(1)
    expect(view.hitCount).toBe(3)
    // Hits inside a group stay in input (newest-first) order.
    expect(view.groups[0]?.hits[0]?.highlight.match.toLowerCase()).toBe("login")
  })

  it("caps sections and hits per section", () => {
    const many = [
      ...hits,
      { sessionId: "sess-3", role: "user", content: "login again" },
      { sessionId: "sess-1", role: "user", content: "third login mention" },
    ]
    const view = groupSearchResults(many, "login", { maxGroups: 2, maxHitsPerGroup: 2 })
    expect(view.groups).toHaveLength(2)
    expect(view.groups[0]?.hits).toHaveLength(2)
    expect(view.groups[1]?.hits).toHaveLength(1)
    expect(view.hitCount).toBe(3)
  })

  it("drops malformed rows and defaults missing roles", () => {
    const messy = [
      null,
      42,
      { role: "user", content: "no sessionId here" },
      { sessionId: "sess-9", content: "orphan login", workspaceId: 7, createdAt: 0 },
    ]
    const view = groupSearchResults(messy, "login")
    expect(view.groups).toHaveLength(1)
    expect(view.groups[0]?.sessionId).toBe("sess-9")
    expect(view.groups[0]?.workspaceId).toBeNull()
    expect(view.groups[0]?.hits[0]?.role).toBe("message")
    expect(view.groups[0]?.hits[0]?.createdAt).toBeNull()
  })
})

describe("SessionSearchPanel", () => {
  it("shows the idle hint and does not fire the search for an empty query", () => {
    mockHook({})
    renderPanel()
    expect(screen.getByTestId("session-search-idle")).toHaveTextContent(/type to search/i)
    expect(useSessionSearchMock).toHaveBeenCalledWith("", undefined)
    expect(screen.queryByTestId("session-search-groups")).not.toBeInTheDocument()
  })

  it("debounces input by 300ms before re-querying", () => {
    vi.useFakeTimers()
    mockHook({})
    renderPanel()
    fireEvent.change(screen.getByTestId("session-search-input"), {
      target: { value: "needle" },
    })
    // Not yet — the keystroke must not fire immediately.
    expect(useSessionSearchMock).toHaveBeenLastCalledWith("", undefined)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(useSessionSearchMock).toHaveBeenLastCalledWith("needle", undefined)
  })

  it("renders grouped results with role badge, bold match, and open button", () => {
    mockHook({ data: makeResponse([HIT]) })
    const onOpenSession = vi.fn()
    const { container } = renderPanelWithQuery("login", { onOpenSession })

    expect(useSessionSearchMock).toHaveBeenLastCalledWith("login", undefined)
    expect(screen.getByTestId("session-search-groups")).toBeInTheDocument()
    expect(screen.getByText("sess-1")).toBeInTheDocument()
    expect(screen.getByText("user")).toBeInTheDocument()
    // The match segment is the bolded "Login" (original casing).
    expect(container.querySelector("strong")?.textContent).toBe("Login")
    expect(screen.getByTestId("session-search-snippet")).toHaveTextContent(
      "Please FIX the Login bug",
    )

    fireEvent.click(screen.getByRole("button", { name: "Open in session" }))
    expect(onOpenSession).toHaveBeenCalledWith("sess-1")
  })

  it("shows the loading state", () => {
    mockHook({ isPending: true })
    renderPanelWithQuery("login")
    expect(screen.getByTestId("session-search-loading")).toHaveTextContent(/searching/i)
  })

  it("shows the error state with the failure message", () => {
    mockHook({ error: new Error("503 Service Unavailable") })
    renderPanelWithQuery("login")
    expect(screen.getByTestId("session-search-error")).toHaveTextContent(/search failed/i)
    expect(screen.getByTestId("session-search-error")).toHaveTextContent("503")
  })

  it("shows the empty state when the query matched nothing", () => {
    mockHook({ data: makeResponse([]) })
    renderPanelWithQuery("login")
    expect(screen.getByTestId("session-search-empty")).toHaveTextContent(/no messages matched/i)
  })
})
