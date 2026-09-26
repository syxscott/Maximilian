// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Conversation turn-unit pipeline tests: the pairing algorithm (FIFO
 * per taskId+tool, running tails, ignored orphans), retry-wave folding,
 * the unit-stream compiler, turn depths, the find index, markdown
 * export, the deep-surface models (turn windowing, text-unit
 * extraction, live-tail state, share sections, virtual-height
 * estimation, ai-elements density surfaces: usage/latency/stats/error
 * detail) — plus render smokes for TurnGroup / RetryWaveGroup /
 * ConversationUnitsPreview / ConversationWindow / TextUnitBlock /
 * ShareView and the timeline's ai-elements mounts.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"

import {
  buildConversationFindIndex,
  buildTurnFlowItems,
  elapsedSeconds,
  errorDetailOf,
  estimateTurnDepth,
  estimateVirtualHeight,
  expansionKeepsTail,
  formatDuration,
  formatEstimatedHeight,
  groupRetryWaves,
  groupUnitsByTurn,
  liveTailState,
  markFirstSeen,
  pairToolCalls,
  perItemHeight,
  resultUsage,
  shareSections,
  statsSummary,
  stepNavigationCursor,
  textUnits,
  toConversationMarkdown,
  toShareMarkdown,
  turnDefaultExpanded,
  turnHeight,
  turnResultStats,
  VIRTUAL_HEIGHT_THRESHOLD,
  windowTurns,
  virtualWindow,
  scrollOffsetForUnit,
  withTextUnitEvents,
  TEXT_SOURCE_FIELD,
  DEFAULT_VIRTUAL_OVERSCAN,
  type ConversationUnit,
  type ExtractedTextUnit,
  type RetryUnit,
} from "../src/components/conversation/model"
import { tokenUsageModel } from "../src/components/ai-elements/model"
import { TurnGroup } from "../src/components/conversation/TurnGroup"
import { RetryWaveGroup } from "../src/components/conversation/RetryWaveGroup"
import { ConversationUnitsPreview } from "../src/components/conversation/ConversationUnitsPreview"
import { ConversationWindow } from "../src/components/conversation/ConversationWindow"
import { VirtualTurnWindow } from "../src/components/conversation/VirtualTurnWindow"
import {
  TextUnitBlock,
  STEERING_FLASH_FADE_MS,
  STEERING_FLASH_HOLD_MS,
} from "../src/components/conversation/TextUnitBlock"
import { ShareView } from "../src/components/conversation/ShareView"
import { ConversationTimeline } from "../src/components/ConversationTimeline"
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

describe("elapsedSeconds / turnDefaultExpanded (live-status model)", () => {
  it("counts whole seconds since the start, clamping garbage and clock skew", () => {
    expect(elapsedSeconds(1000, 1000)).toBe(0)
    expect(elapsedSeconds(1000, 8000)).toBe(7)
    expect(elapsedSeconds(undefined, 8000)).toBe(0) // no event ts → no count
    expect(elapsedSeconds(Number.NaN, 8000)).toBe(0)
    expect(elapsedSeconds(8000, 1000)).toBe(0) // clock behind the start
  })

  it("defaults the expanded error view on FAILED turns only", () => {
    expect(turnDefaultExpanded("failed")).toBe(true)
    expect(turnDefaultExpanded("running")).toBe(false)
    expect(turnDefaultExpanded("completed")).toBe(false)
    expect(turnDefaultExpanded("skipped")).toBe(false)
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
    expect(screen.getByText("Backend")).toBeInTheDocument()
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

  it("localizes the agent role badges (the passthrough role ids) under zh-CN", () => {
    const units = buildTurnFlowItems([taskStart("t1", "backend"), taskStart("t2", "review")], null)
    const turns = groupUnitsByTurn(units)
    setLocale("zh-CN")
    render(
      <div>
        {turns.map((turn) => (
          <TurnGroup key={turn.turnId} turn={turn} />
        ))}
      </div>,
    )
    expect(screen.getByText("后端")).toBeInTheDocument()
    expect(screen.getByText("评审")).toBeInTheDocument()
  })
})

// ── ConversationTimeline (the pipeline-driven surface) ──────────────────────

describe("ConversationTimeline rendering", () => {
  const flowEvents = (): RuntimeEvent[] => [
    taskStart("t1", "backend", 1000),
    toolStart("t1", "bash", { command: "grep Login src/auth.ts" }, 1100),
    toolEnd("t1", "bash", { ok: true, durationMs: 20 }, 1120),
    retryEv("waiting", 1, 1000),
    taskComplete("t1", 2500),
    taskStart("t2", "frontend"),
    taskFailed("t2", "selector not found"),
  ]

  it("renders the pipeline's turn groups: user request, tasks, retry wave, review", () => {
    render(
      <ConversationTimeline
        events={flowEvents()}
        workspace={ws({ status: "completed", review: REVIEW })}
        live={false}
      />,
    )
    const groups = screen.getAllByTestId("turn-group")
    expect(groups.map((g) => g.getAttribute("data-turn-id"))).toEqual([
      "user",
      "task-t1",
      "task-t2",
      "review",
    ])
    // User request card semantics preserved (user text turn).
    expect(screen.getByText("Build the login page")).toBeInTheDocument()
    // Tool calls render through the single registry path, running state folded.
    expect(screen.getByTestId("tool-call-bash")).toBeInTheDocument()
    expect(screen.queryByTestId("tool-running")).not.toBeInTheDocument()
    // Consecutive same-phase retries fold into ONE wave inside their turn.
    expect(screen.getAllByTestId("retry-wave")).toHaveLength(1)
    expect(screen.getByTestId("retry-summary")).toHaveTextContent("retry waiting ×1")
    // Failed task keeps its destructive error, review keeps its verdict.
    expect(screen.getByTestId("turn-task-error")).toHaveTextContent("selector not found")
    expect(screen.getByTestId("turn-review")).toHaveTextContent("Review complete · score 8")
  })

  it("shows the empty state for an empty stream", () => {
    render(<ConversationTimeline events={[]} workspace={null} live={false} />)
    expect(screen.getByText(/Submit a task/)).toBeInTheDocument()
    expect(screen.queryByTestId("turn-group")).not.toBeInTheDocument()
  })

  it("find filters to matching turns and highlights the matched ranges", () => {
    const { container } = render(
      <ConversationTimeline
        events={flowEvents()}
        workspace={ws({ userRequest: "Build the login page" })}
        live={false}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /find/i }))
    // Before any query every turn is displayed, nothing highlighted.
    // (ws() carries no review — user + task-t1 + task-t2.)
    expect(screen.getAllByTestId("turn-group")).toHaveLength(3)
    expect(container.querySelectorAll("mark")).toHaveLength(0)

    fireEvent.change(screen.getByTestId("timeline-find"), { target: { value: "login" } })
    // "login" hits the user text unit AND the bash tool's input JSON.
    expect(screen.getByText("2 matches")).toBeInTheDocument()
    expect(screen.getAllByTestId("turn-group")).toHaveLength(2) // user + task-t1
    const marks = container.querySelectorAll("mark")
    expect(marks).toHaveLength(1) // interval highlight only on the text unit
    expect(marks[0]?.textContent).toBe("login")
    // Highlighted turns get the amber find border.
    expect(screen.getAllByTestId("turn-group")[0]).toHaveAttribute(
      "class",
      expect.stringContaining("border-amber-500/60"),
    )
  })

  it("find reports zero matches without dropping the turn list", () => {
    render(<ConversationTimeline events={flowEvents()} workspace={ws()} live={false} />)
    fireEvent.click(screen.getByRole("button", { name: /find/i }))
    fireEvent.change(screen.getByTestId("timeline-find"), { target: { value: "zzz-not-there" } })
    expect(screen.getByText("0 matches")).toBeInTheDocument()
    expect(screen.queryByTestId("turn-group")).not.toBeInTheDocument()
  })

  it("turn navigation sets the window anchor and clamps at the anchors", () => {
    let scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      render(<ConversationTimeline events={flowEvents()} workspace={ws()} live={false} />)
      const next = screen.getByRole("button", { name: "next task" })
      const prev = screen.getByRole("button", { name: "prev task" })
      fireEvent.click(next)
      fireEvent.click(next)
      // Navigation IS anchor setting: the window pins its head at the
      // task anchor and scrolls THAT row into view (window indices are
      // the anchor's full-list position).
      expect(scrolled.map((el) => el.getAttribute("data-window-index"))).toEqual(["1", "2"])
      fireEvent.click(prev)
      expect(scrolled.at(-1)?.getAttribute("data-window-index")).toBe("1")
      // Clamped at the first anchor.
      fireEvent.click(prev)
      expect(scrolled.at(-1)?.getAttribute("data-window-index")).toBe("1")
    } finally {
      Element.prototype.scrollIntoView = original
      scrolled = []
    }
  })

  it("releasing the navigation anchor returns the window to tail-following", () => {
    render(<ConversationTimeline events={flowEvents()} workspace={ws()} live={false} />)
    const windowEl = () => screen.getByTestId("conversation-window")
    fireEvent.click(screen.getByRole("button", { name: "next task" }))
    expect(windowEl()).toHaveAttribute("data-anchor-offset", "1")
    expect(windowEl().querySelectorAll("[data-window-index]")[0]).toHaveAttribute(
      "data-window-index",
      "1",
    )
    expect(screen.getByTestId("window-clear-anchor")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("window-clear-anchor"))
    expect(windowEl()).not.toHaveAttribute("data-anchor-offset")
    expect(screen.queryByTestId("window-clear-anchor")).not.toBeInTheDocument()
    // Tail window again: the first rendered row is full-list index 0.
    expect(windowEl().querySelectorAll("[data-window-index]")[0]).toHaveAttribute(
      "data-window-index",
      "0",
    )
  })

  it("anchor navigation reaches task turns hidden above the window", () => {
    let scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      // 60 task turns — the tail window renders only the newest 50, so
      // task-0 lives above the window. The first "next" targets it by
      // anchor; the window must re-pin to materialize it.
      const many: RuntimeEvent[] = Array.from({ length: 60 }, (_, i) =>
        ev({ type: "task-complete", taskId: `task-${i}` }),
      )
      render(<ConversationTimeline events={many} workspace={null} live={false} />)
      expect(screen.getAllByTestId("turn-group")[0]).toHaveAttribute("data-turn-id", "task-task-10")
      fireEvent.click(screen.getByRole("button", { name: "next task" }))
      expect(scrolled.at(-1)?.getAttribute("data-window-index")).toBe("0")
      const groups = screen.getAllByTestId("turn-group")
      expect(groups[0]).toHaveAttribute("data-turn-id", "task-task-0")
      expect(groups).toHaveLength(50) // still a bounded window, re-pinned
      fireEvent.click(screen.getByRole("button", { name: "next task" }))
      expect(scrolled.at(-1)?.getAttribute("data-window-index")).toBe("1")
      expect(screen.getAllByTestId("turn-group")[0]).toHaveAttribute("data-turn-id", "task-task-1")
    } finally {
      Element.prototype.scrollIntoView = original
      scrolled = []
    }
  })

  it("copies the pipeline markdown via the share button", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    render(
      <ConversationTimeline
        events={flowEvents()}
        workspace={ws({ status: "completed", review: REVIEW })}
        live={false}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /copy as markdown/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const md = writeText.mock.calls[0]?.[0] ?? ""
    expect(md).toContain("# Maximilian conversation — Build the login page")
    expect(md).toContain("## backend · t1 (completed)")
    expect(md).toContain("## review")
    expect(md).toContain("- retry: waiting ×1 · 1000ms total")
    expect(await screen.findByText(/copied/i)).toBeInTheDocument()
  })

  it("windows to the newest 50 turns via ConversationWindow with load-earlier", () => {
    const many: RuntimeEvent[] = Array.from({ length: 60 }, (_, i) =>
      ev({ type: "task-complete", taskId: `task-${i}` }),
    )
    render(<ConversationTimeline events={many} workspace={null} live={false} />)
    expect(screen.getAllByTestId("turn-group")).toHaveLength(50)
    expect(screen.getByTestId("window-load-earlier")).toHaveTextContent("Load 10 earlier turns")
    // Under the virtual-height budget: no hint on the affordance, no bars.
    expect(screen.queryByTestId("window-height-spacer")).not.toBeInTheDocument()
    expect(screen.getByTestId("window-load-earlier").textContent).not.toContain("est.")
    fireEvent.click(screen.getByTestId("window-load-earlier"))
    expect(screen.getAllByTestId("turn-group")).toHaveLength(60)
    expect(screen.queryByTestId("window-load-earlier")).not.toBeInTheDocument()
  })

  it("over the virtual budget the density affordances all engage", () => {
    // 400 one-line message turns → 400 × 28px = 11200px > 8000px budget.
    const many = msgTurnEvents(400)
    expect(estimateVirtualHeight(buildTurnFlowItems(many, null))).toBeGreaterThan(
      VIRTUAL_HEIGHT_THRESHOLD,
    )
    render(<ConversationTimeline events={many} workspace={null} live={false} />)
    // The windowing affordance carries the human-readable estimate…
    expect(screen.getByTestId("window-load-earlier")).toHaveTextContent("≈ 11.2k px est.")
    // …and every rendered card gets a placeholder bar of its item height,
    // so the scrollbar ratio stays real while only a window renders.
    const spacers = screen.getAllByTestId("window-height-spacer")
    expect(spacers).toHaveLength(50)
    expect(spacers[0]).toHaveAttribute("data-spacer-height", "28")
    expect(spacers[0]).toHaveStyle({ height: "28px" })
    // The total estimate sits beside the find box with a hover title…
    const total = screen.getByTestId("timeline-estimated-height")
    expect(total).toHaveTextContent("≈ 11.2k px")
    expect(total.getAttribute("title")).toBeTruthy()
    // …and each rendered card wrapper reserves its turn's estimate
    // (anti-jump) in addition to the placeholder bar.
    const rows = screen.getByTestId("conversation-window").querySelectorAll("[data-min-height]")
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveAttribute("data-min-height", "28")
    expect(rows[0]).toHaveStyle({ minHeight: "28px" })
  })

  it("under the budget neither the toolbar estimate nor card minHeight show", () => {
    render(<ConversationTimeline events={flowEvents()} workspace={null} live={false} />)
    expect(screen.queryByTestId("timeline-estimated-height")).not.toBeInTheDocument()
    expect(screen.getByTestId("conversation-window").querySelector("[data-min-height]")).toBeNull()
  })
})

