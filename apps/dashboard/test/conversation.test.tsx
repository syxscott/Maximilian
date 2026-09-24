// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Conversation turn-unit pipeline tests: the pairing algorithm (FIFO
 * per taskId+tool, running tails, ignored orphans), retry-wave folding,
 * the unit-stream compiler, turn depths, the find index, markdown
 * export — plus render smokes for TurnGroup / RetryWaveGroup /
 * ConversationUnitsPreview.
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"

import {
  buildConversationFindIndex,
  buildTurnFlowItems,
  estimateTurnDepth,
  formatDuration,
  groupRetryWaves,
  groupUnitsByTurn,
  pairToolCalls,
  toConversationMarkdown,
  type ConversationUnit,
  type RetryUnit,
} from "../src/components/conversation/model"
import { TurnGroup } from "../src/components/conversation/TurnGroup"
import { RetryWaveGroup } from "../src/components/conversation/RetryWaveGroup"
import { ConversationUnitsPreview } from "../src/components/conversation/ConversationUnitsPreview"
import type { RuntimeEvent, Workspace } from "../src/api"

// Register the aggregated dashboard dictionaries exactly like main.tsx so
// t() resolves the conversation.* keys (setup.ts pins the locale to en-US).
applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

afterEach(() => {
  cleanup()
  setLocale("en-US")
})

// ── Fixtures ────────────────────────────────────────────────────────────────

const ev = (over: Record<string, unknown>): RuntimeEvent =>
  ({ type: "unknown", ...over }) as RuntimeEvent

const taskStart = (taskId: string, agentRole = "backend", ts?: number): RuntimeEvent =>
  ev({ type: "task-start", taskId, agentRole, ...(ts !== undefined ? { ts } : {}) })

const toolStart = (taskId: string, toolName: string, input?: unknown, ts?: number): RuntimeEvent =>
  ev({ type: "tool-start", taskId, toolName, input, ...(ts !== undefined ? { ts } : {}) })

const toolEnd = (
  taskId: string,
  toolName: string,
  extra: Record<string, unknown> = {},
): RuntimeEvent => ev({ type: "tool-end", taskId, toolName, ok: true, durationMs: 10, ...extra })

const retryEv = (
  phase: string,
  attempt: number,
  delayMs: number,
  extra: Record<string, unknown> = {},
): RuntimeEvent =>
  ev({
    type: "llm-retry-status",
    phase,
    attempt,
    maxAttempts: 5,
    delayMs,
    reason: "rate limited",
    providerId: "p1",
    ...extra,
  })

const permReq = (taskId: string, requestId: string, tool = "bash", target = "/etc/hosts") =>
  ev({ type: "permission-request", taskId, requestId, tool, target, input: { command: "ls" } })

const permRes = (taskId: string, requestId: string, decision = "allow", via = "user") =>
  ev({ type: "permission-resolved", taskId, requestId, decision, via })

const textEv = (text: string, taskId?: string) =>
  ev({ type: "assistant-text", text, ...(taskId !== undefined ? { taskId } : {}) })

const taskComplete = (taskId: string, ts?: number) =>
  ev({ type: "task-complete", taskId, ...(ts !== undefined ? { ts } : {}) })

const taskFailed = (taskId: string, error = "boom") => ev({ type: "task-failed", taskId, error })

const taskSkipped = (taskId: string, reason = "dep failed") =>
  ev({ type: "task-skipped", taskId, reason })

const REVIEW = {
  id: "r1",
  score: 8,
  issues: [],
  suggestions: [],
  summary: "solid",
  reviewedAt: "2026-01-01T00:00:00.000Z",
}

const ws = (over: Partial<Workspace> = {}): Workspace => ({
  id: "w1",
  userRequest: "Build the login page",
  status: "completed",
  results: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
})

// ── pairToolCalls ───────────────────────────────────────────────────────────

