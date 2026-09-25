// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ai-elements second wave — consumption tests for the widgets mounted in
 * this wave's real state surfaces:
 *
 *   - StreamingCursor → ConversationTimeline's tail (live + attached
 *     only; retired while detached, idle, or on an empty stream);
 *   - SkeletonBlock → SessionsPanel's list loading state and the
 *     system-overview section's per-subsystem card loading states;
 *   - QuoteBlock → ReviewPanel's suggestion quotes;
 *   - TokenUsageBadge → ReviewPanel's header, fed by the pure
 *     aggregateResultUsage fold over the workspace's task results.
 *
 * (AlertBanner's target — the header connection banner — lives in
 * src/App.tsx, a shared file this wave does not own, so it is
 * deliberately not covered here.)
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import aiEn from "@/locales/ai-elements.en-US.json"
import aiZh from "@/locales/ai-elements.zh-CN.json"
import conversationEn from "@/locales/conversation.en-US.json"
import settingsDeepEn from "@/locales/settings-deep.en-US.json"
import type { RuntimeEvent, Workspace } from "../src/api"
import { ConversationTimeline } from "../src/components/ConversationTimeline"
import { SessionsPanel } from "../src/components/SessionsPanel"
import { ReviewPanel, aggregateResultUsage } from "../src/components/ReviewPanel"
import { SystemOverviewSection } from "../src/components/settings/system-domain/SystemOverviewSection"

/** Flatten a nested domain dictionary into the dotted keys t() looks up. */
function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  if (obj === null || typeof obj !== "object") return out
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === "object") Object.assign(out, flatten(v, key))
    else out[key] = String(v)
  }
  return out
}

beforeAll(() => {
  // The aiElements strings (skeleton aria, usage badge labels) live in
  // the dashboard domain JSONs — register them over the built-ins so
  // assertions hit real localized text. The timeline and settings-deep
  // subtrees ride along so composed surfaces render without warnings.
  const en = getDictionary("en-US") ?? {}
  registerLocale("en-US", {
    ...en,
    ...flatten(aiEn),
    ...flatten(conversationEn),
    ...flatten(settingsDeepEn),
  })
  const zh = getDictionary("zh-CN") ?? {}
  registerLocale("zh-CN", { ...zh, ...flatten(aiZh) })
  setLocale("en-US")
})

beforeEach(() => {
  cleanup()
})

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

// ── shared builders (conversation.test.tsx pattern) ─────────────────────────

const ev = (over: Record<string, unknown>): RuntimeEvent =>
  ({ type: "unknown", ...over }) as RuntimeEvent

const textEv = (text: string) => ev({ type: "assistant-text", text })

const notes = (n: number): RuntimeEvent[] =>
  Array.from({ length: n }, (_, i) => textEv(`note ${i}`))

const ws = (over: Partial<Workspace> = {}): Workspace => ({
  id: "w1",
  userRequest: "Build the login page",
  status: "completed",
  results: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
})

const resultRow = (over: Record<string, unknown> = {}) => ({
  id: "res-1",
  taskId: "t1",
  agentRole: "backend",
  agentId: "a1",
  output: "done",
  metadata: {},
  createdAt: "2026-01-01T00:01:00.000Z",
  ...over,
})

const reviewBlock = (over: Record<string, unknown> = {}) => ({
  id: "rev-1",
  score: 8,
  issues: [],
  suggestions: [],
  summary: "solid work",
  reviewedAt: "2026-01-01T02:00:00.000Z",
  ...over,
})

// ── StreamingCursor → ConversationTimeline tail ─────────────────────────────