// ── live-tail frozen counts (component-level) ───────────────────────────────

/** Pin jsdom's missing layout metrics so onScroll's at-bottom math runs. */
function pinScrollMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight })
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight })
}

describe("ConversationTimeline live-tail", () => {
  /** Two standalone narration events → two units (workspace is null). */
  const notes = (n: number): RuntimeEvent[] =>
    Array.from({ length: n }, (_, i) => textEv(`note ${i}`))

  it("shows no jump affordance while attached", () => {
    render(<ConversationTimeline events={notes(2)} workspace={null} live={true} />)
    expect(screen.queryByTestId("jump-to-latest")).toBeNull()
  })

  it("hides the jump affordance when detached with a zero frozen count", () => {
    const { container } = render(
      <ConversationTimeline events={notes(2)} workspace={null} live={true} />,
    )
    const el = screen.getByTestId("conversation-timeline")
    pinScrollMetrics(el, 2000, 500)
    el.scrollTop = 1000 // 2000 − 1000 − 500 ≥ 48 → detached
    fireEvent.scroll(el)
    // Detached at the current end: nothing pending, so the floating
    // button stays out of the way — scrolling down is all it takes.
    expect(screen.queryByTestId("jump-to-latest")).toBeNull()
    expect(container).toBeTruthy()
  })

  it("accumulates several arrivals against one freeze point while detached", () => {
    const { rerender } = render(
      <ConversationTimeline events={notes(2)} workspace={null} live={true} />,
    )
    const el = screen.getByTestId("conversation-timeline")
    pinScrollMetrics(el, 2000, 500)
    el.scrollTop = 1000
    fireEvent.scroll(el)
    // First batch of arrivals after the freeze.
    rerender(<ConversationTimeline events={notes(4)} workspace={null} live={true} />)
    expect(screen.getByTestId("jump-to-latest")).toHaveTextContent("+2")
    // Second batch: the count grows on the SAME freeze point — a later
    // scroll/must-not-reset path never re-records it.
    rerender(<ConversationTimeline events={notes(5)} workspace={null} live={true} />)
    expect(screen.getByTestId("jump-to-latest")).toHaveTextContent("+3")
  })

  it("releases the freeze at the bottom and re-freezes fresh on the next detach", () => {
    const { rerender } = render(
      <ConversationTimeline events={notes(2)} workspace={null} live={true} />,
    )
    const el = screen.getByTestId("conversation-timeline")
    pinScrollMetrics(el, 2000, 500)
    el.scrollTop = 1000
    fireEvent.scroll(el)
    rerender(<ConversationTimeline events={notes(4)} workspace={null} live={true} />)
    expect(screen.getByTestId("jump-to-latest")).toHaveTextContent("+2")

    // Scroll back to the bottom — the episode ends, the affordance goes.
    el.scrollTop = 1500 // 2000 − 1500 − 500 < 48 → attached again
    fireEvent.scroll(el)
    expect(screen.queryByTestId("jump-to-latest")).toBeNull()

    // More arrivals while attached → still no affordance.
    rerender(<ConversationTimeline events={notes(6)} workspace={null} live={true} />)
    expect(screen.queryByTestId("jump-to-latest")).toBeNull()

    // Detach again: the freeze point is the CURRENT end (6), so one new
    // arrival counts +1 — not the stale +4 a carried-over point would give.
    el.scrollTop = 0
    fireEvent.scroll(el)
    rerender(<ConversationTimeline events={notes(7)} workspace={null} live={true} />)
    expect(screen.getByTestId("jump-to-latest")).toHaveTextContent("+1")
  })

  it("drops the stale frozen count when the workspace switches", () => {
    const { rerender } = render(
      <ConversationTimeline events={notes(2)} workspace={ws()} live={true} />,
    )
    const el = screen.getByTestId("conversation-timeline")
    pinScrollMetrics(el, 2000, 500)
    el.scrollTop = 1000
    fireEvent.scroll(el)
    rerender(<ConversationTimeline events={notes(4)} workspace={ws()} live={true} />)
    expect(screen.getByTestId("jump-to-latest")).toHaveTextContent("+2")

    // A different workspace stream invalidates a unit-COUNT freeze point.
    rerender(<ConversationTimeline events={notes(2)} workspace={ws({ id: "w2" })} live={true} />)
    expect(screen.queryByTestId("jump-to-latest")).toBeNull()
  })
})

// ── find highlight tiers + in-scope hotkeys (component-level) ───────────────

describe("ConversationTimeline find tiers and hotkeys", () => {
  it("Enter steps the current match to amber highlights while the others stay default", () => {
    const { container } = render(
      <ConversationTimeline
        events={[textEv("alpha one"), textEv("alpha two")]}
        workspace={null}
        live={false}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /find/i }))
    fireEvent.change(screen.getByTestId("timeline-find"), { target: { value: "alpha" } })
    expect(screen.getByText("2 matches")).toBeInTheDocument()
    // No cursor yet: every match keeps the default mark backdrop.
    expect(container.querySelectorAll("mark")).toHaveLength(2)
    expect(container.querySelectorAll('[data-testid="mark-current"]')).toHaveLength(0)

    // Enter #1 — the first match is current: amber mark, solid current
    // border on its turn, and the window anchored at that turn.
    fireEvent.keyDown(screen.getByTestId("timeline-find"), { key: "Enter" })
    expect(screen.getByTestId("find-current-position")).toHaveTextContent("1/2")
    const first = container.querySelectorAll("mark")
    expect(first[0]).toHaveAttribute("data-testid", "mark-current")
    expect(first[0]).toHaveClass("bg-amber-300")
    expect(first[1]).not.toHaveAttribute("data-testid", "mark-current")
    expect(first[0]?.closest('[data-testid="turn-group"]')).toHaveAttribute(
      "data-current-turn",
      "true",
    )
    expect(first[1]?.closest('[data-testid="turn-group"]')).not.toHaveAttribute("data-current-turn")
    expect(screen.getByTestId("conversation-window")).toHaveAttribute("data-anchor-offset", "0")

    // Enter #2 — wraps to the second match and re-pins the window head at
    // its turn: the earlier match's turn is now hidden above the window
    // (turn-navigation anchor semantics), leaving exactly one mark.
    fireEvent.keyDown(screen.getByTestId("timeline-find"), { key: "Enter" })
    expect(screen.getByTestId("find-current-position")).toHaveTextContent("2/2")
    const second = container.querySelectorAll("mark")
    expect(second).toHaveLength(1)
    expect(second[0]).toHaveAttribute("data-testid", "mark-current")
    expect(second[0]?.closest('[data-testid="turn-group"]')).toHaveAttribute(
      "data-turn-id",
      "msg-1",
    )
    expect(second[0]?.closest('[data-testid="turn-group"]')).toHaveAttribute(
      "data-current-turn",
      "true",
    )
    expect(screen.getByTestId("conversation-window")).toHaveAttribute("data-anchor-offset", "1")
    expect(screen.getByTestId("conversation-window")).toHaveAttribute("data-hidden-before", "1")
  })

  it("resets the find cursor when the query changes", () => {
    const { container } = render(
      <ConversationTimeline
        events={[textEv("alpha one"), textEv("alpha two")]}
        workspace={null}
        live={false}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /find/i }))
    const input = screen.getByTestId("timeline-find")
    fireEvent.change(input, { target: { value: "alpha" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(screen.getByTestId("find-current-position")).toBeInTheDocument()

    fireEvent.change(input, { target: { value: "one" } })
    expect(screen.getByText("1 matches")).toBeInTheDocument()
    expect(screen.queryByTestId("find-current-position")).not.toBeInTheDocument()
    expect(container.querySelectorAll('[data-testid="mark-current"]')).toHaveLength(0)
  })

  it("Cmd/Ctrl+F on a toolbar control opens find and Esc leaves find mode entirely", () => {
    const { container } = render(
      <ConversationTimeline events={[textEv("alpha one")]} workspace={null} live={false} />,
    )
    expect(screen.queryByTestId("timeline-find")).toBeNull()
    // The hotkey is bound to the timeline container: the keydown fires on
    // a toolbar button (focus inside) and bubbles up to it.
    fireEvent.keyDown(screen.getByRole("button", { name: /find/i }), { key: "f", metaKey: true })
    expect(screen.getByTestId("timeline-find")).toBeInTheDocument()

    fireEvent.change(screen.getByTestId("timeline-find"), { target: { value: "alpha" } })
    expect(container.querySelectorAll("mark")).toHaveLength(1)

    fireEvent.keyDown(screen.getByTestId("timeline-find"), { key: "Escape" })
    expect(screen.queryByTestId("timeline-find")).toBeNull()
    expect(container.querySelectorAll("mark")).toHaveLength(0)
    expect(screen.queryByText(/matches/)).toBeNull()
  })
})

// ── finishing: tail coexistence, cursor exclusivity, flash-once ─────────────