describe("pairToolCalls", () => {
  it("pairs a start with its end and attaches the outcome", () => {
    const pairs = pairToolCalls([
      taskStart("t1"),
      toolStart("t1", "bash", { command: "ls" }, 1000),
      toolEnd("t1", "bash", { ok: true, durationMs: 120, exitCode: 0 }, 1120),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({
      key: "tool-1",
      taskId: "t1",
      tool: "bash",
      input: { command: "ls" },
      state: "ok",
      ok: true,
      durationMs: 120,
      exitCode: 0,
      startIndex: 1,
      endIndex: 2,
    })
  })

  it("marks a failed end as an error pair with the error text", () => {
    const pairs = pairToolCalls([
      toolStart("t1", "edit", { path: "a.ts" }),
      toolEnd("t1", "edit", { ok: false, durationMs: 55, error: "boom" }),
    ])
    expect(pairs[0]?.state).toBe("error")
    expect(pairs[0]?.ok).toBe(false)
    expect(pairs[0]?.error).toBe("boom")
  })

  it("keeps unmatched starts running and ignores orphan ends", () => {
    const running = pairToolCalls([toolStart("t1", "read", { path: "a" })])
    expect(running).toHaveLength(1)
    expect(running[0]?.state).toBe("running")
    expect(running[0]?.endIndex).toBeUndefined()

    expect(pairToolCalls([toolEnd("t1", "read", { ok: true })])).toEqual([])
    expect(pairToolCalls([])).toEqual([])
  })

  it("pairs duplicate tool names FIFO — not last-match", () => {
    const pairs = pairToolCalls([
      toolStart("t1", "bash", { command: "first" }),
      toolStart("t1", "bash", { command: "second" }),
      toolEnd("t1", "bash", { ok: true, durationMs: 11 }),
      toolEnd("t1", "bash", { ok: false, durationMs: 22, error: "second failed" }),
    ])
    expect(pairs).toHaveLength(2)
    // The OLDEST open start takes the first end, whatever the timeline's
    // last-match guess would have done.
    expect(pairs[0]).toMatchObject({ input: { command: "first" }, durationMs: 11, state: "ok" })
    expect(pairs[1]).toMatchObject({
      input: { command: "second" },
      durationMs: 22,
      state: "error",
    })
  })

  it("never pairs across task boundaries and survives out-of-order ends", () => {
    const pairs = pairToolCalls([
      toolStart("t1", "bash", { command: "a" }),
      toolStart("t2", "bash", { command: "b" }),
      toolEnd("t2", "bash", { ok: true, durationMs: 5 }), // t2's end arrives first
      toolEnd("t1", "bash", { ok: true, durationMs: 99 }),
    ])
    expect(pairs).toHaveLength(2)
    expect(pairs[0]).toMatchObject({ taskId: "t1", durationMs: 99 })
    expect(pairs[1]).toMatchObject({ taskId: "t2", durationMs: 5 })
  })

  it("leaves the tail running when ends are fewer than starts", () => {
    const pairs = pairToolCalls([
      toolStart("t1", "grep", "a"),
      toolStart("t1", "grep", "b"),
      toolStart("t1", "grep", "c"),
      toolEnd("t1", "grep", { ok: true, durationMs: 1 }),
    ])
    expect(pairs.map((p) => p.state)).toEqual(["ok", "running", "running"])
  })

  it("coerces malformed payloads defensively", () => {
    const pairs = pairToolCalls([
      null,
      "junk",
      { type: 42 },
      ev({ type: "tool-start", toolName: 42, taskId: 7 }), // both keys fall back
      ev({ type: "tool-end", toolName: 42, taskId: 7, ok: "yes", durationMs: "slow" }),
    ] as unknown as RuntimeEvent[])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ tool: "?", taskId: "", state: "ok" })
    expect(pairs[0]?.ok).toBeUndefined()
    expect(pairs[0]?.durationMs).toBeUndefined()
  })
})

// ── groupRetryWaves ─────────────────────────────────────────────────────────

