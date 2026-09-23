// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Domain store tests (zustand getState/setState style — no hook harness
 * needed). Covers the projection model, per-workspace draft persistence,
 * command history rules and the task-selection linkage.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { setLocale } from "@max/i18n"

import storesEn from "@/locales/stores.en-US.json"
import storesZh from "@/locales/stores.zh-CN.json"
import {
  COMPOSER_DRAFTS_STORAGE_KEY,
  loadDrafts,
  parseDrafts,
  persistDrafts,
  selectDraft,
  useComposerDraftStore,
} from "@/stores/composerDraftStore"
import {
  COMMAND_HISTORY_LIMIT,
  pushRecent,
  useCommandStore,
  visibleCommands,
} from "@/stores/commandStore"
import {
  projectSession,
  useLastEventAt,
  useSessionProjectionStore,
  useSessionTurns,
  useRunningTaskIds,
} from "@/stores/sessionProjectionStore"
import type { RuntimeEvent } from "@/api"
import {
  useSelectedTaskId,
  useSelectedTaskSource,
  useTaskSelectionStore,
} from "@/stores/taskSelectionStore"
import { COMMANDS } from "@/lib/commands"

setLocale("en-US")

/** Event fixture — RuntimeEvent is passthrough-typed, so extra fields are cast. */
const ev = (over: Record<string, unknown> & { type: string }): RuntimeEvent =>
  ({ workspaceId: "w1", ...over }) as RuntimeEvent

const resetComposer = () => useComposerDraftStore.setState({ drafts: {} })

beforeEach(() => {
  try {
    localStorage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY)
  } catch {
    /* ignore */
  }
  resetComposer()
  useSessionProjectionStore.setState({
    events: [],
    projection: { turns: [], lastEventAt: null, runningTaskIds: [] },
  })
  useCommandStore.setState({ history: [], disabledIds: new Set<string>() })
  useTaskSelectionStore.setState({ taskId: null, source: null })
})

afterEach(() => {
  try {
    localStorage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY)
  } catch {
    /* ignore */
  }
})

// ── sessionProjectionStore ──────────────────────────────────────────────────

describe("projectSession", () => {
  it("builds one turn per task with role, preview and tool count", () => {
    const p = projectSession([
      ev({ type: "task-start", taskId: "t1", agentRole: "backend" }),
      ev({ type: "tool-start", taskId: "t1", toolName: "read" }),
      ev({ type: "tool-end", taskId: "t1", toolName: "read", ok: true }),
      ev({ type: "text", taskId: "t1", text: "reading the config" }),
      ev({ type: "task-complete", taskId: "t1" }),
    ])
    expect(p.turns).toHaveLength(1)
    expect(p.turns[0]).toEqual({
      id: "t1",
      role: "backend",
      preview: "reading the config",
      toolCount: 2,
    })
  })

  it("falls back the preview to the first event type when no text arrives", () => {
    const p = projectSession([ev({ type: "task-start", taskId: "t2" })])
    expect(p.turns[0]?.preview).toBe("task-start")
  })

  it("creates standalone turns for text events without a taskId", () => {
    const p = projectSession([
      ev({ type: "message", role: "user", text: "hello agent" }),
      ev({ type: "message", role: "assistant", text: "hi" }),
    ])
    expect(p.turns.map((t) => [t.id, t.role, t.preview, t.toolCount])).toEqual([
      ["msg-0", "user", "hello agent", 0],
      ["msg-1", "assistant", "hi", 0],
    ])
  })

  it("computes lastEventAt from epoch and ISO timestamps", () => {
    const iso = "2026-01-02T03:04:05.000Z"
    const p = projectSession([
      ev({ type: "a", ts: 1000 }),
      ev({ type: "b", ts: iso }),
      ev({ type: "c", ts: 5000 }),
    ])
    expect(p.lastEventAt).toBe(Date.parse(iso))
    expect(projectSession([ev({ type: "a" })]).lastEventAt).toBeNull()
  })

  it("reuses deriveAgentRuns for the running task ids", () => {
    const p = projectSession([
      ev({ type: "task-start", taskId: "t1" }),
      ev({ type: "task-start", taskId: "t2" }),
      ev({ type: "task-complete", taskId: "t1" }),
    ])
    expect(p.runningTaskIds).toEqual(["t2"])
    expect(projectSession([]).runningTaskIds).toEqual([])
  })

  it("ignores hostile passthrough shapes", () => {
    const p = projectSession([
      ev({ type: "tool-start", taskId: 42, text: { nested: true } }),
      ev({ type: "task-start", taskId: "" }),
    ])
    expect(p.turns).toEqual([])
  })
})