describe("ConversationTimeline finishing", () => {
  /** user turn + two task turns — the navigator's anchors are [1, 2]. */
  const navEvents = (): RuntimeEvent[] => [
    taskStart("t1", "backend", 1000),
    taskComplete("t1", 2000),
    taskStart("t2", "frontend", 3000),
    taskFailed("t2", "boom"),
  ]

  it("stepping the turn navigator retires the find cursor", () => {
    const { container } = render(
      <ConversationTimeline events={navEvents()} workspace={ws()} live={false} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /find/i }))
    // "t" matches every turn (the request's "the" + the task ids), so the
    // task turns stay displayed and navigable under the filter.
    fireEvent.change(screen.getByTestId("timeline-find"), { target: { value: "t" } })
    fireEvent.keyDown(screen.getByTestId("timeline-find"), { key: "Enter" })
    expect(screen.getByTestId("find-current-position")).toHaveTextContent("1/5")
    expect(container.querySelector('[data-testid="mark-current"]')).not.toBeNull()

    // The navigator steps — the find cursor retires: no current-position
    // readout, no amber current mark. Find itself stays active (the count
    // and the matched-turn filter survive); the user turn's text mark is
    // hidden above the re-pinned window head (anchor = task-t1).
    fireEvent.click(screen.getByRole("button", { name: "next task" }))
    expect(screen.queryByTestId("find-current-position")).toBeNull()
    expect(container.querySelector('[data-testid="mark-current"]')).toBeNull()
    expect(screen.getByText("5 matches")).toBeInTheDocument()
    // And the anchor belongs to the NAVIGATION (task-t1), not find.
    expect(screen.getByTestId("conversation-window")).toHaveAttribute("data-anchor-offset", "1")
  })

  it("stepping find retires the turn navigator's cursor", () => {
    render(<ConversationTimeline events={navEvents()} workspace={ws()} live={false} />)
    // Navigator: first next lands on the first task anchor (offset 1).
    fireEvent.click(screen.getByRole("button", { name: "next task" }))
    expect(screen.getByTestId("conversation-window")).toHaveAttribute("data-anchor-offset", "1")
    // Find steps to its first match — the user turn — taking the anchor.
    fireEvent.click(screen.getByRole("button", { name: /find/i }))
    fireEvent.change(screen.getByTestId("timeline-find"), { target: { value: "t" } })
    fireEvent.keyDown(screen.getByTestId("timeline-find"), { key: "Enter" })
    expect(screen.getByTestId("conversation-window")).toHaveAttribute("data-anchor-offset", "0")
    // The next navigator step starts FRESH: cursor −1 → the FIRST task
    // anchor (task-t1, offset 1) — not a continuation from the abandoned
    // position, which would have jumped on to task-t2 (offset 2).
    fireEvent.click(screen.getByRole("button", { name: "next task" }))
    expect(screen.getByTestId("conversation-window")).toHaveAttribute("data-anchor-offset", "1")
  })

  it("load-earlier while live and attached re-pins the viewport to the tail", () => {
    const many: RuntimeEvent[] = Array.from({ length: 60 }, (_, i) =>
      ev({ type: "task-complete", taskId: `task-${i}` }),
    )
    render(<ConversationTimeline events={many} workspace={null} live={true} />)
    const el = screen.getByTestId("conversation-timeline")
    // Spy on scrollTop assignments (jsdom has no layout): the mount snap
    // already ran; expanding the window ABOVE the viewport must run the
    // tail snap exactly once more — otherwise the attached view is pushed
    // off the bottom while its state still claims to follow the tail.
    const snaps: number[] = []
    let current = el.scrollTop
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      get: () => current,
      set: (v: number) => {
        snaps.push(v)
        current = v
      },
    })
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 2000 })
    fireEvent.click(screen.getByTestId("window-load-earlier"))
    expect(snaps).toEqual([2000])
  })

  it("load-earlier while not live leaves the viewport alone (history reading)", () => {
    const many: RuntimeEvent[] = Array.from({ length: 60 }, (_, i) =>
      ev({ type: "task-complete", taskId: `task-${i}` }),
    )
    render(<ConversationTimeline events={many} workspace={null} live={false} />)
    const el = screen.getByTestId("conversation-timeline")
    const snaps: number[] = []
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      get: () => 0,
      set: (v: number) => snaps.push(v),
    })
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 2000 })
    fireEvent.click(screen.getByTestId("window-load-earlier"))
    expect(screen.getAllByTestId("turn-group")).toHaveLength(60) // expanded
    expect(snaps).toEqual([]) // …without any tail snap
  })

  it("does not re-flash a steering block when find hides and re-shows its turn", () => {
    const events = withTextUnitEvents(
      [
        taskStart("t1"),
        ev({ type: "steering-applied", taskIds: ["t1"], messages: ["nudge: cover retries"] }),
      ],
      null,
    )
    render(<ConversationTimeline events={events} workspace={null} live={false} />)
    expect(screen.getByTestId("text-unit-block")).toHaveAttribute("data-flash", "true")
    // Hide the steering turn behind a hopeless query, then release the
    // filter — the block REMOUNTS with the overlay retired: same unit,
    // one flash ever.
    fireEvent.click(screen.getByRole("button", { name: /find/i }))
    fireEvent.change(screen.getByTestId("timeline-find"), { target: { value: "zzz-none" } })
    expect(screen.queryByTestId("text-unit-block")).toBeNull()
    fireEvent.change(screen.getByTestId("timeline-find"), { target: { value: "" } })
    expect(screen.getByTestId("text-unit-block")).toHaveAttribute("data-flash", "false")
    expect(screen.getByTestId("text-unit-flash")).toHaveClass("opacity-0")
  })
})

// ── windowTurns (deep-surface windowing) ────────────────────────────────────

/** Standalone narration events — each becomes its own `msg-N` turn. */
const msgTurnEvents = (n: number): RuntimeEvent[] =>
  Array.from({ length: n }, (_, i) => textEv(`note ${i}`))

describe("windowTurns", () => {
  it("defaults to the newest 30 turns with the older hidden", () => {
    const win = windowTurns(buildTurnFlowItems(msgTurnEvents(35), null))
    expect(win.turns).toHaveLength(30)
    expect(win.hiddenBefore).toBe(5)
    expect(win.anchorOffset).toBeUndefined()
    // Tail window: the newest turn survives, the oldest hidden one does not.
    expect(win.turns.at(-1)?.turnId).toBe("msg-34")
    expect(win.turns[0]?.turnId).toBe("msg-5")
  })

  it("respects a smaller visibleTurns", () => {
    const win = windowTurns(buildTurnFlowItems(msgTurnEvents(10), null), { visibleTurns: 3 })
    expect(win.turns.map((t) => t.turnId)).toEqual(["msg-7", "msg-8", "msg-9"])
    expect(win.hiddenBefore).toBe(7)
  })

  it("returns an empty window for an empty stream", () => {
    expect(windowTurns([])).toEqual({ turns: [], hiddenBefore: 0, anchorOffset: undefined })
  })

  it("falls back to the default window for negative, zero and non-finite sizes", () => {
    for (const visibleTurns of [-5, 0, Number.NaN, Number.POSITIVE_INFINITY, "3"]) {
      const win = windowTurns(buildTurnFlowItems(msgTurnEvents(40), null), {
        visibleTurns: visibleTurns as number,
      })
      expect(win.turns).toHaveLength(30)
      expect(win.hiddenBefore).toBe(10)
    }
  })

  it("clamps oversized sizes to the full turn list", () => {
    const win = windowTurns(buildTurnFlowItems(msgTurnEvents(4), null), { visibleTurns: 999 })
    expect(win.turns).toHaveLength(4)
    expect(win.hiddenBefore).toBe(0)
  })

  it("floors fractional sizes", () => {
    const win = windowTurns(buildTurnFlowItems(msgTurnEvents(10), null), { visibleTurns: 2.9 })
    expect(win.turns).toHaveLength(2)
  })

  it("pins the window head at the anchor turn", () => {
    const win = windowTurns(buildTurnFlowItems(msgTurnEvents(10), null), {
      visibleTurns: 3,
      anchorTurnId: "msg-4",
    })
    expect(win.turns.map((t) => t.turnId)).toEqual(["msg-4", "msg-5", "msg-6"])
    expect(win.hiddenBefore).toBe(4)
    expect(win.anchorOffset).toBe(4)
  })

  it("clamps the anchored window at the list tail", () => {
    const win = windowTurns(buildTurnFlowItems(msgTurnEvents(10), null), {
      visibleTurns: 3,
      anchorTurnId: "msg-8",
    })
    expect(win.turns.map((t) => t.turnId)).toEqual(["msg-8", "msg-9"])
    expect(win.anchorOffset).toBe(8)
  })

  it("degrades to the tail window when the anchor matches nothing", () => {
    const win = windowTurns(buildTurnFlowItems(msgTurnEvents(6), null), {
      visibleTurns: 2,
      anchorTurnId: "msg-99",
    })
    expect(win.turns.map((t) => t.turnId)).toEqual(["msg-4", "msg-5"])
    expect(win.anchorOffset).toBeUndefined()
    // Non-string anchors are ignored the same way.
    expect(
      windowTurns(buildTurnFlowItems(msgTurnEvents(6), null), {
        visibleTurns: 2,
        anchorTurnId: 42 as unknown as string,
      }).anchorOffset,
    ).toBeUndefined()
  })

  it("honors caller-pinned depths instead of re-deriving them from the window", () => {
    // commander → worker nest: full-stream depths are 1 and 2.
    const nested = [
      taskStart("commander", "general"),
      taskStart("worker", "backend"),
      toolStart("worker", "bash"),
      toolEnd("worker", "bash", { ok: true }),
      taskComplete("worker"),
      taskComplete("commander"),
    ]
    const units = buildTurnFlowItems(nested, null)
    const depth = estimateTurnDepth(units)
    // Filtering to the worker's units alone would lose the open parent
    // and re-derive depth 1 — the pinned map keeps 2.
    const workerOnly = units.filter((u) => u.turnId === "task-worker")
    const win = windowTurns(workerOnly, { visibleTurns: 5, depth })
    expect(win.turns.map((t) => t.depth)).toEqual([2])
    expect(windowTurns(workerOnly, { visibleTurns: 5 }).turns[0]?.depth).toBe(1)
    // The unfiltered stream windows identically with the map passed.
    expect(windowTurns(units, { visibleTurns: 2, depth }).turns.map((t) => t.depth)).toEqual([1, 2])
  })
})

// ── textUnits (text-segment extraction) ─────────────────────────────────────

describe("textUnits", () => {
  it("leads with the workspace user request as a user-sourced unit", () => {
    const units = textUnits([], ws({ userRequest: "Build the login page" }))
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({
      key: "text-user",
      turnId: "user",
      role: "user",
      source: "user",
      text: "Build the login page",
      index: -1,
    })
  })

  it("emits nothing without a workspace request", () => {
    expect(textUnits([], null)).toEqual([])
    expect(textUnits([], ws({ userRequest: undefined as unknown as string }))).toEqual([])
  })

  it("extracts task descriptions into their task turn", () => {
    const units = textUnits(
      [
        taskStart("t1", "backend"),
        ev({ type: "task-start", taskId: "t1", description: "ship it" }),
      ],
      null,
    )
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({
      key: "task-desc-1",
      turnId: "task-t1",
      role: "system",
      source: "system",
      text: "ship it",
      taskId: "t1",
    })
  })

  it("folds repeated descriptions and emits only the change", () => {
    const units = textUnits(
      [
        ev({ type: "task-start", taskId: "t1", description: "v1" }),
        ev({ type: "task-update", taskId: "t1", description: "v1" }), // repeat — folded
        ev({ type: "task-update", taskId: "t1", description: "v2" }), // revision — kept
      ],
      null,
    )
    expect(units.map((u) => u.text)).toEqual(["v1", "v2"])
  })

  it("extracts steering messages as steering units joined to the steered turn", () => {
    const units = textUnits(
      [
        ev({
          type: "steering-applied",
          messages: ["focus on tests", "skip the bench"],
          taskIds: ["t1"],
        }),
      ],
      ws(),
    )
    expect(units).toHaveLength(3) // user request + 2 steering messages
    expect(units[1]).toMatchObject({
      key: "steering-0-0",
      turnId: "task-t1",
      role: "user",
      source: "steering",
      text: "focus on tests",
      taskId: "t1",
    })
    expect(units[2]).toMatchObject({ key: "steering-0-1", text: "skip the bench" })
  })

  it("routes untargeted steering to the system turn and drops malformed payloads", () => {
    const units = textUnits(
      [
        ev({ type: "steering-applied", messages: ["untargeted note"] }),
        ev({ type: "steering-applied", messages: [42, null, "kept"] }),
        ev({ type: "steering-applied" }), // no messages at all
      ],
      null,
    )
    expect(units).toHaveLength(2)
    expect(units[0]).toMatchObject({ turnId: "system", source: "steering" })
    expect(units[1]?.text).toBe("kept")
  })

  it("drops garbage events and keeps stream order", () => {
    const units = textUnits(
      [
        ev({ type: "steering-applied", messages: ["late"], taskIds: ["t2"] }),
        null,
        "junk",
        ev({ type: "task-start", taskId: "t1", description: "desc" }),
      ] as unknown as RuntimeEvent[],
      ws({ userRequest: "the request" }),
    )
    expect(units.map((u) => u.source)).toEqual(["user", "steering", "system"])
    expect(new Set(units.map((u) => u.key)).size).toBe(units.length) // keys unique
  })

  it("survives a non-array stream", () => {
    expect(textUnits(undefined as unknown as RuntimeEvent[], null)).toEqual([])
  })
})

// ── liveTailState (live-tail state machine) ─────────────────────────────────

describe("liveTailState", () => {
  const units = buildTurnFlowItems(msgTurnEvents(5), null)

  it("follows the tail while attached", () => {
    expect(liveTailState(units, false)).toEqual({ followsTail: true, frozenCount: 0 })
  })

  it("treats an undefined detached flag as attached", () => {
    expect(liveTailState(units, undefined)).toEqual({ followsTail: true, frozenCount: 0 })
  })

  it("freezes at the current end when detaching without a freeze point", () => {
    expect(liveTailState(units, true)).toEqual({ followsTail: false, frozenCount: 0 })
  })

  it("counts units that landed after the freeze point while detached", () => {
    expect(liveTailState(units, true, { frozenAt: 3 })).toEqual({
      followsTail: false,
      frozenCount: 2,
    })
  })

  it("clamps freeze points into range", () => {
    expect(liveTailState(units, true, { frozenAt: -7 }).frozenCount).toBe(5) // frozen before everything
    expect(liveTailState(units, true, { frozenAt: 99 }).frozenCount).toBe(0)
    expect(liveTailState(units, true, { frozenAt: Number.NaN }).frozenCount).toBe(0)
    expect(liveTailState(units, true, { frozenAt: 2.9 }).frozenCount).toBe(3)
  })

  it("is defensive about stream shape", () => {
    expect(
      liveTailState(undefined as unknown as ConversationUnit[], true, { frozenAt: 0 }),
    ).toEqual({ followsTail: false, frozenCount: 0 })
    expect(liveTailState([], true, { frozenAt: 0 })).toEqual({
      followsTail: false,
      frozenCount: 0,
    })
  })
})