describe("groupRetryWaves", () => {
  it("folds consecutive same-phase events into one wave", () => {
    const waves = groupRetryWaves([
      retryEv("waiting", 1, 1000, { ts: 1000 }),
      retryEv("waiting", 2, 2000, { ts: 2000 }),
      retryEv("waiting", 3, 3000, { ts: 3000 }),
    ])
    expect(waves).toHaveLength(1)
    expect(waves[0]).toEqual({
      phase: "waiting",
      attempts: 3,
      totalDelayMs: 6000,
      firstAt: 1000,
      lastAt: 3000,
    })
  })

  it("splits a new wave when the phase changes", () => {
    const waves = groupRetryWaves([
      retryEv("waiting", 1, 500),
      retryEv("waiting", 2, 500),
      retryEv("recovered", 3, 0),
    ])
    expect(waves.map((w) => [w.phase, w.attempts])).toEqual([
      ["waiting", 2],
      ["recovered", 1],
    ])
  })

  it("splits same-phase runs that are not consecutive", () => {
    const waves = groupRetryWaves([
      retryEv("waiting", 1, 100),
      retryEv("recovered", 2, 0),
      retryEv("waiting", 3, 100),
    ])
    expect(waves).toHaveLength(3)
    expect(waves.every((w) => w.attempts === 1)).toBe(true)
  })

  it("returns nothing for streams without retry events (or garbage)", () => {
    expect(groupRetryWaves([])).toEqual([])
    expect(groupRetryWaves([taskStart("t1"), toolStart("t1", "bash")])).toEqual([])
    expect(groupRetryWaves([null as unknown as RuntimeEvent])).toEqual([])
  })

  it("survives malformed retry payloads and keeps the exhausted phase", () => {
    const waves = groupRetryWaves([
      ev({ type: "llm-retry-status" }), // no phase / delay / ts at all
      retryEv("exhausted", 5, "soon", { reason: 42 }),
    ])
    expect(waves).toHaveLength(2)
    expect(waves[0]).toMatchObject({ phase: "waiting", attempts: 1, totalDelayMs: 0 })
    expect(waves[0]?.firstAt).toBeUndefined()
    expect(waves[1]).toMatchObject({ phase: "exhausted", totalDelayMs: 0 })
    expect(waves[1]?.lastAt).toBeUndefined()
  })
})

// ── buildTurnFlowItems ──────────────────────────────────────────────────────