describe("useSessionProjectionStore", () => {
  it("replaces state via setEvents and grows via appendEvent", () => {
    useSessionProjectionStore.getState().setEvents([ev({ type: "task-start", taskId: "t1" })])
    expect(useSessionProjectionStore.getState().projection.turns).toHaveLength(1)

    useSessionProjectionStore
      .getState()
      .appendEvent(ev({ type: "task-start", taskId: "t2", agentRole: "reviewer" }))
    const s = useSessionProjectionStore.getState()
    expect(s.events).toHaveLength(2)
    expect(s.projection.turns.map((t) => t.id)).toEqual(["t1", "t2"])
    expect(s.projection.runningTaskIds).toEqual(["t1", "t2"])
  })

  it("selector hooks track the projection", () => {
    const { result: empty } = renderHook(() => useSessionTurns())
    expect(empty.current).toEqual([])
    act(() =>
      useSessionProjectionStore
        .getState()
        .setEvents([ev({ type: "task-start", taskId: "t1", ts: 7 })]),
    )
    const { result: turns } = renderHook(() => useSessionTurns())
    expect(turns.current.map((t) => t.id)).toEqual(["t1"])
    const { result: last } = renderHook(() => useLastEventAt())
    expect(last.current).toBe(7)
    const { result: running } = renderHook(() => useRunningTaskIds())
    expect(running.current).toEqual(["t1"])
  })
})

// ── composerDraftStore ──────────────────────────────────────────────────────

describe("parseDrafts / loadDrafts", () => {
  it("parses only string→string maps", () => {
    expect(parseDrafts(null)).toEqual({})
    expect(parseDrafts("not json")).toEqual({})
    expect(parseDrafts("[1,2]")).toEqual({})
    expect(parseDrafts('{"a":1,"b":"x"}')).toEqual({ b: "x" })
    expect(parseDrafts('{"ws":"draft"}')).toEqual({ ws: "draft" })
  })

  it("survives a throwing storage", () => {
    const throwing = {
      getItem: () => {
        throw new Error("no storage")
      },
    } as unknown as Storage
    expect(loadDrafts(throwing)).toEqual({})
    expect(loadDrafts(undefined)).toEqual({})
  })
})

describe("useComposerDraftStore", () => {
  it("keeps one draft per workspace and persists under the storage key", () => {
    const store = useComposerDraftStore.getState()
    store.setDraft("ws-1", "hello")
    store.setDraft("ws-2", "for the other workspace")
    store.setDraft("ws-1", "hello v2")
    expect(useComposerDraftStore.getState().drafts).toEqual({
      "ws-1": "hello v2",
      "ws-2": "for the other workspace",
    })

    const stored = JSON.parse(localStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY) ?? "{}")
    expect(stored).toEqual({ "ws-1": "hello v2", "ws-2": "for the other workspace" })
  })

  it("clearDraft removes only the target workspace", () => {
    const store = useComposerDraftStore.getState()
    store.setDraft("ws-1", "a")
    store.setDraft("ws-2", "b")
    store.clearDraft("ws-1")
    expect(useComposerDraftStore.getState().drafts).toEqual({ "ws-2": "b" })
    store.clearDraft("ws-2")
    expect(useComposerDraftStore.getState().drafts).toEqual({})
    expect(localStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY)).toBe("{}")
  })

  it("selectDraft reads a missing workspace as empty string", () => {
    expect(selectDraft("missing")(useComposerDraftStore.getState())).toBe("")
    useComposerDraftStore.getState().setDraft("ws-9", "resume")
    expect(selectDraft("ws-9")(useComposerDraftStore.getState())).toBe("resume")
  })

  it("round-trips through persistDrafts / loadDrafts", () => {
    persistDrafts({ ws: "restorable" })
    expect(loadDrafts()).toEqual({ ws: "restorable" })
  })
})