// ── expansionKeepsTail (windowing x live-tail coexistence) ──────────────────

describe("expansionKeepsTail", () => {
  it("re-pins the tail only for the auto-tail states: live, attached, un-anchored", () => {
    expect(expansionKeepsTail(true, false, false)).toBe(true)
    expect(expansionKeepsTail(true, undefined, undefined)).toBe(true) // attached by default
    // Not live (history reading), detached (scrolled up), or anchored
    // (a turn dive) each keeps the viewport exactly where it is.
    expect(expansionKeepsTail(false, false, false)).toBe(false)
    expect(expansionKeepsTail(undefined, false, false)).toBe(false)
    expect(expansionKeepsTail(true, true, false)).toBe(false)
    expect(expansionKeepsTail(true, false, true)).toBe(false)
  })
})

// ── stepNavigationCursor (turn navigator vs find stepper exclusivity) ───────

describe("stepNavigationCursor", () => {
  it("stepping either navigation retires the other's cursor", () => {
    expect(stepNavigationCursor("turn", 3)).toEqual({ cursor: 3, findCursor: -1 })
    expect(stepNavigationCursor("find", 2)).toEqual({ cursor: -1, findCursor: 2 })
    // The previous cursors are deliberately not consulted: each step is
    // absolute, the OTHER cursor always resets — neither navigation can
    // jump from or highlight a position the other abandoned.
    expect(stepNavigationCursor("turn", 0)).toEqual({ cursor: 0, findCursor: -1 })
  })

  it("floors fractional indexes and degrades garbage to -1 (no position)", () => {
    expect(stepNavigationCursor("turn", 2.9)).toEqual({ cursor: 2, findCursor: -1 })
    expect(stepNavigationCursor("find", Number.NaN)).toEqual({ cursor: -1, findCursor: -1 })
    expect(stepNavigationCursor("find", Number.POSITIVE_INFINITY)).toEqual({
      cursor: -1,
      findCursor: -1,
    })
    expect(stepNavigationCursor("turn", "1" as unknown as number)).toEqual({
      cursor: -1,
      findCursor: -1,
    })
  })
})

// ── shareSections (structured share export) ─────────────────────────────────

describe("shareSections", () => {
  const units = buildTurnFlowItems(
    [
      taskStart("t1", "backend"),
      textEv("starting now", "t1"),
      toolStart("t1", "bash", { command: "ls" }, 1000),
      toolEnd("t1", "bash", { ok: true, durationMs: 120, exitCode: 0 }, 1120),
      retryEv("waiting", 1, 1000),
      retryEv("waiting", 2, 2000, { reason: "still 429" }),
      taskComplete("t1"),
    ],
    ws({ userRequest: "Ship it" }),
  )

  it("builds one section per turn with heading, status and task id", () => {
    const doc = shareSections(units)
    expect(doc.sections.map((s) => s.turnId)).toEqual(["user", "task-t1"])
    expect(doc.sections[0]).toMatchObject({ heading: "user", role: "user" })
    expect(doc.sections[1]).toMatchObject({
      turnId: "task-t1",
      heading: "backend · t1 (completed)",
      taskId: "t1",
      status: "completed",
    })
  })

  it("computes per-section and document stats", () => {
    const doc = shareSections(units)
    expect(doc.sections[1]?.stats).toEqual({ units: 5, texts: 1, tools: 1, retries: 2 })
    expect(doc.stats).toEqual({ turns: 2, units: 6, texts: 2, tools: 1, retries: 2 })
  })

  it("excerpts each section's first text", () => {
    const doc = shareSections(units)
    expect(doc.sections[0]?.excerpt).toBe("Ship it")
    expect(doc.sections[1]?.excerpt).toBe("starting now")
  })

  it("renders an empty document for an empty stream", () => {
    const doc = shareSections([])
    expect(doc.sections).toEqual([])
    expect(doc.stats).toEqual({ turns: 0, units: 0, texts: 0, tools: 0, retries: 0 })
    expect(doc.title).toBe("")
  })

  it("carries the workspace title and caps it", () => {
    expect(shareSections(units, { workspaceTitle: "Ship it" }).title).toBe("Ship it")
    const long = "x".repeat(300)
    expect(shareSections(units, { workspaceTitle: long }).title).toHaveLength(120)
  })

  it("serializes to markdown matching the flat exporter's line format", () => {
    const md = toShareMarkdown(shareSections(units, { workspaceTitle: "Ship it" }))
    expect(md).toContain("# Maximilian conversation — Ship it")
    expect(md).toContain("_2 turns · 6 units · 1 tool calls · 2 retry attempts_")
    expect(md).toContain("## backend · t1 (completed)")
    expect(md).toContain("- `bash` · 120ms · exit 0")
    expect(md).toContain("- retry: waiting ×2 · 3000ms total — still 429")
    expect(md).toContain("- status: completed")
  })

  it("appends stamps only on request and keeps marker units out of the body", () => {
    const doc = shareSections(units, { includeTimestamps: true })
    const md = toShareMarkdown(doc)
    expect(md).toContain("1970-01-01T00:00:01.000Z")
    // The task marker unit contributes the heading, never a body line.
    expect(doc.sections.map((s) => s.lines.length)).toEqual([1, 4])
  })
})

// ── estimateVirtualHeight (virtual-scroll budget) ───────────────────────────

describe("estimateVirtualHeight", () => {
  it("is zero for an empty stream", () => {
    expect(estimateVirtualHeight([], 28)).toBe(0)
  })

  it("scales text units with their wrapped-line estimate", () => {
    const oneLine: ConversationUnit = {
      kind: "text",
      key: "a",
      turnId: "user",
      role: "user",
      index: 0,
      text: "short",
    }
    expect(estimateVirtualHeight([oneLine], 10)).toBe(10) // 1 row
    const multiline: ConversationUnit = { ...oneLine, text: "a\nb\nc" }
    expect(estimateVirtualHeight([multiline], 10)).toBe(30) // 3 rows
  })

  it("wraps long single-line text across the 80-column estimate", () => {
    const long: ConversationUnit = {
      kind: "text",
      key: "a",
      turnId: "user",
      role: "user",
      index: 0,
      text: "x".repeat(160),
    }
    expect(estimateVirtualHeight([long], 10)).toBe(20) // 2 wrapped rows
  })

  it("weights structural units by kind (tool 2 rows, marker 1)", () => {
    const units = buildTurnFlowItems(
      [taskStart("t1"), toolStart("t1", "bash"), toolEnd("t1", "bash", { ok: true })],
      null,
    )
    // Marker + folded tool = 1 + 2 rows.
    expect(estimateVirtualHeight(units, 10)).toBe(30)
  })

  it("falls back to the default row height for invalid heights", () => {
    const units = buildTurnFlowItems(msgTurnEvents(2), null)
    expect(estimateVirtualHeight(units)).toBe(2 * 28)
    expect(estimateVirtualHeight(units, -4)).toBe(2 * 28)
    expect(estimateVirtualHeight(units, Number.NaN)).toBe(2 * 28)
  })

  it("is defensive about stream shape", () => {
    expect(estimateVirtualHeight(null as unknown as ConversationUnit[], 28)).toBe(0)
  })
})

// ── perItemHeight (per-unit virtual-height estimate) ────────────────────────

describe("perItemHeight", () => {
  it("aligns 1:1 with the input and sums to estimateVirtualHeight", () => {
    const units = buildTurnFlowItems(
      [
        taskStart("t1"),
        textEv("a note", "t1"),
        toolStart("t1", "bash"),
        toolEnd("t1", "bash", { ok: true }),
      ],
      null,
    )
    const heights = perItemHeight(units, 10)
    expect(heights).toHaveLength(units.length)
    expect(heights.reduce((sum, h) => sum + h, 0)).toBe(estimateVirtualHeight(units, 10))
  })

  it("scales text units by their wrapped-line estimate", () => {
    const oneLine: ConversationUnit = {
      kind: "text",
      key: "a",
      turnId: "user",
      role: "user",
      index: 0,
      text: "short",
    }
    expect(perItemHeight([oneLine], 12)).toEqual([12])
    const wrapped = { ...oneLine, text: "x".repeat(160) } // 2 wrapped rows
    expect(perItemHeight([wrapped], 12)).toEqual([24])
  })

  it("weights structural units by kind (tool 2 rows, marker 1)", () => {
    const heights = perItemHeight(
      buildTurnFlowItems([taskStart("t1"), toolStart("t1", "bash"), toolEnd("t1", "bash")], null),
      10,
    )
    expect(heights).toEqual([10, 20]) // task marker, folded tool
  })

  it("counts malformed entries as 0 without breaking alignment", () => {
    const junk = [null, 42, "junk"] as unknown as ConversationUnit[]
    expect(perItemHeight(junk, 28)).toEqual([0, 0, 0])
    expect(perItemHeight(undefined as unknown as ConversationUnit[], 28)).toEqual([])
  })

  it("falls back to the default row height for invalid heights", () => {
    const units = buildTurnFlowItems(msgTurnEvents(2), null)
    expect(perItemHeight(units, -4)).toEqual([28, 28])
    expect(perItemHeight(units, Number.NaN)).toEqual([28, 28])
    expect(perItemHeight(units)).toEqual([28, 28])
  })
})

// ── turnHeight (per-turn virtual-height estimate) ───────────────────────────

describe("turnHeight", () => {
  it("sums the per-unit estimates of one turn's units", () => {
    const units = buildTurnFlowItems(
      [taskStart("t1"), toolStart("t1", "bash"), toolEnd("t1", "bash", { ok: true })],
      null,
    )
    const [turn] = groupUnitsByTurn(units)
    // Marker (1 row) + folded tool (2 rows) at 10px per row.
    expect(turn?.units).toHaveLength(2)
    expect(turnHeight(turn, 10)).toBe(30)
  })

  it("scales text rows with wrapping and the row height", () => {
    const [plain] = groupUnitsByTurn(buildTurnFlowItems(msgTurnEvents(1), null))
    expect(turnHeight(plain)).toBe(28) // default row height
    expect(turnHeight(plain, 12)).toBe(12)
    const wrapped = buildTurnFlowItems([textEv("x".repeat(160))], null) // 2 wrapped rows
    expect(turnHeight(groupUnitsByTurn(wrapped)[0], 10)).toBe(20)
  })

  it("counts malformed turns and missing unit lists as 0", () => {
    expect(turnHeight(null)).toBe(0)
    expect(turnHeight(undefined)).toBe(0)
    expect(turnHeight(42 as unknown as { units?: ConversationUnit[] })).toBe(0)
    expect(turnHeight({} as { units?: ConversationUnit[] })).toBe(0)
    expect(turnHeight({ units: "junk" as unknown as ConversationUnit[] })).toBe(0)
    expect(turnHeight({ units: [] }, 28)).toBe(0)
  })

  it("falls back to the default row height for invalid heights", () => {
    const [turn] = groupUnitsByTurn(buildTurnFlowItems(msgTurnEvents(1), null))
    expect(turnHeight(turn, -3)).toBe(28)
    expect(turnHeight(turn, Number.NaN)).toBe(28)
  })

  it("sums per-turn to estimateVirtualHeight across a whole stream", () => {
    const units = buildTurnFlowItems(
      [
        taskStart("t1"),
        textEv("a note", "t1"),
        toolStart("t1", "bash"),
        toolEnd("t1", "bash", { ok: true }),
        textEv("tail note"),
      ],
      null,
    )
    const total = groupUnitsByTurn(units).reduce((sum, turn) => sum + turnHeight(turn, 10), 0)
    expect(total).toBe(estimateVirtualHeight(units, 10))
  })
})

// ── formatEstimatedHeight (human-readable pixel estimate) ───────────────────