describe("buildTurnFlowItems", () => {
  it("compiles a full flow into typed units with turn attribution", () => {
    const units = buildTurnFlowItems(
      [
        taskStart("t1", "backend"),
        toolStart("t1", "bash", { command: "ls" }),
        toolEnd("t1", "bash", { ok: true, durationMs: 20 }),
        textEv("Opened the file", "t1"),
        taskStart("t1", "backend"), // duplicate start must not dup the turn
        taskComplete("t1"),
      ],
      ws({ review: REVIEW }),
    )
    expect(units.map((u) => u.kind)).toEqual([
      "text",
      "task",
      "tool",
      "text",
      "task-status",
      "review",
    ])
    expect(units.map((u) => u.turnId)).toEqual([
      "user",
      "task-t1",
      "task-t1",
      "task-t1",
      "task-t1",
      "review",
    ])
    expect(units[2]).toMatchObject({ kind: "tool", state: "ok", role: "backend", taskId: "t1" })
    expect(units[3]).toMatchObject({ kind: "text", role: "backend", text: "Opened the file" })
    expect(units[4]).toMatchObject({ kind: "task-status", status: "completed" })
    expect(units[5]).toMatchObject({ kind: "review", turnId: "review", score: 8 })
  })

  it("keeps running tools and running turns live", () => {
    const units = buildTurnFlowItems(
      [taskStart("t1"), toolStart("t1", "read", { path: "a.ts" }, 500)],
      ws(),
    )
    const tool = units.find(
      (u): u is Extract<ConversationUnit, { kind: "tool" }> => u.kind === "tool",
    )
    expect(tool?.state).toBe("running")
    const turns = groupUnitsByTurn(units)
    expect(turns.find((t) => t.turnId === "task-t1")?.status).toBe("running")
    expect(turns.find((t) => t.turnId === "task-t1")?.durationMs).toBeUndefined()
  })

  it("keeps a not-yet-productive task visible through its marker unit", () => {
    const units = buildTurnFlowItems([taskStart("solo", "frontend")], null)
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ kind: "task", turnId: "task-solo", role: "frontend" })
    const [turn] = groupUnitsByTurn(units)
    expect(turn).toMatchObject({ status: "running", depth: 1, units: [units[0]] })
  })

  it("folds retry waves into single units inside their open turn", () => {
    const units = buildTurnFlowItems(
      [
        taskStart("t1"),
        retryEv("waiting", 1, 1000, { reason: "429" }),
        retryEv("waiting", 2, 2000, { reason: "429 again" }),
        toolStart("t1", "bash"),
        toolEnd("t1", "bash", { ok: true, durationMs: 5 }),
      ],
      ws(),
    )
    const retries = units.filter((u): u is RetryUnit => u.kind === "retry")
    expect(retries).toHaveLength(1) // two waiting events → ONE unit
    expect(retries[0]).toMatchObject({
      turnId: "task-t1",
      phase: "waiting",
      attempts: 2,
      totalDelayMs: 3000,
      reason: "429 again", // waitings collapse to the last attempt
      attempt: 2,
      maxAttempts: 5,
    })
    expect(retries[0]?.entries).toHaveLength(2) // trail kept for expansion
  })

  it("pairs permission requests with resolutions, and survives orphans", () => {
    const units = buildTurnFlowItems(
      [
        permReq("t1", "r1"),
        permRes("t1", "r1", "allow", "user"),
        permReq("t2", "r2", "write", "/tmp/x"),
        permRes("t9", "r3", "deny", "timeout"), // resolved without request
      ],
      null,
    )
    const perms = units.filter(
      (u): u is Extract<ConversationUnit, { kind: "permission" }> => u.kind === "permission",
    )
    expect(perms).toHaveLength(3)
    expect(perms[0]).toMatchObject({
      turnId: "task-t1",
      requestId: "r1",
      state: "allowed",
      via: "user",
      input: { command: "ls" },
    })
    expect(perms[1]).toMatchObject({ turnId: "task-t2", state: "pending", target: "/tmp/x" })
    expect(perms[2]).toMatchObject({ turnId: "task-t9", state: "denied" })
  })

  it("routes text segments to their task turn, or a message turn", () => {
    const units = buildTurnFlowItems(
      [textEv("standalone narration"), taskStart("t1", "frontend"), textEv("inline note", "t1")],
      null,
    )
    const texts = units.filter(
      (u): u is Extract<ConversationUnit, { kind: "text" }> => u.kind === "text",
    )
    expect(texts).toHaveLength(2)
    expect(texts[0]).toMatchObject({ turnId: "msg-0", role: "assistant" })
    expect(texts[1]).toMatchObject({
      turnId: "task-t1",
      role: "frontend", // inherits the turn role, not a generic "assistant"
      text: "inline note",
    })
  })

  it("creates implicit turns for events without a task-start (stream join)", () => {
    const units = buildTurnFlowItems(
      [
        toolStart("t9", "bash", { command: "whoami" }, 10),
        toolEnd("t9", "bash", { ok: true, durationMs: 3 }),
        taskSkipped("t8"),
      ],
      null,
    )
    expect(units.map((u) => u.turnId)).toEqual(["task-t9", "task-t8"])
    expect(units[1]).toMatchObject({ kind: "task-status", status: "skipped", error: "dep failed" })
  })

  it("appends workspace failure and drops malformed events", () => {
    const units = buildTurnFlowItems(
      [
        null,
        42,
        "junk",
        { type: 123 },
        taskStart("t1"),
        taskFailed("t1"),
      ] as unknown as RuntimeEvent[],
      ws({ status: "failed", error: "workspace exploded" }),
    )
    expect(units.map((u) => u.kind)).toEqual(["text", "task", "task-status", "failed"])
    expect(units.at(-1)).toMatchObject({ kind: "failed", error: "workspace exploded" })
    expect(units[2]).toMatchObject({ kind: "task-status", status: "failed", error: "boom" })
  })
})

// ── estimateTurnDepth ───────────────────────────────────────────────────────

describe("estimateTurnDepth", () => {
  it("keeps sequential task turns at depth 1", () => {
    const units = buildTurnFlowItems(
      [
        taskStart("a"),
        toolStart("a", "bash"),
        toolEnd("a", "bash", { ok: true }),
        taskComplete("a"),
        taskComplete("b"),
      ],
      null,
    )
    const depth = estimateTurnDepth(units)
    expect(depth.get("task-a")).toBe(1)
    expect(depth.get("task-b")).toBe(1)
  })

  it("nests a turn started while a parent is still open", () => {
    const units = buildTurnFlowItems(
      [
        taskStart("commander", "general"),
        taskStart("worker", "backend"),
        toolStart("worker", "bash"),
        toolEnd("worker", "bash", { ok: true }),
        taskComplete("worker"),
        taskComplete("commander"),
      ],
      null,
    )
    const depth = estimateTurnDepth(units)
    expect(depth.get("task-commander")).toBe(1)
    expect(depth.get("task-worker")).toBe(2)
  })

  it("returns to depth 1 once parents close, and nests three deep", () => {
    const units = buildTurnFlowItems(
      [
        taskStart("a"),
        taskStart("b"),
        taskStart("c"),
        taskComplete("c"),
        taskComplete("b"),
        taskComplete("a"),
        taskStart("fresh"),
        taskComplete("fresh"),
      ],
      null,
    )
    const depth = estimateTurnDepth(units)
    expect(depth.get("task-a")).toBe(1)
    expect(depth.get("task-b")).toBe(2)
    expect(depth.get("task-c")).toBe(3)
    expect(depth.get("task-fresh")).toBe(1)
  })

  it("treats non-task turns as roots and handles the empty stream", () => {
    const units = buildTurnFlowItems([], ws({ review: REVIEW }))
    const depth = estimateTurnDepth(units)
    expect(depth.get("user")).toBe(1)
    expect(depth.get("review")).toBe(1)
    expect(estimateTurnDepth([])).toEqual(new Map())
  })
})