describe("ConversationTimeline streaming cursor", () => {
  it("renders the cursor at the tail while live and attached", () => {
    render(<ConversationTimeline events={notes(2)} workspace={null} live={true} />)
    expect(screen.getByTestId("timeline-streaming-cursor")).toBeTruthy()
  })

  it("renders no cursor when the run is not live", () => {
    render(<ConversationTimeline events={notes(2)} workspace={null} live={false} />)
    expect(screen.queryByTestId("timeline-streaming-cursor")).toBeNull()
  })

  it("renders no cursor on an empty stream, even while live", () => {
    render(<ConversationTimeline events={[]} workspace={null} live={true} />)
    expect(screen.queryByTestId("timeline-streaming-cursor")).toBeNull()
    expect(screen.getByTestId("timeline-empty")).toBeTruthy()
  })

  it("retires the cursor while the reader is detached from the tail", () => {
    render(<ConversationTimeline events={notes(2)} workspace={null} live={true} />)
    const el = screen.getByTestId("conversation-timeline")
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 2000 })
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 500 })
    el.scrollTop = 1000 // 2000 − 1000 − 500 ≥ 48 → detached
    fireEvent.scroll(el)
    expect(screen.queryByTestId("timeline-streaming-cursor")).toBeNull()
    // Scrolling back to the bottom re-attaches — and the cursor returns.
    el.scrollTop = 1500 // 2000 − 1500 − 500 < 48 → attached
    fireEvent.scroll(el)
    expect(screen.getByTestId("timeline-streaming-cursor")).toBeTruthy()
  })
})

// ── SkeletonBlock → SessionsPanel loading ────────────────────────────────────

// ── module mocks (single hoisted block: the "@/api" factory below reads
//    both the session and the system halves) ────────────────────────────────

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  messages: vi.fn(),
  vaultStatus: vi.fn(),
  oracleLessons: vi.fn(),
  useSessionStoreStatus: vi.fn(),
  useMigrationCandidates: vi.fn(),
}))

vi.mock("@/api", () => ({
  sessionsApi: { list: mocks.list, messages: mocks.messages },
  systemApi: { vaultStatus: mocks.vaultStatus, oracleLessons: mocks.oracleLessons },
}))