describe("formatEstimatedHeight", () => {
  it("keeps sub-kilopixel estimates in plain pixels", () => {
    expect(formatEstimatedHeight(0)).toBe("0 px")
    expect(formatEstimatedHeight(28)).toBe("28 px")
    expect(formatEstimatedHeight(999.6)).toBe("1000 px")
  })

  it("renders kilopixel estimates with one decimal and defends garbage", () => {
    expect(formatEstimatedHeight(11200)).toBe("11.2k px")
    expect(formatEstimatedHeight(8000)).toBe("8k px")
    expect(formatEstimatedHeight(123456)).toBe("123k px")
    expect(formatEstimatedHeight(-5)).toBe("0 px")
    expect(formatEstimatedHeight(Number.NaN)).toBe("0 px")
  })
})

// ── ConversationWindow rendering ────────────────────────────────────────────

describe("ConversationWindow rendering", () => {
  it("renders the newest window with a load-earlier affordance that grows it", () => {
    const units = buildTurnFlowItems(msgTurnEvents(8), null)
    render(<ConversationWindow units={units} visibleTurns={3} />)
    expect(screen.getAllByTestId("turn-group")).toHaveLength(3)
    const rows = screen.getByTestId("conversation-window").querySelectorAll("[data-window-index]")
    expect(rows[0]).toHaveAttribute("data-window-index", "5")
    expect(screen.getByTestId("window-load-earlier")).toHaveTextContent("Load 5 earlier turns")
    fireEvent.click(screen.getByTestId("window-load-earlier"))
    expect(screen.getAllByTestId("turn-group")).toHaveLength(8)
    expect(screen.queryByTestId("window-load-earlier")).not.toBeInTheDocument()
  })

  it("caps the load-earlier label at the hidden count", () => {
    const units = buildTurnFlowItems(msgTurnEvents(4), null)
    render(<ConversationWindow units={units} visibleTurns={3} loadStep={10} />)
    expect(screen.getByTestId("window-load-earlier")).toHaveTextContent("Load 1 earlier turns")
  })

  it("renders per-turn placeholder bars and the height hint from the timeline's budget", () => {
    const units = buildTurnFlowItems(msgTurnEvents(4), null)
    const turnHeights = new Map<string, number>(
      groupUnitsByTurn(units).map((turn) => [turn.turnId, perItemHeight(turn.units)[0] ?? 0]),
    )
    render(
      <ConversationWindow
        units={units}
        visibleTurns={3}
        turnHeights={turnHeights}
        loadEarlierHint="≈ 112 px est."
      />,
    )
    // One bar per RENDERED turn (the window, not the full list), each
    // sized to that turn's estimated height.
    const spacers = screen.getAllByTestId("window-height-spacer")
    expect(spacers).toHaveLength(3)
    expect(spacers[0]).toHaveAttribute("data-spacer-height", "28")
    expect(spacers[0]).toHaveStyle({ height: "28px" })
    expect(spacers[0]).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByTestId("window-load-earlier")).toHaveTextContent("≈ 112 px est.")
  })

  it("shows the empty state for an empty stream", () => {
    render(<ConversationWindow units={[]} />)
    expect(screen.getByTestId("conversation-window-empty")).toBeInTheDocument()
    expect(screen.queryByTestId("turn-group")).not.toBeInTheDocument()
  })

  it("anchors the window on the anchor turn and offers the release affordance", () => {
    let scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    const onClearAnchor = vi.fn()
    try {
      const units = buildTurnFlowItems(msgTurnEvents(6), null)
      render(
        <ConversationWindow
          units={units}
          visibleTurns={2}
          anchorTurnId="msg-2"
          onClearAnchor={onClearAnchor}
        />,
      )
      expect(screen.getAllByTestId("turn-group")).toHaveLength(2)
      const rows = screen.getByTestId("conversation-window").querySelectorAll("[data-window-index]")
      expect(rows[0]).toHaveAttribute("data-window-index", "2")
      expect(rows[0]).toHaveTextContent("note 2")
      expect(screen.getByTestId("conversation-window")).toHaveAttribute("data-anchor-offset", "2")
      // The anchored turn scrolled into view on mount.
      expect(scrolled).toHaveLength(1)
      expect(scrolled[0]).toHaveAttribute("data-window-index", "2")
      fireEvent.click(screen.getByTestId("window-clear-anchor"))
      expect(onClearAnchor).toHaveBeenCalledTimes(1)
    } finally {
      Element.prototype.scrollIntoView = original
      scrolled = []
    }
  })

  it("falls back to the tail window for an unknown anchor", () => {
    const units = buildTurnFlowItems(msgTurnEvents(6), null)
    render(<ConversationWindow units={units} visibleTurns={2} anchorTurnId="msg-99" />)
    expect(screen.getAllByTestId("turn-group")[0]).toHaveTextContent("note 4")
    expect(screen.getByTestId("conversation-window")).not.toHaveAttribute("data-anchor-offset")
    expect(screen.queryByTestId("window-clear-anchor")).not.toBeInTheDocument()
  })
})

// ── TextUnitBlock rendering ─────────────────────────────────────────────────

describe("TextUnitBlock rendering", () => {
  const unit = (over: Partial<ExtractedTextUnit>): ExtractedTextUnit => ({
    key: "k",
    turnId: "user",
    role: "user",
    source: "user",
    text: "body text",
    index: 0,
    ...over,
  })

  it("distinguishes the three sources with data attributes and labels", () => {
    for (const source of ["user", "steering", "system"] as const) {
      render(<TextUnitBlock unit={unit({ source, turnId: "task-t1", taskId: "t1" })} />)
      expect(screen.getByTestId("text-unit-block")).toHaveAttribute("data-source", source)
      expect(screen.getByTestId("text-unit-source")).toHaveTextContent(
        { user: "Request", steering: "Steering", system: "System" }[source],
      )
      expect(screen.getByTestId("text-unit-body")).toHaveTextContent("body text")
      expect(screen.getByText("t1")).toBeInTheDocument()
      cleanup()
    }
  })

  it("localizes the source label under zh-CN", () => {
    setLocale("zh-CN")
    render(<TextUnitBlock unit={unit({ source: "steering" })} />)
    expect(screen.getByTestId("text-unit-source")).toHaveTextContent("引导")
  })

  it("keeps multi-line body text pre-wrapped", () => {
    render(<TextUnitBlock unit={unit({ text: "line one\nline two" })} />)
    const body = screen.getByTestId("text-unit-body")
    expect(body).toHaveClass("whitespace-pre-wrap")
    expect(body).toHaveTextContent("line one")
  })
})

// ── ShareView rendering ─────────────────────────────────────────────────────

describe("ShareView rendering", () => {
  const shareUnits = (): ConversationUnit[] =>
    buildTurnFlowItems(
      [
        taskStart("t1", "backend"),
        toolStart("t1", "bash", { command: "ls" }, 1000),
        toolEnd("t1", "bash", { ok: true, durationMs: 20 }, 1020),
        taskComplete("t1"),
      ],
      ws({ userRequest: "Ship it" }),
    )

  it("renders sections with headings, stats and bodies, read-only", () => {
    render(<ShareView units={shareUnits()} workspaceTitle="Ship it" />)
    expect(screen.getByTestId("share-view")).toBeInTheDocument()
    expect(screen.getByTestId("share-title")).toHaveTextContent("Ship it")
    expect(screen.getByTestId("share-stats")).toHaveTextContent("2 turns")
    const sections = screen.getAllByTestId("share-section")
    expect(sections).toHaveLength(2)
    const headings = screen.getAllByTestId("share-section-heading")
    expect(headings[0]).toHaveTextContent("user")
    expect(headings[1]).toHaveTextContent("backend · t1 (completed)")
    const sectionStats = screen.getAllByTestId("share-section-stats")
    expect(sectionStats[0]).toHaveTextContent("1 units · 0 tool calls")
    expect(sectionStats[1]).toHaveTextContent("3 units · 1 tool calls")
    expect(screen.getByTestId("share-excerpt")).toHaveTextContent("Ship it")
    const bodies = screen.getAllByTestId("share-body")
    expect(bodies).toHaveLength(2) // user text + task units, both sections carry a body
    expect(bodies[1]).toHaveTextContent("- `bash` · 20ms")
    // Read-only: the only control is the copy button.
    expect(screen.getAllByRole("button")).toHaveLength(1)
  })

  it("copies the structured markdown and confirms", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    render(<ShareView units={shareUnits()} workspaceTitle="Ship it" />)
    fireEvent.click(screen.getByTestId("share-copy"))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const md = writeText.mock.calls[0]?.[0] ?? ""
    expect(md).toContain("# Maximilian conversation — Ship it")
    expect(md).toContain("## backend · t1 (completed)")
    expect(await screen.findByTestId("share-copy")).toHaveTextContent("Copied")
  })

  it("stays unconfirmed when the clipboard rejects", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("no"))
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    render(<ShareView units={shareUnits()} />)
    fireEvent.click(screen.getByTestId("share-copy"))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId("share-copy")).toHaveTextContent("Copy as markdown")
    expect(screen.queryByText(/Copied/)).not.toBeInTheDocument()
  })

  it("shows the empty state for an empty stream", () => {
    render(<ShareView units={[]} />)
    expect(screen.getByTestId("share-empty")).toBeInTheDocument()
    expect(screen.queryByTestId("share-section")).not.toBeInTheDocument()
  })
})

// ── virtualWindow (true virtual scrolling arithmetic) ───────────────────────

describe("virtualWindow", () => {
  /** 10 units × 28px — cum tops: 0,28,56,…,252; total 280. */
  const units10 = buildTurnFlowItems(msgTurnEvents(10), null)
  const hs28 = (n: number): number[] => Array.from({ length: n }, () => 28)

  it("zeroes out for an empty (or non-array) stream", () => {
    expect(virtualWindow([], hs28(0), 0, 500)).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
      total: 0,
    })
    expect(
      virtualWindow(undefined as unknown as ConversationUnit[], undefined, 100, 500),
    ).toMatchObject({ start: 0, end: 0, total: 0 })
  })

  it("shows everything when the viewport is at least the total height", () => {
    expect(virtualWindow(units10, hs28(10), 0, 300)).toEqual({
      start: 0,
      end: 10,
      padTop: 0,
      padBottom: 0,
      total: 280,
    })
    // Viewport larger than the stream: same full window, scroll clamped.
    expect(virtualWindow(units10, hs28(10), 9999, 5000).end).toBe(10)
  })

  it("windows the middle of the stream at the scroll position", () => {
    // scroll 140: units 0-4 (cum 140) fully above → start 5; viewport
    // bottom 252 lands on unit 9's top → end 9; overscan 2 → [3, 10).
    expect(virtualWindow(units10, hs28(10), 140, 112, 2)).toEqual({
      start: 3,
      end: 10,
      padTop: 84,
      padBottom: 0,
      total: 280,
    })
    // At the head the same math yields the top window.
    expect(virtualWindow(units10, hs28(10), 0, 112, 2)).toEqual({
      start: 0,
      end: 6,
      padTop: 0,
      padBottom: 112,
      total: 280,
    })
  })

  it("clamps a scrollTop beyond the total height to the tail window", () => {
    // scroll clamps to 280−112=168: units 0-5 above → start 6, end 10 —
    // the last viewport worth, never blank.
    const win = virtualWindow(units10, hs28(10), 99999, 112, 2)
    expect(win.start).toBe(4)
    expect(win.end).toBe(10)
    expect(win.padTop).toBe(112)
    expect(win.padBottom).toBe(0)
    // Negative scroll clamps to the head the same way.
    expect(virtualWindow(units10, hs28(10), -50, 112, 0).start).toBe(0)
  })

  it("extends the window by the overscan and clamps at the stream bounds", () => {
    // viewport 28 → 1 visible unit at the head; overscan 99 tries to
    // reach past both ends but clamps to the whole stream.
    expect(virtualWindow(units10, hs28(10), 0, 28, 99)).toMatchObject({ start: 0, end: 10 })
  })

  it("falls back to the default overscan for invalid values and floors fractions", () => {
    // viewport 28, overscan 4 → [0, 5), padBottom 280 − 140.
    for (const overscan of [-3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(virtualWindow(units10, hs28(10), 0, 28, overscan)).toMatchObject({
        start: 0,
        end: 5,
        padBottom: 140,
      })
    }
    expect(virtualWindow(units10, hs28(10), 0, 28, 2.9)).toMatchObject({ end: 3 }) // floor(2.9)
    expect(DEFAULT_VIRTUAL_OVERSCAN).toBe(4)
  })

  it("coerces malformed heights to the default row height, keeping alignment", () => {
    const junk = [28, Number.NaN, -5] as unknown as number[]
    const win = virtualWindow(units10.slice(0, 3), junk, 0, 28, 0)
    expect(win.total).toBe(84) // every entry coerced to VIRTUAL_ROW_HEIGHT
    expect(win).toMatchObject({ start: 0, end: 1, padTop: 0, padBottom: 56 })
    // Missing entries fall back the same way: 10 units, 1 given height.
    expect(virtualWindow(units10, [28], 0, 280, 0).total).toBe(280)
  })

  it("degenerates sanely for a zero viewport", () => {
    // Nothing is strictly visible, but the overscan band still renders —
    // never a blank container.
    const win = virtualWindow(units10, hs28(10), 0, 0, 1)
    expect(win.start).toBe(0)
    expect(win.end).toBe(1)
  })

  it("keeps pads + window consistent with the total (spacer math)", () => {
    const win = virtualWindow(units10, hs28(10), 70, 112, 0)
    expect(win.end - win.start).toBeGreaterThan(0)
    expect(win.padTop + win.padBottom).toBeLessThanOrEqual(win.total)
    // The rendered band spans exactly total − padTop − padBottom.
    let rendered = 0
    for (let i = win.start; i < win.end; i++) rendered += 28
    expect(rendered).toBe(win.total - win.padTop - win.padBottom)
  })
})