// ── buildConversationFindIndex ──────────────────────────────────────────────

describe("buildConversationFindIndex", () => {
  const units = buildTurnFlowItems(
    [
      taskStart("t1", "backend"),
      toolStart("t1", "bash", { command: "grep Login src/auth.ts" }),
      toolEnd("t1", "bash", { ok: false, durationMs: 5, error: "Login not found" }),
      permReq("t1", "r1", "bash", "/etc/Login.conf"),
      taskComplete("t1"),
    ],
    ws({ userRequest: "Build the Login page" }),
  )

  it("finds matches across text, tool input and error fields", () => {
    const matches = buildConversationFindIndex(units, "login")
    const byKind = new Map(matches.map((m) => [m.kind, m]))
    expect(byKind.get("text")?.turnId).toBe("user")
    expect(byKind.get("text")?.hits[0]).toMatchObject({ field: "text", start: 10, end: 15 })
    expect(byKind.get("tool")?.hits.map((h) => h.field)).toEqual(["input", "error"])
    expect(byKind.get("permission")?.hits[0]).toMatchObject({ field: "target" })
  })

  it("returns nothing for blank queries and hopeless queries", () => {
    expect(buildConversationFindIndex(units, "")).toEqual([])
    expect(buildConversationFindIndex(units, "   ")).toEqual([])
    expect(buildConversationFindIndex(units, "zzz-not-there")).toEqual([])
  })

  it("is case-insensitive and reports every occurrence range", () => {
    const textUnit: ConversationUnit = {
      kind: "text",
      key: "k",
      turnId: "user",
      role: "user",
      index: -1,
      text: "run RUN Run, then rerun",
    }
    const matches = buildConversationFindIndex([textUnit], "run")
    expect(matches).toHaveLength(1)
    expect(matches[0]?.hits).toEqual([
      { field: "text", start: 0, end: 3 },
      { field: "text", start: 4, end: 7 },
      { field: "text", start: 8, end: 11 },
      { field: "text", start: 20, end: 23 },
    ])
  })

  it("skips units without searchable content but matches retry phases", () => {
    const retryUnit: RetryUnit = {
      kind: "retry",
      key: "r",
      turnId: "system",
      role: "assistant",
      index: 0,
      phase: "waiting",
      attempts: 2,
      totalDelayMs: 100,
      entries: [],
    }
    const emptyReview: ConversationUnit = {
      kind: "review",
      key: "rv",
      turnId: "review",
      role: "review",
      index: 1,
    }
    const matches = buildConversationFindIndex([retryUnit, emptyReview], "WAITING")
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ key: "r", kind: "retry", unitIndex: 0 })
    expect(matches[0]?.hits[0]).toMatchObject({ field: "phase", start: 0, end: 7 })
  })

  it("matches task ids on markers and status units", () => {
    const matches = buildConversationFindIndex(units, "t1")
    expect(matches.some((m) => m.kind === "task")).toBe(true)
    expect(matches.some((m) => m.kind === "task-status")).toBe(true)
    expect(matches.every((m) => m.hits.some((h) => h.field === "taskId"))).toBe(true)
  })
})

// ── toConversationMarkdown ──────────────────────────────────────────────────

