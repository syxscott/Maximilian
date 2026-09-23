// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Model-layer tests for the command registry, the tool-renderer model
 * and the conversation-timeline projection (ZCode/opencode discipline:
 * the model is unit-tested, the presentation is not).
 */
import { describe, it, expect } from "vitest"
import {
  COMMANDS,
  commandsWithKeybinds,
  filterCommands,
  formatKeybind,
} from "../src/lib/commands"
import {
  summarizeToolInput,
  toolInputRows,
  utf8Length,
  lineCount,
} from "../src/components/tool-renderers/model"
import { resolveToolRenderer } from "../src/components/tool-renderers/registry"
import { buildTimelineItems } from "../src/components/ConversationTimeline"
import type { RuntimeEvent, Workspace } from "../src/api"

describe("command registry", () => {
  it("covers every tab with a unique id and mod+N keybinds", () => {
    const ids = COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const nav = COMMANDS.filter((c) => c.section === "navigation")
    expect(nav).toHaveLength(7)
    expect(nav.every((c) => c.keybind?.mod && c.navigateTo)).toBe(true)
  })

  it("filterCommands matches id and title substrings", () => {
    expect(filterCommands("").length).toBe(COMMANDS.length)
    expect(filterCommands("palette").map((c) => c.id)).toContain("action.openPalette")
    expect(filterCommands("governance").map((c) => c.id)).toContain("nav.governance")
    expect(filterCommands("no-such-command")).toHaveLength(0)
  })

  it("formatKeybind renders mac and other styles", () => {
    const kb = { mod: true, shift: true, key: "b" }
    expect(formatKeybind(kb, "mac")).toBe("⌘⇧B")
    expect(formatKeybind(kb, "other")).toBe("Ctrl+Shift+B")
  })

  it("commandsWithKeybinds skips keybind-less commands", () => {
    expect(commandsWithKeybinds().every((c) => c.keybind)).toBe(true)
    expect(commandsWithKeybinds().some((c) => c.id === "action.stopStream")).toBe(false)
  })
})

describe("tool renderer model", () => {
  it("summarizes each known tool from its primary field", () => {
    expect(summarizeToolInput("bash", { command: "ls -la\n" })).toBe("ls -la")
    expect(summarizeToolInput("read", { file_path: "/a/b.ts" })).toBe("/a/b.ts")
    expect(summarizeToolInput("glob", { pattern: "**/*.ts" })).toBe("**/*.ts")
    expect(summarizeToolInput("grep", { pattern: "TODO" })).toBe("TODO")
  })

  it("extracts ordered detail rows per tool", () => {
    const edit = toolInputRows("edit", { file_path: "/x.ts", oldString: "a", newString: "b" })
    expect(edit.rows.map((r) => r.label)).toEqual(["file", "old", "new"])
    expect(edit.title).toBe("/x.ts")
    const write = toolInputRows("write", { file_path: "/y.ts", content: "hello" })
    expect(write.rows.at(-1)).toMatchObject({ label: "bytes", value: "5" })
  })

  it("falls back to a generic key/value extraction for unknown tools", () => {
    const rows = toolInputRows("custom-thing", { alpha: "one", beta: { x: 1 } })
    expect(rows.rows.map((r) => r.label)).toEqual(["alpha", "beta"])
    expect(rows.rows[1]?.value).toContain("x")
  })

  it("helpers", () => {
    expect(utf8Length("héllo")).toBe(6)
    expect(lineCount("a\nb\nc")).toBe(3)
  })

  it("registry resolves glyphs and always falls back", () => {
    expect(resolveToolRenderer("bash").glyph).toBe("$")
    expect(resolveToolRenderer("mystery-tool").glyph).toBe("·")
  })
})

describe("buildTimelineItems", () => {
  const ev = (over: Record<string, unknown>): RuntimeEvent =>
    ({ workspaceId: "ws1", ...over }) as RuntimeEvent

  it("groups tool calls under their task and closes groups", () => {
    const events = [
      ev({ type: "task-start", taskId: "t1", agentRole: "backend" }),
      ev({ type: "tool-start", taskId: "t1", toolName: "bash", input: { command: "ls" } }),
      ev({ type: "tool-end", taskId: "t1", toolName: "bash", ok: true, durationMs: 7 }),
      ev({ type: "task-complete", taskId: "t1" }),
      ev({ type: "task-failed", taskId: "t2", error: "kaput" }),
    ]
    const ws = {
      userRequest: "build it",
      status: "running",
      plan: null,
      results: [],
      review: null,
      error: null,
    } as unknown as Workspace
    const items = buildTimelineItems(events, ws)
    expect(items.map((i) => i.kind)).toEqual(["user", "task", "task", "failed" /* ws not failed */].slice(0, 3))
    const t1 = items.find((i) => i.taskId === "t1")!
    expect(t1.status).toBe("completed")
    expect(t1.toolCalls).toHaveLength(1)
    expect(t1.toolCalls![0]).toMatchObject({ ok: true, durationMs: 7 })
    expect(items.find((i) => i.taskId === "t2")!.error).toBe("kaput")
  })

  it("appends the review item with its score", () => {
    const ws = {
      userRequest: "q",
      status: "completed",
      plan: null,
      results: [],
      review: { score: 8.5 },
      error: null,
    } as unknown as Workspace
    const items = buildTimelineItems([], ws)
    expect(items.at(-1)).toMatchObject({ kind: "review", score: 8.5 })
  })
})