// ── scrollOffsetForUnit (anchor jumps) ──────────────────────────────────────

describe("scrollOffsetForUnit", () => {
  const units10 = buildTurnFlowItems(msgTurnEvents(10), null)
  const hs28 = (n: number): number[] => Array.from({ length: n }, () => 28)

  it("is 0 for the first unit, empty streams and non-array input", () => {
    expect(scrollOffsetForUnit(units10, hs28(10), 0)).toBe(0)
    expect(scrollOffsetForUnit([], hs28(0), 3)).toBe(0)
    expect(scrollOffsetForUnit(undefined as unknown as ConversationUnit[], undefined, 3)).toBe(0)
  })

  it("sums the heights above the target unit", () => {
    expect(scrollOffsetForUnit(units10, hs28(10), 3)).toBe(84)
    expect(scrollOffsetForUnit(units10, hs28(10), 3.9)).toBe(84) // floored
    // Mixed estimates: 28 + 56 above unit 2.
    expect(scrollOffsetForUnit(units10.slice(0, 3), [28, 56, 112], 2)).toBe(84)
  })

  it("clamps to the tail for indexes at or past the end, and guards garbage", () => {
    expect(scrollOffsetForUnit(units10, hs28(10), 10)).toBe(280)
    expect(scrollOffsetForUnit(units10, hs28(10), 999)).toBe(280)
    expect(scrollOffsetForUnit(units10, hs28(10), -5)).toBe(0)
    expect(scrollOffsetForUnit(units10, hs28(10), Number.NaN)).toBe(0)
  })

  it("agrees with virtualWindow: the offset lands the unit at the window head", () => {
    const hs = hs28(10)
    for (const index of [1, 4, 7]) {
      const offset = scrollOffsetForUnit(units10, hs, index)
      const win = virtualWindow(units10, hs, offset, 56, 0)
      expect(win.start).toBe(index)
    }
  })
})

// ── VirtualTurnWindow (true virtual scrolling container) ────────────────────

describe("VirtualTurnWindow rendering", () => {
  const turnsOf = (n: number) => groupUnitsByTurn(buildTurnFlowItems(msgTurnEvents(n), null))
  const hs28 = (n: number): number[] => Array.from({ length: n }, () => 28)
  const rowRender = (unit: { turnId: string }, index: number): ReactNode => (
    <div data-testid="virtual-row">{`${unit.turnId}:${index}`}</div>
  )

  it("renders only the visible band inside a full-height spacer", () => {
    const { container } = render(
      <VirtualTurnWindow
        units={turnsOf(10)}
        heights={hs28(10)}
        viewportHeight={112}
        overscan={0}
        renderUnit={rowRender}
      />,
    )
    const spacer = screen.getByTestId("virtual-turn-window-spacer")
    expect(spacer).toHaveAttribute("data-total-height", "280")
    expect(spacer).toHaveStyle({ height: "280px" })
    const rows = container.querySelectorAll("[data-virtual-index]")
    expect(rows).toHaveLength(4) // 112px viewport / 28px rows
    expect(rows[0]).toHaveAttribute("data-virtual-index", "0")
    expect(rows[0]).toHaveStyle({ transform: "translateY(0px)" })
    expect(rows[1]).toHaveStyle({ transform: "translateY(28px)" })
    expect(rows[3]).toHaveStyle({ transform: "translateY(84px)" })
    expect(screen.getAllByTestId("virtual-row")[0]).toHaveTextContent("msg-0:0")
  })

  it("moves the window on scroll (pads and rendered range follow)", () => {
    const { container } = render(
      <VirtualTurnWindow
        units={turnsOf(10)}
        heights={hs28(10)}
        viewportHeight={112}
        overscan={0}
        renderUnit={rowRender}
      />,
    )
    const el = screen.getByTestId("virtual-turn-window")
    el.scrollTop = 140
    fireEvent.scroll(el)
    // scroll 140 → [5, 9): padTop 84 above, 0 below.
    const spacer = screen.getByTestId("virtual-turn-window-spacer")
    expect(spacer).toHaveAttribute("data-window-start", "5")
    expect(spacer).toHaveAttribute("data-window-end", "9")
    const rows = container.querySelectorAll("[data-virtual-index]")
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveAttribute("data-virtual-index", "5")
    expect(rows[0]).toHaveStyle({ transform: "translateY(140px)" })
    expect(screen.getByText("msg-8:8")).toBeInTheDocument()
    expect(screen.queryByText("msg-0:0")).not.toBeInTheDocument()
  })

  it("jumps to the anchored index via scrollOffsetForUnit", () => {
    const turns = turnsOf(10)
    const hs = hs28(10)
    const { rerender, container } = render(
      <VirtualTurnWindow
        units={turns}
        heights={hs}
        viewportHeight={112}
        overscan={0}
        renderUnit={rowRender}
      />,
    )
    expect(container.querySelectorAll("[data-virtual-index]")[0]).toHaveAttribute(
      "data-virtual-index",
      "0",
    )
    // Anchor at unit 4 → scrollTop 4 × 28 = 112 → the window re-anchors.
    rerender(
      <VirtualTurnWindow
        units={turns}
        heights={hs}
        viewportHeight={112}
        overscan={0}
        anchorIndex={4}
        renderUnit={rowRender}
      />,
    )
    expect(screen.getByTestId("virtual-turn-window").scrollTop).toBe(112)
    expect(screen.getByTestId("virtual-turn-window-spacer")).toHaveAttribute(
      "data-window-start",
      "4",
    )
  })

  it("renders the empty node for an empty stream", () => {
    render(
      <VirtualTurnWindow
        units={[]}
        heights={[]}
        viewportHeight={112}
        renderUnit={rowRender}
        empty={<p data-testid="virtual-empty">nothing here</p>}
      />,
    )
    expect(screen.getByTestId("virtual-turn-window-empty")).toBeInTheDocument()
    expect(screen.queryByTestId("virtual-turn-window-spacer")).not.toBeInTheDocument()
  })

  it("keeps the overscan band beyond the viewport edges", () => {
    render(
      <VirtualTurnWindow
        units={turnsOf(10)}
        heights={hs28(10)}
        viewportHeight={28} // 1 strictly visible unit
        overscan={2}
        renderUnit={rowRender}
      />,
    )
    // 1 + 2 overscan above/below, clamped at the head → [0, 3).
    expect(screen.getByTestId("virtual-turn-window-spacer")).toHaveAttribute("data-window-end", "3")
  })
})

// ── ConversationTimeline virtualized mode (true virtual scrolling) ──────────

describe("ConversationTimeline virtualized mode", () => {
  /** user turn (28px) + two completed task turns (56px each). */
  const twoTasks = (): RuntimeEvent[] => [
    taskStart("t1", "backend", 1000),
    taskComplete("t1", 2000),
    taskStart("t2", "frontend", 3000),
    taskComplete("t2", 4000),
  ]

  it("switches containers: virtualized renders the spacer, default the window", () => {
    const { rerender } = render(
      <ConversationTimeline
        events={twoTasks()}
        workspace={ws()}
        live={false}
        virtualized
        viewportHeight={500}
      />,
    )
    expect(screen.getByTestId("conversation-timeline-spacer")).toHaveAttribute(
      "data-total-height",
      "140", // 28 + 56 + 56
    )
    expect(screen.getAllByTestId("turn-group")).toHaveLength(3) // user + t1 + t2
    expect(screen.queryByTestId("conversation-window")).not.toBeInTheDocument()

    // Default (virtualized omitted) keeps the windowed DOM — no regression.
    rerender(<ConversationTimeline events={twoTasks()} workspace={ws()} live={false} />)
    expect(screen.getByTestId("conversation-window")).toBeInTheDocument()
    expect(screen.queryByTestId("conversation-timeline-spacer")).not.toBeInTheDocument()
  })

  it("turn navigation anchors by scrollOffsetForUnit offsets", () => {
    render(
      <ConversationTimeline
        events={twoTasks()}
        workspace={ws()}
        live={false}
        virtualized
        viewportHeight={100}
      />,
    )
    const el = screen.getByTestId("conversation-timeline")
    expect(el.scrollTop).toBe(0)
    // task-t1 is turn index 1 → its offset is the user turn's 28px.
    fireEvent.click(screen.getByRole("button", { name: "next task" }))
    expect(el.scrollTop).toBe(28)
    // task-t2 is turn index 2 → 28 + 56.
    fireEvent.click(screen.getByRole("button", { name: "next task" }))
    expect(el.scrollTop).toBe(84)
  })

  it("scrolling renders the tail band and drops the head rows", () => {
    const many = msgTurnEvents(60) // 60 turns × 28px = 1680
    render(
      <ConversationTimeline
        events={many}
        workspace={null}
        live={false}
        virtualized
        viewportHeight={200}
      />,
    )
    expect(screen.getByText("note 0")).toBeInTheDocument()
    const el = screen.getByTestId("conversation-timeline")
    el.scrollTop = 1680 // clamp → scroll 1480 → band [48, 60) w/ overscan 4
    fireEvent.scroll(el)
    expect(screen.getByTestId("conversation-timeline-spacer")).toHaveAttribute(
      "data-window-start",
      "48",
    )
    expect(screen.getByText("note 59")).toBeInTheDocument()
    expect(screen.queryByText("note 0")).not.toBeInTheDocument()
  })

  it("find filtering still narrows the virtualized stream", () => {
    render(
      <ConversationTimeline
        events={[
          taskStart("t1", "backend", 1000),
          toolStart("t1", "bash", { command: "grep Login src/auth.ts" }, 1100),
          toolEnd("t1", "bash", { ok: true, durationMs: 20 }, 1120),
          taskComplete("t1", 2500),
        ]}
        workspace={ws()}
        live={false}
        virtualized
        viewportHeight={500}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /find/i }))
    fireEvent.change(screen.getByTestId("timeline-find"), { target: { value: "login" } })
    expect(screen.getByText("2 matches")).toBeInTheDocument()
    const groups = screen.getAllByTestId("turn-group")
    expect(groups.map((g) => g.getAttribute("data-turn-id"))).toEqual(["user", "task-t1"])
  })

  it("live-tail detachment and the jump affordance survive virtualization", () => {
    const { rerender } = render(
      <ConversationTimeline
        events={msgTurnEvents(2)}
        workspace={null}
        live={true}
        virtualized
        viewportHeight={500}
      />,
    )
    const el = screen.getByTestId("conversation-timeline")
    pinScrollMetrics(el, 10000, 500)
    el.scrollTop = 1000 // 10000 − 1000 − 500 ≥ 48 → detached
    fireEvent.scroll(el)
    rerender(
      <ConversationTimeline
        events={msgTurnEvents(4)}
        workspace={null}
        live={true}
        virtualized
        viewportHeight={500}
      />,
    )
    expect(screen.getByTestId("jump-to-latest")).toHaveTextContent("+2")
    fireEvent.click(screen.getByTestId("jump-to-latest"))
    expect(screen.queryByTestId("jump-to-latest")).not.toBeInTheDocument()
  })
})

// ── withTextUnitEvents (text units into the render chain) ───────────────────