describe("toConversationMarkdown", () => {
  const units = buildTurnFlowItems(
    [
      taskStart("t1", "backend"),
      toolStart("t1", "bash", { command: "ls" }, 1000),
      toolEnd("t1", "bash", { ok: true, durationMs: 120, exitCode: 0 }, 1120),
      toolStart("t1", "edit", { path: "a.ts" }),
      toolEnd("t1", "edit", { ok: false, durationMs: 55, error: "boom" }),
      retryEv("waiting", 1, 1000),
      retryEv("waiting", 2, 2000),
      retryEv("waiting", 3, 3000, { reason: "still 429" }),
      taskComplete("t1"),
    ],
    ws({ userRequest: "Ship it" }),
  )

  it("renders turn headers with status and tool exit codes", () => {
    const md = toConversationMarkdown(units, { workspaceTitle: "Ship it" })
    // Markdown is locale-independent by design (the model never calls t()):
    // headers carry the raw role id, presentation localizes.
    expect(md).toContain("# Maximilian conversation — Ship it")
    expect(md).toContain("## user")
    expect(md).toContain("## backend · t1 (completed)")
    expect(md).toContain("- `bash` · 120ms · exit 0")
    expect(md).toContain("- `edit` · — failed: boom · 55ms")
  })

  it("reports retry-wave statistics in header and body", () => {
    const md = toConversationMarkdown(units)
    expect(md).toContain("3 retry attempts")
    expect(md).toContain("- retry: waiting ×3 · 6000ms total — still 429")
  })

  it("marks running tools, permissions and workspace failure", () => {
    const running = buildTurnFlowItems(
      [toolStart("t1", "read", { path: "a" })],
      ws({ status: "failed", error: "kaboom" }),
    )
    const perms = buildTurnFlowItems([permReq("t1", "r1"), permRes("t1", "r1", "allow")], null)
    const md = toConversationMarkdown([...running, ...perms])
    expect(md).toContain("- `read` · — running")
    expect(md).toContain("- workspace failed: kaboom")
    expect(md).toContain("- permission `bash` → /etc/hosts — allowed")
  })

  it("keeps a minimal header for an empty stream", () => {
    const md = toConversationMarkdown([])
    expect(md.startsWith("# Maximilian conversation\n")).toBe(true)
    expect(md).toContain("_0 turns · 0 units · 0 tool calls_")
  })

  it("appends ISO timestamps only when requested", () => {
    const plain = toConversationMarkdown(units)
    const stamped = toConversationMarkdown(units, { includeTimestamps: true })
    expect(plain).not.toContain("1970-01-01T00:00:01")
    expect(stamped).toContain("1970-01-01T00:00:01.000Z")
  })
})

// ── Presentation helpers ────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("labels sub-second spans in ms and larger spans in seconds", () => {
    expect(formatDuration(120)).toBe("120 ms")
    expect(formatDuration(1000)).toBe("1.0 s")
    expect(formatDuration(2500)).toBe("2.5 s")
    expect(formatDuration(-5)).toBe("—")
    expect(formatDuration(Number.NaN)).toBe("—")
  })
})

// ── Render smokes ───────────────────────────────────────────────────────────

describe("ConversationUnitsPreview rendering", () => {
  it("renders turns, the user request and tool blocks through the registry", () => {
    const events = [
      taskStart("t1", "backend", 1000),
      toolStart("t1", "bash", { command: "ls" }, 1100),
      toolEnd("t1", "bash", { ok: true, durationMs: 20 }, 1120),
      taskComplete("t1", 2500),
    ]
    render(<ConversationUnitsPreview events={events} workspace={ws({ review: REVIEW })} />)
    expect(screen.getAllByTestId("turn-group")).toHaveLength(3) // user, task-t1, review
    expect(screen.getByText("Build the login page")).toBeInTheDocument()
    expect(screen.getByTestId("tool-call-bash")).toBeInTheDocument()
    expect(screen.getByTestId("turn-status")).toHaveTextContent("Done")
    expect(screen.getByTestId("turn-duration")).toHaveTextContent("1.5 s")
    expect(screen.getByTestId("conversation-units-stats")).toHaveTextContent("3 turns")
    expect(screen.getByTestId("conversation-units-stats")).toHaveTextContent("5 units")
  })

  it("shows the empty state when the stream is empty", () => {
    render(<ConversationUnitsPreview events={[]} workspace={null} />)
    expect(screen.getByTestId("conversation-units-empty")).toBeInTheDocument()
    expect(screen.queryByTestId("turn-group")).not.toBeInTheDocument()
  })

  it("renders permission states and the running-tool badge", () => {
    const events = [
      taskStart("t1"),
      toolStart("t1", "bash", { command: "rm -rf /" }),
      permReq("t1", "r1"),
    ]
    render(<ConversationUnitsPreview events={events} workspace={null} />)
    expect(screen.getByTestId("tool-running")).toBeInTheDocument()
    expect(screen.getByTestId("permission-unit")).toHaveAttribute(
      "data-permission-state",
      "pending",
    )
    expect(screen.getByText("pending")).toBeInTheDocument()
  })

  it("indents nested subagent turns by depth", () => {
    const events = [
      taskStart("root", "general"),
      toolStart("root", "bash", { command: "plan" }),
      toolEnd("root", "bash", { ok: true, durationMs: 4 }),
      taskStart("child", "backend"),
      toolStart("child", "bash", { command: "ls" }),
      toolEnd("child", "bash", { ok: true, durationMs: 4 }),
    ]
    render(<ConversationUnitsPreview events={events} workspace={null} />)
    const groups = screen.getAllByTestId("turn-group")
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveAttribute("data-turn-depth", "1")
    expect(groups[1]).toHaveAttribute("data-turn-depth", "2")
  })
})

