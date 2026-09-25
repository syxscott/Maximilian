/**
 * Unit tests for the Agents panel's pure model layer (agents-model.ts) plus
 * the evolution client wiring in `src/api.ts` and an import smoke check for
 * the component module. All inputs are passthrough JSON — the tests pin the
 * defensive behavior for garbage too.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The component smoke import needs ink mocked: its react-reconciler cannot
// boot under vitest's node environment (same approach as panels-smoke.test).
vi.mock("ink", () => ({
  Box: () => null,
  Text: () => null,
  useInput: () => undefined,
  useStdout: () => ({ write: () => {} }),
}))
vi.mock("ink-spinner", () => ({ default: () => null }))

import type { AgentProfilePayload, LeaderboardEntryPayload } from "../src/api"
import { createMaximilianClient } from "../src/api"
import {
  agentDetail,
  buildAgentRows,
  leaderboardByRole,
  scoreGrade,
  versionTimeline,
} from "../src/components/agents-model"

function makeProfile(overrides: Partial<AgentProfilePayload> = {}): AgentProfilePayload {
  return {
    id: "backend",
    role: "backend",
    createdAt: "2026-09-01T00:00:00.000Z",
    totalTasks: 12,
    avgScore: 7.5,
    successRate: 0.9,
    avgExecutionTime: 4200,
    preferredModel: "anthropic:claude-sonnet-4",
    strengths: [],
    weaknesses: [],
    memory: {
      userFeedback: [{ mime: "text/plain", content: "keep summaries short" }],
      reviewSuggestions: [],
      commonErrors: ["forgot lockfile", "stale cache"],
      goodExamples: [{ mime: "text/plain", content: "clean migration" }],
      totalEntries: 4,
    },
    currentVersion: "v2",
    versions: ["v1", "v2"],
    ...overrides,
  }
}

function makeEntry(overrides: Partial<LeaderboardEntryPayload> = {}): LeaderboardEntryPayload {
  return {
    agentRole: "backend",
    provider: "anthropic",
    model: "claude-sonnet-4",
    avgScore: 7.5,
    avgExecutionTime: 4200,
    avgCostUSD: 0.02,
    userSatisfaction: 0.9,
    sampleSize: 12,
    lastUpdated: "2026-09-25T00:00:00.000Z",
    versionHistory: [
      {
        fromVersion: "v1",
        toVersion: "v2",
        outcome: "promoted",
        oldAvgScore: 6.2,
        newAvgScore: 7.5,
        triggeredAt: "2026-09-20T08:00:00.000Z",
        reason: "score improved",
      },
      {
        fromVersion: "v2",
        toVersion: "v3-candidate",
        outcome: "discarded",
        oldAvgScore: 7.5,
        newAvgScore: 6.9,
        triggeredAt: "2026-09-22T08:00:00.000Z",
        reason: "regression",
      },
    ],
    ...overrides,
  }
}

describe("scoreGrade (rating dot mapping)", () => {
  it("maps the review scale to grade + color bands", () => {
    expect(scoreGrade(9.1, 5)).toEqual({ grade: "elite", color: "green" })
    expect(scoreGrade(8, 5)).toEqual({ grade: "elite", color: "green" })
    expect(scoreGrade(6.4, 5)).toEqual({ grade: "strong", color: "cyan" })
    expect(scoreGrade(4.2, 5)).toEqual({ grade: "steady", color: "yellow" })
    expect(scoreGrade(1.3, 5)).toEqual({ grade: "weak", color: "red" })
  })

  it("is unrated/gray for garbage, out-of-range and no-evidence scores", () => {
    expect(scoreGrade(undefined, 5)).toEqual({ grade: "unrated", color: "gray" })
    expect(scoreGrade(Number.NaN, 5)).toEqual({ grade: "unrated", color: "gray" })
    expect(scoreGrade(12, 5)).toEqual({ grade: "unrated", color: "gray" })
    // Schema default: avgScore 0 with zero tasks means "no data", not "bad".
    expect(scoreGrade(0, 0)).toEqual({ grade: "unrated", color: "gray" })
    // ...but 0 with actual tasks is a real bad score.
    expect(scoreGrade(0, 9)).toEqual({ grade: "weak", color: "red" })
  })
})

describe("buildAgentRows (one row per role, avgScore desc)", () => {
  it("sorts by avgScore desc and merges the leaderboard's headline model", () => {
    const rows = buildAgentRows(
      [
        makeProfile({ role: "backend", avgScore: 7.5, totalTasks: 12 }),
        makeProfile({
          role: "review",
          avgScore: 8.8,
          totalTasks: 4,
          preferredModel: undefined,
          currentVersion: "v3",
        }),
      ],
      [
        makeEntry({ agentRole: "review", model: "gpt-5", provider: "openai", sampleSize: 9 }),
        makeEntry(),
      ],
    )
    expect(rows.map((r) => r.role)).toEqual(["review", "backend"])
    expect(rows[0]).toMatchObject({
      role: "review",
      currentVersion: "v3",
      avgScore: 8.8,
      color: "green",
      model: "openai:gpt-5", // preferredModel absent → leaderboard headline
      hasLeaderboard: true,
    })
    expect(rows[1]!.model).toBe("anthropic:claude-sonnet-4") // preferredModel wins
  })

  it("breaks score ties by task count, then role name", () => {
    const rows = buildAgentRows(
      [
        makeProfile({ role: "general", avgScore: 7, totalTasks: 3 }),
        makeProfile({ role: "frontend", avgScore: 7, totalTasks: 9 }),
        makeProfile({ role: "backend", avgScore: 7, totalTasks: 9 }),
      ],
      [],
    )
    expect(rows.map((r) => r.role)).toEqual(["backend", "frontend", "general"])
  })

  it("drops garbage profiles/entries and survives non-array input entirely", () => {
    expect(buildAgentRows([null, "junk", { role: "" }, makeProfile()], makeEntry())).toEqual([
      expect.objectContaining({ role: "backend" }),
    ])
    expect(buildAgentRows(undefined, undefined)).toEqual([])
    // Leaderboard fallback: currentVersion derives from the last listed version.
    expect(
      buildAgentRows([makeProfile({ currentVersion: undefined })], undefined)[0]!.currentVersion,
    ).toBe("v2")
  })
})

describe("leaderboardByRole (headline entry per role)", () => {
  it("keeps the entry with the largest sampleSize", () => {
    const byRole = leaderboardByRole([
      makeEntry({ provider: "openai", model: "gpt-5", sampleSize: 3 }),
      makeEntry({ provider: "anthropic", sampleSize: 30 }),
      makeEntry({ agentRole: "review", sampleSize: 1 }),
    ])
    expect(byRole.get("backend")!.provider).toBe("anthropic")
    expect(byRole.size).toBe(2)
  })

  it("ignores garbage entries and non-array input", () => {
    expect(leaderboardByRole([null, 42, { noRole: true }]).size).toBe(0)
    expect(leaderboardByRole("junk").size).toBe(0)
  })
})

describe("agentDetail (memory buckets + review scores + promotions)", () => {
  it("counts memory buckets defensively and prefers the declared total", () => {
    const detail = agentDetail(makeProfile(), makeEntry())
    expect(detail.buckets.map((b) => b.count)).toEqual([1, 0, 2, 1])
    expect(detail.buckets[0]!.labelKey).toBe("tui.agents.bucket.userFeedback")
    expect(detail.totalEntries).toBe(4)
    // Legacy string[] buckets count exactly like MemoryEntry[] buckets.
    const legacy = agentDetail(
      makeProfile({
        memory: { userFeedback: ["legacy string"], totalEntries: undefined },
      }),
      null,
    )
    expect(legacy.buckets.map((b) => b.count)).toEqual([1, 0, 0, 0])
    expect(legacy.totalEntries).toBe(1) // falls back to the counted sum
  })

  it("lists recent review scores newest-first, capped at 3", () => {
    const entry = makeEntry({
      versionHistory: [
        {
          fromVersion: "v1",
          toVersion: "v2",
          outcome: "promoted",
          oldAvgScore: 5,
          newAvgScore: 6,
          triggeredAt: "2026-09-01T00:00:00.000Z",
          reason: "a",
        },
        {
          fromVersion: "v2",
          toVersion: "v3",
          outcome: "promoted",
          oldAvgScore: 6,
          newAvgScore: 7,
          triggeredAt: "2026-09-02T00:00:00.000Z",
          reason: "b",
        },
        {
          fromVersion: "v3",
          toVersion: "v4",
          outcome: "discarded",
          oldAvgScore: 7,
          newAvgScore: 6.5,
          triggeredAt: "2026-09-03T00:00:00.000Z",
          reason: "c",
        },
        {
          fromVersion: "v4",
          toVersion: "v5",
          outcome: "promoted",
          oldAvgScore: 7,
          newAvgScore: 8,
          triggeredAt: "2026-09-04T00:00:00.000Z",
          reason: "d",
        },
      ],
    })
    const detail = agentDetail(makeProfile(), entry)
    expect(detail.recentScores.map((s) => [s.version, s.score])).toEqual([
      ["v5", 8],
      ["v4", 6.5],
      ["v3", 7],
    ])
    expect(detail.promotions).toHaveLength(4)
    expect(detail.promotions[0]).toMatchObject({
      fromVersion: "v4",
      toVersion: "v5",
      outcome: "promoted",
    })
  })

  it("degrades per-field on garbage decisions and empty profiles", () => {
    const timeline = versionTimeline(
      makeEntry({
        versionHistory: [
          { garbage: true },
          {
            fromVersion: "v1",
            toVersion: "v2",
            outcome: "promoted",
            oldAvgScore: 5,
            newAvgScore: 6,
            triggeredAt: "2026-09-01T00:00:00.000Z",
            reason: "ok",
          },
        ] as unknown as LeaderboardEntryPayload["versionHistory"],
      }),
    )
    expect(timeline).toEqual([
      expect.objectContaining({ fromVersion: "v1", toVersion: "v2", at: expect.any(String) }),
      expect.objectContaining({ fromVersion: "?", toVersion: "?", at: null }),
    ])
    const empty = agentDetail(null, null)
    expect(empty.buckets.every((b) => b.count === 0)).toBe(true)
    expect(empty.currentVersion).toBe("v1")
    expect(empty.recentScores).toEqual([])
  })
})

// ── Client wiring (api.ts evolution endpoints) ──────────────────────────────

function makeResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "OK",
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response
}

describe("evolution client functions", () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it("lists agent profiles via GET /api/evolution/agents with the bearer header", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(makeResponse({ count: 1, profiles: [], total: 1 })),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createMaximilianClient("http://localhost:3001", "tok")
    const result = await client.listEvolutionAgents()

    const call = fetchMock.mock.calls[0]!
    expect(call[0]).toBe("http://localhost:3001/api/evolution/agents?limit=100")
    expect((call[1] as RequestInit).method).toBe("GET")
    expect(((call[1] as RequestInit).headers as Record<string, string>)["authorization"]).toBe(
      "Bearer tok",
    )
    expect(result).toEqual({ count: 1, profiles: [], total: 1 })
  })

  it("fetches the leaderboard via GET /api/evolution/leaderboard", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        makeResponse({ entries: [makeEntry()], lastRebuilt: "2026-09-25T00:00:00Z" }),
      ),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createMaximilianClient("http://localhost:3001")
    const result = await client.getEvolutionLeaderboard()

    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:3001/api/evolution/leaderboard")
    expect(result.entries).toHaveLength(1)
  })

  it("exposes the full client surface including the new domains", () => {
    const client = createMaximilianClient("http://localhost:3001")
    expect(typeof client.createJob).toBe("function")
    expect(typeof client.listEvolutionAgents).toBe("function")
    expect(typeof client.getEvolutionLeaderboard).toBe("function")
  })

  it("imports the AgentsPanel component and merges its locale strings", async () => {
    vi.resetModules()
    const { AgentsPanel } = await import("../src/components/agents-panel")
    expect(typeof AgentsPanel).toBe("function")
    // The panel module merges the tui-panels subtree over the core
    // dictionaries at import time — both languages, both domains.
    const { getDictionary } = await import("@max/i18n")
    for (const locale of ["zh-CN", "en-US"]) {
      const dict = getDictionary(locale) as Record<string, string> | undefined
      expect(dict?.["tui.agents"]).toBeTruthy()
      expect(dict?.["tui.agents.detail.recentScores"]).toBeTruthy()
      expect(dict?.["tui.cron"]).toBeTruthy()
    }
  })
})