describe("withTextUnitEvents", () => {
  it("splices steering segments as tagged synthetic text events at their source position", () => {
    const events = [
      taskStart("t1"),
      toolStart("t1", "bash"),
      toolEnd("t1", "bash"),
      ev({ type: "steering-applied", taskIds: ["t1"], messages: ["focus auth", "skip bench"] }),
    ]
    const out = withTextUnitEvents(events, null)
    expect(out).toHaveLength(events.length + 2)
    // Synthetic events precede the steering-applied event, in ordinal order.
    expect(out[3]).toMatchObject({
      type: "text",
      text: "focus auth",
      taskId: "t1",
      [TEXT_SOURCE_FIELD]: "steering",
    })
    expect(out[4]).toMatchObject({ type: "text", text: "skip bench" })
    // The original stream events pass through untouched, in order.
    expect(out[0]).toBe(events[0])
    expect(out[5]).toBe(events[3])
  })

  it("drops the user request (already led with) and returns the same reference with nothing to merge", () => {
    const plain = [taskStart("t1")]
    // Only the user-sourced unit would be extracted → same array reference.
    expect(withTextUnitEvents(plain, ws())).toBe(plain)
    const empty: RuntimeEvent[] = []
    expect(withTextUnitEvents(empty, null)).toBe(empty)
  })

  it("compiles into source-stamped text units joined to the steered turn ahead of later units", () => {
    const events = [
      taskStart("t1"),
      ev({ type: "steering-applied", taskIds: ["t1"], messages: ["steer mid-run"] }),
      textEv("narration after steering", "t1"),
    ]
    const compiled = buildTurnFlowItems(withTextUnitEvents(events, null), null)
    const texts = compiled.filter(
      (u): u is Extract<ConversationUnit, { kind: "text" }> => u.kind === "text",
    )
    expect(texts).toHaveLength(2)
    expect(texts[0]).toMatchObject({
      turnId: "task-t1",
      source: "steering",
      text: "steer mid-run",
    })
    // Ordinary narration stays unstyled (no provenance stamp).
    expect(texts[1]).toMatchObject({ turnId: "task-t1", text: "narration after steering" })
    expect(texts[1].source).toBeUndefined()
    // Stream order: the steering segment precedes the later narration.
    expect(texts[0].index).toBeLessThan(texts[1].index)
  })
})

// ── markFirstSeen (steering flash-once registry) ────────────────────────────

describe("markFirstSeen", () => {
  it("marks the first sighting fresh and later sightings stale with the original timestamp", () => {
    const first = markFirstSeen(["steering-1-0", "steering-1-1"], undefined, 1000, "w1")
    expect(first.marks).toEqual([
      { key: "steering-1-0", firstSeenAt: 1000, fresh: true },
      { key: "steering-1-1", firstSeenAt: 1000, fresh: true },
    ])
    // The replay (workspace switch re-delivering the stream) keeps the
    // FIRST-seen timestamp and retires the flash.
    const second = markFirstSeen(["steering-1-0"], first.seen, 5000, "w1")
    expect(second.marks).toEqual([{ key: "steering-1-0", firstSeenAt: 1000, fresh: false }])
    // The returned registry is the accumulated one.
    expect(second.seen.get("w1\u0000steering-1-0")).toBe(1000)
    expect(second.seen.get("w1\u0000steering-1-1")).toBe(1000)
  })

  it("scopes the registry per stream so two workspaces never silence each other", () => {
    const w1 = markFirstSeen(["steering-0-0"], undefined, 10, "w1")
    // Same stream again → suppressed (the replay case).
    expect(markFirstSeen(["steering-0-0"], w1.seen, 20, "w1").marks[0]?.fresh).toBe(false)
    // The position-derived key collides across workspaces, but the other
    // stream has never seen it → fresh.
    expect(markFirstSeen(["steering-0-0"], w1.seen, 30, "w2").marks[0]?.fresh).toBe(true)
  })

  it("is pure and defensive: input registry untouched, garbage keys drop, bad now records 0", () => {
    const seen = new Map([["k", 7]])
    const snapshot = new Map(seen)
    const { marks, seen: updated } = markFirstSeen(["k", "new", 42, null, ""], seen, Number.NaN)
    expect(seen).toEqual(snapshot) // pure — the caller's map is never mutated
    expect(marks).toEqual([
      { key: "k", firstSeenAt: 7, fresh: false },
      { key: "new", firstSeenAt: 0, fresh: true },
    ])
    expect(updated.get("new")).toBe(0)
    // A non-map registry counts as empty; marks stay keyed, not positional.
    expect(markFirstSeen([42, "k"], undefined as unknown as Map<string, number>, 5).marks).toEqual([
      { key: "k", firstSeenAt: 5, fresh: true },
    ])
  })
})

describe("TurnGroup text-unit rendering (steering segments surface via TextUnitBlock)", () => {
  // The steering blocks' purple source styling + turn containment is
  // covered at the strongest level through ChatPanel (test/ChatPanel
  // .test.tsx "ChatPanel text units" — the full withTextUnitEvents →
  // ConversationTimeline → TurnGroup chain). What remains unique at
  // this level: find highlights working inside the block.
  const steeringTurnEvents = [
    taskStart("t1"),
    ev({ type: "steering-applied", taskIds: ["t1"], messages: ["steer mid-run"] }),
    textEv("narration after steering", "t1"),
  ]

  it("keeps find highlights and the amber current-match mark working inside the block", () => {
    const units = buildTurnFlowItems(withTextUnitEvents(steeringTurnEvents, null), null)
    const turns = groupUnitsByTurn(units)
    // "mid" occurs at offset 6..9 of "steer mid-run" (the steering unit).
    render(
      <TurnGroup
        turn={turns[0]!}
        textHighlights={new Map([["text-1", [{ field: "text", start: 6, end: 9 }]]])}
        currentUnitKey="text-1"
      />,
    )
    expect(screen.getByTestId("mark-current")).toHaveTextContent("mid")
    expect(screen.getByTestId("text-unit-body")).toHaveTextContent("steer mid-run")
  })
})

// ── Live status (running feedback, timers, steering flash, failed-expand) ───