describe("TurnGroup / RetryWaveGroup rendering", () => {
  const retryUnit: RetryUnit = {
    kind: "retry",
    key: "r1",
    turnId: "task-t1",
    role: "assistant",
    index: 3,
    phase: "waiting",
    attempts: 2,
    totalDelayMs: 3000,
    firstAt: 1000,
    lastAt: 3000,
    providerId: "p1",
    attempt: 2,
    maxAttempts: 5,
    reason: "rate limited",
    entries: [
      { phase: "waiting", attempt: 1, delayMs: 1000, reason: "rate limited" },
      { phase: "waiting", attempt: 2, delayMs: 2000, reason: "still limited" },
    ],
  }

  it("shows the folded wave collapsed and each attempt when expanded", () => {
    render(<RetryWaveGroup unit={retryUnit} />)
    expect(screen.getByTestId("retry-summary")).toHaveTextContent("retry waiting ×2")
    expect(screen.getByTestId("retry-summary")).toHaveTextContent("3.0 s")
    expect(screen.getByTestId("retry-reason")).toHaveTextContent("rate limited")
    expect(screen.queryByTestId("retry-attempts")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByTestId("retry-attempts")).toBeInTheDocument()
    expect(screen.getByTestId("retry-attempts").children).toHaveLength(2)
    expect(screen.getByText("attempt 1 · waited 1.0 s")).toBeInTheDocument()
    expect(screen.getByText("attempt 2 · waited 2.0 s")).toBeInTheDocument()
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true")
  })

  it("renders a turn header with role, task id, status and duration", () => {
    const units = buildTurnFlowItems(
      [
        taskStart("t1", "backend", 1000),
        retryEv("waiting", 1, 1000, { ts: 1200 }),
        toolStart("t1", "bash"),
        toolEnd("t1", "bash", { ok: true, durationMs: 9 }, 1600),
        taskComplete("t1", 2000),
      ],
      null,
    )
    const [turn] = groupUnitsByTurn(units)
    if (!turn) throw new Error("expected a turn")
    render(<TurnGroup turn={turn} />)
    expect(screen.getByTestId("turn-group")).toHaveAttribute("data-turn-id", "task-t1")
    expect(screen.getByText("backend")).toBeInTheDocument()
    expect(screen.getByTestId("turn-status")).toHaveTextContent("Done")
    expect(screen.getByTestId("turn-duration")).toHaveTextContent("1.0 s")
    expect(screen.getByTestId("retry-wave")).toBeInTheDocument()
    expect(screen.getByTestId("tool-call-bash")).toBeInTheDocument()
  })

  it("localizes the role badge when the locale switches to zh-CN", () => {
    const units = buildTurnFlowItems([], ws())
    const [userTurn] = groupUnitsByTurn(units)
    if (!userTurn) throw new Error("expected the user turn")
    setLocale("zh-CN")
    render(<TurnGroup turn={userTurn} />)
    expect(screen.getByText("你")).toBeInTheDocument()
    expect(getDictionary("zh-CN")?.["conversation.preview.stats"]).toContain("个回合")
  })
})