vi.mock("@/hooks/useSettingsQueries", () => ({
  ORACLE_LESSONS_QUERY_KEY: ["settings", "oracle-lessons"],
  MIGRATIONS_QUERY_KEY: ["settings-deep", "migrations"],
  useSessionStoreStatus: mocks.useSessionStoreStatus,
  useMigrationCandidates: mocks.useMigrationCandidates,
  // The composed oracle editor calls the save hook; it never fires here.
  useSaveOracleLesson: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const q = (props: Record<string, unknown>) => ({ isPending: false, isError: false, ...props })

// ── SkeletonBlock → SessionsPanel loading ────────────────────────────────────

describe("SessionsPanel loading skeleton", () => {
  it("shows three skeleton lines while the session list loads", () => {
    mocks.list.mockReturnValue(new Promise(() => {})) // never settles
    renderWithQuery(<SessionsPanel />)
    const skeleton = screen.getByTestId("sessions-skeleton")
    expect(skeleton.querySelector('[role="status"]')).toBeTruthy()
    // The SkeletonBlock text variant renders one shimmering line per count.
    expect(skeleton.querySelectorAll(".animate-pulse .flex > div")).toHaveLength(3)
    expect(screen.queryByTestId("sessions-list")).toBeNull()
  })

  it("swaps the skeleton for the list once sessions arrive", async () => {
    mocks.list.mockResolvedValue({
      sessions: [{ id: "s1", title: "First run", workspaceId: "w1", updatedAt: null }],
    })
    renderWithQuery(<SessionsPanel />)
    await waitFor(() => expect(screen.getByTestId("sessions-list")).toBeTruthy())
    expect(screen.queryByTestId("sessions-skeleton")).toBeNull()
  })
})

// ── SkeletonBlock → system-overview card loading ─────────────────────────────

describe("SystemOverviewSection card loading skeletons", () => {
  it("replaces each composed card with a rect skeleton while its first load is in flight", () => {
    mocks.vaultStatus.mockReturnValue(new Promise(() => {}))
    mocks.oracleLessons.mockReturnValue(new Promise(() => {}))
    mocks.useSessionStoreStatus.mockReturnValue(q({ isLoading: true }))
    mocks.useMigrationCandidates.mockReturnValue(q({ isLoading: true }))
    renderWithQuery(<SystemOverviewSection />)
    // Every subsystem shows the placeholder; no composed card mounts.
    expect(screen.getByTestId("system-card-skeleton-vault")).toBeTruthy()
    expect(screen.getByTestId("system-card-skeleton-store")).toBeTruthy()
    expect(screen.getByTestId("system-card-skeleton-migrations")).toBeTruthy()
    expect(screen.getByTestId("system-card-skeleton-oracle")).toBeTruthy()
    expect(screen.queryByTestId("settings-vault")).toBeNull()
    // The health row keeps speaking for the same window (unknown).
    expect(screen.getByTestId("system-health-vault").dataset.state).toBe("unknown")
  })

  it("swaps the skeletons back for the composed cards once loaded", async () => {
    mocks.vaultStatus.mockResolvedValue({
      configured: true,
      open: true,
      path: "/v",
      entries: [],
    })
    mocks.oracleLessons.mockResolvedValue({
      configured: true,
      dir: "/lessons",
      lessons: [],
    })
    mocks.useSessionStoreStatus.mockReturnValue(q({ isLoading: false, data: { available: true } }))
    mocks.useMigrationCandidates.mockReturnValue(
      q({ isLoading: false, data: { api: { openapiRoutes: 114 } } }),
    )
    renderWithQuery(<SystemOverviewSection />)
    await waitFor(() => expect(screen.getByTestId("settings-vault")).toBeTruthy())
    expect(screen.getByTestId("settings-session-store")).toBeTruthy()
    expect(screen.getByTestId("settings-migrations")).toBeTruthy()
    expect(screen.getByTestId("settings-oracle")).toBeTruthy()
    expect(screen.queryByTestId("system-card-skeleton-vault")).toBeNull()
  })
})

// ── QuoteBlock + TokenUsageBadge → ReviewPanel ───────────────────────────────

describe("ReviewPanel aggregateResultUsage (model layer)", () => {
  it("returns undefined for absent, empty or usage-less results", () => {
    expect(aggregateResultUsage(undefined)).toBeUndefined()
    expect(aggregateResultUsage([])).toBeUndefined()
    expect(
      aggregateResultUsage([resultRow(), resultRow({ id: "res-2", taskId: "t2" })]),
    ).toBeUndefined()
  })

  it("sums only the results whose usage payload carries a known token field", () => {
    const agg = aggregateResultUsage([
      resultRow({ metadata: { usage: { input: 100, output: 50 } } }),
      resultRow({ id: "res-2", taskId: "t2", metadata: { usage: { totalTokens: 700 } } }),
      resultRow({ id: "res-3", taskId: "t3", metadata: {} }), // no usage → skipped
      resultRow({ id: "res-4", taskId: "t4", output: "garbage only" }), // no known field → skipped
    ])
    expect(agg).toEqual({ input: 100, output: 50, cacheRead: 0, total: 850 })
  })
})

describe("ReviewPanel quote suggestions + usage badge", () => {
  it("renders suggestions as QuoteBlocks inside the quotes container", () => {
    render(
      <ReviewPanel
        workspace={ws({
          review: reviewBlock({ suggestions: ["extract the helper", "add a retry"] }),
        })}
      />,
    )
    const quotes = screen.getByTestId("review-suggestion-quotes")
    expect(quotes.querySelectorAll("blockquote")).toHaveLength(2)
    expect(quotes.textContent).toContain("extract the helper")
    expect(quotes.textContent).toContain("add a retry")
    // No usage anywhere → no header badge (never a fabricated zero).
    expect(screen.queryByTitle("Token usage (input/output/cache)")).toBeNull()
  })

  it("mounts the header TokenUsageBadge from the results' usage aggregate", () => {
    render(
      <ReviewPanel
        workspace={ws({
          review: reviewBlock({ suggestions: ["tidy up"] }),
          results: [resultRow({ metadata: { usage: { input: 1000, output: 250 } } })],
        })}
      />,
    )
    expect(screen.getByTitle("Token usage (input/output/cache)")).toBeTruthy()
    // 1250 tokens formats compactly through the locale-aware formatter.
    expect(screen.getByTitle("Token usage (input/output/cache)").textContent).toContain("1.3K")
  })

  it("keeps the header badge off when no result carries usage", () => {
    render(<ReviewPanel workspace={ws({ review: reviewBlock(), results: [resultRow()] })} />)
    expect(screen.queryByTitle("Token usage (input/output/cache)")).toBeNull()
  })
})