// ── commandStore ────────────────────────────────────────────────────────────

describe("pushRecent", () => {
  it("moves to front, dedupes and caps at the limit", () => {
    expect(pushRecent(["a", "b"], "b")).toEqual(["b", "a"])
    expect(pushRecent([], "x")).toEqual(["x"])
    expect(pushRecent(["a"], "")).toEqual(["a"])
    const many = Array.from({ length: 30 }, (_, i) => `c${i}`)
    let history: string[] = []
    for (const id of many) history = pushRecent(history, id)
    expect(history).toHaveLength(COMMAND_HISTORY_LIMIT)
    expect(history[0]).toBe("c29")
    expect(history).not.toContain("c0")
  })
})

describe("useCommandStore", () => {
  it("records history most-recent-first with dedupe", () => {
    const store = useCommandStore.getState()
    store.recordCommand("nav.workspace")
    store.recordCommand("action.openPalette")
    store.recordCommand("nav.workspace")
    expect(useCommandStore.getState().history).toEqual(["nav.workspace", "action.openPalette"])
  })

  it("clearHistory empties the list", () => {
    useCommandStore.getState().recordCommand("a")
    useCommandStore.getState().clearHistory()
    expect(useCommandStore.getState().history).toEqual([])
  })

  it("toggles disabled ids and answers isDisabled", () => {
    const store = useCommandStore.getState()
    store.toggleDisabled("nav.usage")
    expect(useCommandStore.getState().disabledIds.has("nav.usage")).toBe(true)
    expect(useCommandStore.getState().isDisabled("nav.usage")).toBe(true)
    useCommandStore.getState().toggleDisabled("nav.usage")
    expect(useCommandStore.getState().isDisabled("nav.usage")).toBe(false)
  })

  it("visibleCommands filters COMMANDS by the disabled set", () => {
    expect(visibleCommands(new Set())).toHaveLength(COMMANDS.length)
    const visible = visibleCommands(new Set(["nav.workspace", "nav.settings"]))
    expect(visible.map((c) => c.id)).not.toContain("nav.workspace")
    expect(visible.map((c) => c.id)).not.toContain("nav.settings")
    expect(visible.every((c) => COMMANDS.some((d) => d.id === c.id))).toBe(true)
  })
})

// ── taskSelectionStore ──────────────────────────────────────────────────────

describe("useTaskSelectionStore", () => {
  it("selects a task with its source and updates on re-select", () => {
    const store = useTaskSelectionStore.getState()
    store.select("t1", "timeline")
    expect(useTaskSelectionStore.getState()).toMatchObject({ taskId: "t1", source: "timeline" })
    useTaskSelectionStore.getState().select("t1", "taskPanel")
    expect(useTaskSelectionStore.getState()).toMatchObject({ taskId: "t1", source: "taskPanel" })
    const { result: id } = renderHook(() => useSelectedTaskId())
    expect(id.current).toBe("t1")
    const { result: source } = renderHook(() => useSelectedTaskSource())
    expect(source.current).toBe("taskPanel")
  })

  it("clears back to the no-selection state", () => {
    useTaskSelectionStore.getState().select("t2", "taskPanel")
    useTaskSelectionStore.getState().clear()
    expect(useTaskSelectionStore.getState().taskId).toBeNull()
    expect(useTaskSelectionStore.getState().source).toBeNull()
  })
})

// ── stores i18n dictionaries ────────────────────────────────────────────────

describe("stores dictionaries", () => {
  it("have identical key trees in zh-CN and en-US", () => {
    const keys = (o: unknown, prefix = ""): string[] =>
      o !== null && typeof o === "object"
        ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
            v !== null && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
          )
        : []
    expect(keys(storesZh).sort()).toEqual(keys(storesEn).sort())
  })

  it("documents the composer draft hint in both locales", () => {
    const c = storesEn.stores as unknown as { composer: { draftPlaceholder: string } }
    expect(c.composer.draftPlaceholder).toContain("workspace")
    expect(Object.keys(storesZh)).toEqual(["stores"])
    expect(Object.keys(storesEn)).toEqual(["stores"])
  })
})