describe("TurnGroup live status", () => {
  /** Deterministic wall clock: every fake-timer test pins the epoch. */
  const EPOCH = 1_700_000_000_000

  const turnOf = (events: RuntimeEvent[]) => {
    const [turn] = groupUnitsByTurn(buildTurnFlowItems(events, null))
    if (!turn) throw new Error("expected a turn")
    return turn
  }

  it("renders the running tool with a spinning Loader2 and per-second elapsed", () => {
    vi.useFakeTimers()
    vi.setSystemTime(EPOCH)
    try {
      render(
        <TurnGroup
          turn={turnOf([taskStart("t1"), toolStart("t1", "bash", { command: "sleep 30" })])}
        />,
      )
      // The spinner: lucide Loader2 with the tailwind spin animation.
      expect(screen.getByTestId("tool-running-spinner")).toHaveClass("animate-spin")
      expect(screen.getByTestId("tool-running")).toHaveTextContent("running")
      // Elapsed counts from the unit's first-seen time (no event ts here).
      expect(screen.getByTestId("tool-running-elapsed")).toHaveTextContent("0s")
      // One interval tick per second — the badge re-renders with it.
      act(() => vi.advanceTimersByTime(1000))
      expect(screen.getByTestId("tool-running-elapsed")).toHaveTextContent("1s")
      act(() => vi.advanceTimersByTime(2000))
      expect(screen.getByTestId("tool-running-elapsed")).toHaveTextContent("3s")
      expect(screen.getByTestId("tool-running-elapsed")).toHaveAttribute("data-seconds", "3")
    } finally {
      vi.useRealTimers()
    }
  })

  it("counts the running tool's elapsed from the event ts when the stream carries one", () => {
    vi.useFakeTimers()
    vi.setSystemTime(EPOCH)
    try {
      const start = EPOCH - 12_000
      render(
        <TurnGroup
          turn={turnOf([
            taskStart("t1", "backend", start),
            toolStart("t1", "bash", { command: "grep -r x ." }, start),
          ])}
        />,
      )
      // 12s already elapsed at mount — no advancing needed.
      expect(screen.getByTestId("tool-running-elapsed")).toHaveTextContent("12s")
    } finally {
      vi.useRealTimers()
    }
  })

  it("retires the spinner once the tool call pairs (no timers left running)", () => {
    vi.useFakeTimers()
    vi.setSystemTime(EPOCH)
    const clearSpy = vi.spyOn(window, "clearInterval")
    try {
      const { unmount } = render(
        <TurnGroup
          turn={turnOf([
            taskStart("t1"),
            toolStart("t1", "bash", { command: "ls" }),
            toolEnd("t1", "bash", { ok: true, durationMs: 8 }),
          ])}
        />,
      )
      expect(screen.queryByTestId("tool-running")).not.toBeInTheDocument()
      expect(screen.queryByTestId("tool-running-spinner")).not.toBeInTheDocument()
      // The per-second interval never outlives the badge that spawned it.
      unmount()
      expect(clearSpy).toHaveBeenCalled()
    } finally {
      clearSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it("ticks the running turn's header duration every 5s from the turn's start", () => {
    vi.useFakeTimers()
    vi.setSystemTime(EPOCH)
    try {
      render(<TurnGroup turn={turnOf([taskStart("t1", "backend", EPOCH - 3000)])} />)
      // Elapsed counts from the task-start ts: 3s at mount...
      expect(screen.getByTestId("turn-elapsed")).toHaveTextContent("3.0 s")
      // ...frozen between the 5s refreshes (no tick at 4s)...
      act(() => vi.advanceTimersByTime(4000))
      expect(screen.getByTestId("turn-elapsed")).toHaveTextContent("3.0 s")
      // ...and live again at the 5s boundary.
      act(() => vi.advanceTimersByTime(1000))
      expect(screen.getByTestId("turn-elapsed")).toHaveTextContent("8.0 s")
      // A finished turn keeps the frozen start→end span instead.
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps the frozen duration for a finished turn and only shows the live one while running", () => {
    const events = [
      taskStart("t1", "backend", EPOCH),
      toolStart("t1", "bash", { command: "ls" }, EPOCH + 100),
      toolEnd("t1", "bash", { ok: true, durationMs: 20 }, EPOCH + 1500),
      taskComplete("t1", EPOCH + 2500),
    ]
    render(<TurnGroup turn={turnOf(events)} />)
    expect(screen.getByTestId("turn-duration")).toHaveTextContent("2.5 s")
    expect(screen.queryByTestId("turn-elapsed")).not.toBeInTheDocument()
  })

  it("expands a FAILED turn's failing tool error by default — no click needed", () => {
    const events = [
      taskStart("t1"),
      toolStart("t1", "bash", { command: "exit 1" }),
      toolEnd("t1", "bash", { ok: false, durationMs: 12, error: "command failed with code 1" }),
      taskFailed("t1", "step blew up"),
    ]
    render(<TurnGroup turn={turnOf(events)} />)
    expect(screen.getByTestId("turn-status")).toHaveTextContent("Failed")
    // The full ErrorBlock detail renders without any interaction.
    expect(screen.getByTestId("tool-error")).toHaveTextContent("command failed with code 1")
    expect(screen.queryByTestId("tool-error-collapsed")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /bash/ })).toHaveAttribute("aria-expanded", "true")
  })

  it("keeps a COMPLETED turn's error detail collapsed until clicked", () => {
    const events = [
      taskStart("t1"),
      toolStart("t1", "bash", { command: "exit 1" }),
      toolEnd("t1", "bash", { ok: false, durationMs: 12, error: "command failed with code 1" }),
      taskComplete("t1"),
    ]
    render(<TurnGroup turn={turnOf(events)} />)
    expect(screen.getByTestId("turn-status")).toHaveTextContent("Done")
    expect(screen.queryByTestId("tool-error")).not.toBeInTheDocument()
    expect(screen.getByTestId("tool-error-collapsed")).toHaveTextContent(
      "command failed with code 1",
    )
    // Clicking still expands — defaultExpanded only changes the default.
    fireEvent.click(screen.getByRole("button", { name: /bash/ }))
    expect(screen.getByTestId("tool-error")).toHaveTextContent("command failed with code 1")
    expect(screen.getByRole("button", { name: /bash/ })).toHaveAttribute("aria-expanded", "true")
  })

  it("flashes a steering block once on entry and fades it out over 2s", () => {
    vi.useFakeTimers()
    vi.setSystemTime(EPOCH)
    try {
      const steeringEvents = [
        taskStart("t1"),
        ev({ type: "steering-applied", taskIds: ["t1"], messages: ["nudge: cover the retries"] }),
      ]
      const turns = groupUnitsByTurn(
        buildTurnFlowItems(withTextUnitEvents(steeringEvents, null), null),
      )
      render(<TurnGroup turn={turns[0]!} />)
      const block = screen.getByTestId("text-unit-block")
      // Lit at mount, driven by a 2s tailwind opacity transition.
      expect(block).toHaveAttribute("data-flash", "true")
      const flash = screen.getByTestId("text-unit-flash")
      expect(flash.className).toContain("transition-opacity")
      expect(flash.className).toContain(`duration-[${STEERING_FLASH_FADE_MS}ms]`)
      // After the hold the highlight retires exactly once; the overlay
      // stays mounted through the fade with opacity-0 as its target.
      act(() => vi.advanceTimersByTime(STEERING_FLASH_HOLD_MS + 50))
      expect(block).toHaveAttribute("data-flash", "false")
      expect(screen.getByTestId("text-unit-flash").className).toContain("opacity-0")
      expect(flash.className).toContain(`duration-[${STEERING_FLASH_FADE_MS}ms]`)
    } finally {
      vi.useRealTimers()
    }
  })

  it("never flashes non-steering text units", () => {
    render(<TextUnitBlock unit={{ source: "system", text: "task description prose" }} />)
    expect(screen.getByTestId("text-unit-block")).toHaveAttribute("data-source", "system")
    expect(screen.queryByTestId("text-unit-flash")).not.toBeInTheDocument()
    expect(screen.getByTestId("text-unit-block").getAttribute("data-flash")).toBeNull()
  })
})

// ── statsSummary (timeline top stats row model) ─────────────────────────────

describe("statsSummary", () => {
  it("counts turns, tool calls, retry attempts and failed tasks over a compiled stream", () => {
    const units = buildTurnFlowItems(
      [
        taskStart("t1", "backend"),
        toolStart("t1", "bash"),
        toolEnd("t1", "bash", { ok: true, durationMs: 5 }),
        retryEv("waiting", 1, 500),
        retryEv("waiting", 2, 500),
        taskComplete("t1"),
        taskStart("t2"),
        taskFailed("t2", "boom"),
      ],
      ws(),
    )
    // user + task-t1 + task-t2; the two waiting events fold to ONE wave
    // but still sum their two attempts.
    expect(statsSummary(units)).toEqual({ turns: 3, tools: 1, retries: 2, failed: 1 })
  })

  it("counts a workspace-level failure in addition to failed tasks", () => {
    const units = buildTurnFlowItems(
      [taskStart("t1"), toolStart("t1", "read"), taskFailed("t1", "boom")],
      ws({ status: "failed", error: "workspace exploded" }),
    )
    const summary = statsSummary(units)
    expect(summary.failed).toBe(2) // task-t1 + the failed-workspace unit
    expect(summary.turns).toBe(3) // user + task-t1 + workspace
    expect(summary.tools).toBe(1)
  })

  it("is zero for an empty stream", () => {
    expect(statsSummary([])).toEqual({ turns: 0, tools: 0, retries: 0, failed: 0 })
  })

  it("degrades gracefully on non-array and malformed entries", () => {
    expect(statsSummary(undefined as unknown as ConversationUnit[])).toEqual({
      turns: 0,
      tools: 0,
      retries: 0,
      failed: 0,
    })
    expect(statsSummary([null, 42, "junk"] as unknown as ConversationUnit[])).toEqual({
      turns: 0,
      tools: 0,
      retries: 0,
      failed: 0,
    })
  })
})

// ── resultUsage / turnResultStats (token extraction for the badge) ──────────

describe("resultUsage / turnResultStats (token extraction)", () => {
  it("extracts prompt/completion tokens from result.metadata.usage", () => {
    const usage = resultUsage({
      ok: true,
      metadata: { usage: { promptTokens: 1200, completionTokens: 340, cacheRead: 60 } },
    })
    expect(usage).toEqual({ promptTokens: 1200, completionTokens: 340, cacheRead: 60 })
    // The badge's own model reads the passthrough: known, and the total
    // is the prompt+completion+cache sum.
    expect(tokenUsageModel(usage)).toMatchObject({
      known: true,
      input: 1200,
      output: 340,
      cacheRead: 60,
      total: 1600,
    })
  })

  it("rejects usage-less and malformed results defensively", () => {
    expect(resultUsage(undefined)).toBeUndefined()
    expect(resultUsage(null)).toBeUndefined()
    expect(resultUsage({})).toBeUndefined()
    expect(resultUsage({ metadata: {} })).toBeUndefined()
    expect(resultUsage({ metadata: { usage: { promptTokens: "many" } } })).toBeUndefined()
    expect(resultUsage([1, 2, 3])).toBeUndefined()
    expect(resultUsage("ok")).toBeUndefined()
  })

  it("accepts the result.usage fallback shape and feeds turnResultStats", () => {
    expect(resultUsage({ usage: { totalTokens: 999 } })).toEqual({ totalTokens: 999 })
    // The compiled turn carries the completion's usage + latency; a
    // running turn carries neither.
    const withResult = ev({
      type: "task-complete",
      taskId: "t1",
      durationMs: 2500,
      result: { metadata: { usage: { promptTokens: 100, completionTokens: 20 } } },
    })
    const [done] = groupUnitsByTurn(buildTurnFlowItems([taskStart("t1"), withResult], null))
    expect(turnResultStats(done)).toEqual({
      usage: { promptTokens: 100, completionTokens: 20 },
      durationMs: 2500,
    })
    const [running] = groupUnitsByTurn(buildTurnFlowItems([taskStart("t1")], null))
    expect(turnResultStats(running)).toEqual({})
    expect(turnResultStats(null)).toEqual({})
  })
})

// ── LatencyMeter rating (task-complete durationMs → turn header) ────────────

describe("LatencyMeter rating (turn header)", () => {
  const turnWithLatency = (durationMs: number) => {
    const [turn] = groupUnitsByTurn(
      buildTurnFlowItems(
        [taskStart("t1"), ev({ type: "task-complete", taskId: "t1", durationMs })],
        null,
      ),
    )
    return turn
  }

  it("rates a sub-second result latency fast (green, near-empty bar)", () => {
    render(<TurnGroup turn={turnWithLatency(500)} />)
    const wrapper = screen.getByTestId("turn-latency")
    const meter = within(wrapper).getByRole("meter")
    expect(meter).toHaveAttribute("aria-valuenow", "5") // 500ms on the 10s scale
    // The rating colors the meter's value label.
    expect(wrapper.querySelector(".text-emerald-600")).not.toBeNull()
    expect(wrapper.querySelector(".text-red-600")).toBeNull()
  })

  it("rates a long result latency slow (red, near-full bar)", () => {
    render(<TurnGroup turn={turnWithLatency(8000)} />)
    const wrapper = screen.getByTestId("turn-latency")
    const meter = within(wrapper).getByRole("meter")
    expect(meter).toHaveAttribute("aria-valuenow", "80")
    expect(wrapper.querySelector(".text-red-600")).not.toBeNull()
    expect(wrapper.querySelector(".text-emerald-600")).toBeNull()
    // The fill carries the slow bar color too.
    expect(meter.querySelector(".bg-red-500")).not.toBeNull()
  })
})

// ── errorDetailOf / ErrorBlock swap (failed task + workspace failures) ──────

describe("errorDetailOf / ErrorBlock swap", () => {
  it("renders a failed task-status through ErrorBlock — message only without a stack", () => {
    const [turn] = groupUnitsByTurn(
      buildTurnFlowItems([taskStart("t1"), taskFailed("t1", "selector not found")], null),
    )
    render(<TurnGroup turn={turn} />)
    const block = within(screen.getByTestId("turn-task-error")).getByRole("alert")
    expect(block).toHaveTextContent("selector not found")
    // A plain string has no stack frames → no fold-out, no name prefix.
    expect(within(screen.getByTestId("turn-task-error")).queryByText(/Show stack/)).toBeNull()
    expect(block.textContent).not.toContain("Error:")
  })

  it("splits an embedded stack trace and renders it folded behind the message", () => {
    const detail = errorDetailOf("TypeError: boom\n    at fn (a.ts:1:1)\n    at run (b.ts:2:2)")
    expect(detail).toMatchObject({ name: "TypeError", message: "boom" })
    expect(detail.stack).toContain("at fn (a.ts:1:1)")
    const [turn] = groupUnitsByTurn(
      buildTurnFlowItems(
        [
          taskStart("t1"),
          taskFailed("t1", "TypeError: boom\n    at fn (a.ts:1:1)\n    at run (b.ts:2:2)"),
        ],
        null,
      ),
    )
    render(<TurnGroup turn={turn} />)
    expect(screen.getByTestId("turn-task-error")).toHaveTextContent("TypeError: boom")
    expect(screen.getByText("Show stack trace")).toBeInTheDocument()
  })
})

// ── ConversationTimeline ai-elements density (render smokes) ────────────────

describe("ConversationTimeline ai-elements density", () => {
  /** Local flow: completed t1 (with tool + retry wave) and failed t2. */
  const densityFlow = (): RuntimeEvent[] => [
    taskStart("t1", "backend", 1000),
    toolStart("t1", "bash", { command: "grep Login src/auth.ts" }, 1100),
    toolEnd("t1", "bash", { ok: true, durationMs: 20 }, 1120),
    retryEv("waiting", 1, 1000),
    taskComplete("t1", 2500),
    taskStart("t2", "frontend"),
    taskFailed("t2", "selector not found"),
  ]

  it("mounts the four-tile stats row from real events", () => {
    render(<ConversationTimeline events={densityFlow()} workspace={ws()} live={false} />)
    const stats = screen.getByTestId("timeline-stats")
    expect(stats.children).toHaveLength(4)
    // turns 3 (user + t1 + t2), tools 1, retries 1, failed 1 (t2).
    const cardOf = (label: string) => within(stats).getByText(label).closest(".rounded-md")
    expect(cardOf("Turns")).toHaveTextContent("3")
    expect(cardOf("Tool calls")).toHaveTextContent("1")
    expect(cardOf("Retry attempts")).toHaveTextContent("1")
    expect(cardOf("Failed")).toHaveTextContent("1")
  })

  it("hides the stats row on an empty stream", () => {
    render(<ConversationTimeline events={[]} workspace={null} live={false} />)
    expect(screen.queryByTestId("timeline-stats")).not.toBeInTheDocument()
  })

  it("renders the workspace id as a CopyField only when the clipboard exists", () => {
    delete (navigator as unknown as { clipboard?: unknown }).clipboard
    const { unmount, rerender } = render(
      <ConversationTimeline events={[]} workspace={ws()} live={false} />,
    )
    // CopyField's own contract: no clipboard → hidden entirely.
    expect(screen.queryByText("w1")).not.toBeInTheDocument()
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
    rerender(<ConversationTimeline events={[]} workspace={ws()} live={false} />)
    expect(screen.getByText("w1")).toBeInTheDocument()
    expect(screen.getByText("Workspace")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument()
    unmount()
  })

  it("renders the empty state through the EmptyHint pattern (icon + copy)", () => {
    const { container } = render(<ConversationTimeline events={[]} workspace={null} live={false} />)
    const empty = screen.getByTestId("timeline-empty")
    expect(empty.querySelector("svg")).not.toBeNull()
    expect(empty).toHaveTextContent(
      "Submit a task — the full multi-agent timeline streams here live",
    )
    expect(empty).toHaveTextContent("Render units stream in live once a run starts")
  })

  it("mounts TokenUsageBadge and LatencyMeter in the header from the completion payload", () => {
    const events = [
      taskStart("t1", "backend", 1000),
      ev({
        type: "task-complete",
        taskId: "t1",
        durationMs: 2500,
        result: {
          metadata: { usage: { promptTokens: 1200, completionTokens: 340, cacheRead: 60 } },
        },
      }),
    ]
    const [turn] = groupUnitsByTurn(buildTurnFlowItems(events, null))
    render(<TurnGroup turn={turn} />)
    // Token badge: total 1600 → formatTokens "1.6K" with in/out labels.
    const usage = screen.getByTestId("turn-usage")
    expect(usage).toHaveTextContent("1.6K")
    expect(usage).toHaveTextContent("in")
    expect(usage).toHaveTextContent("out")
    // Latency meter rated beside it.
    expect(within(screen.getByTestId("turn-latency")).getByRole("meter")).toHaveAttribute(
      "aria-valuenow",
      "25",
    )
    // A turn without a completion payload renders neither.
    const [plain] = groupUnitsByTurn(
      buildTurnFlowItems([taskStart("t2"), taskComplete("t2")], null),
    )
    cleanup()
    render(<TurnGroup turn={plain} />)
    expect(screen.queryByTestId("turn-usage")).not.toBeInTheDocument()
    expect(screen.queryByTestId("turn-latency")).not.toBeInTheDocument()
  })

  it("routes the workspace failure through ErrorBlock in the timeline", () => {
    render(
      <ConversationTimeline
        events={[taskStart("t1"), taskComplete("t1")]}
        workspace={ws({ status: "failed", error: "workspace exploded" })}
        live={false}
      />,
    )
    const failed = screen.getByTestId("turn-failed")
    expect(within(failed).getByRole("alert")).toHaveTextContent("workspace exploded")
  })
})
