// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Model-layer tests for the command registry and the tool-renderer
 * model (ZCode/opencode discipline: the model is unit-tested, the
 * presentation is not). The timeline projection tests live in
 * timeline-view.test.ts (turn-unit pipeline semantics).
 */
import { describe, it, expect } from "vitest"
import { COMMANDS, commandsWithKeybinds, filterCommands, formatKeybind } from "../src/lib/commands"
import {
  summarizeToolInput,
  toolInputRows,
  lineCount,
} from "../src/components/tool-renderers/model"
import { resolveToolRenderer } from "../src/components/tool-renderers/registry"

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
    expect(lineCount("a\nb\nc")).toBe(3)
  })

  it("registry resolves glyphs and always falls back", () => {
    expect(resolveToolRenderer("bash").glyph).toBe("$")
    expect(resolveToolRenderer("mystery-tool").glyph).toBe("·")
  })
})
