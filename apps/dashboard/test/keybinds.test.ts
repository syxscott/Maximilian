// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Keybind utilities tests — matching, formatting, the recorder state
 * machine, and the localStorage overrides persistence model (defensive
 * parsing included).
 */
import { describe, it, expect } from "vitest"
import type { Keybind } from "../src/lib/commands"
import {
  normalizeKey,
  eventToKeybind,
  matchKeybind,
  formatKeybind,
  keybindEquals,
  recorderOutcome,
  parseOverrides,
  readOverrides,
  writeOverrides,
  SHORTCUT_OVERRIDES_KEY,
} from "../src/lib/keybinds"

const ev = (overrides: Partial<KeyboardEvent>) =>
  ({
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  }) as unknown as KeyboardEvent

describe("normalizeKey", () => {
  it("lowercases letters and maps space", () => {
    expect(normalizeKey("K")).toBe("k")
    expect(normalizeKey(" ")).toBe("space")
    expect(normalizeKey("ArrowDown")).toBe("ArrowDown")
  })
})

describe("matchKeybind", () => {
  const kb: Keybind = { mod: true, key: "k" }

  it("matches Ctrl on other platforms and Cmd on mac", () => {
    expect(matchKeybind(ev({ key: "k", ctrlKey: true }), kb, "other")).toBe(true)
    expect(matchKeybind(ev({ key: "k", ctrlKey: true }), kb, "mac")).toBe(false)
    expect(matchKeybind(ev({ key: "k", metaKey: true }), kb, "mac")).toBe(true)
  })

  it("requires exact modifier parity", () => {
    expect(matchKeybind(ev({ key: "k" }), kb)).toBe(false)
    expect(matchKeybind(ev({ key: "k", ctrlKey: true, shiftKey: true }), kb)).toBe(false)
    expect(
      matchKeybind(ev({ key: "b", ctrlKey: true, shiftKey: true }), {
        mod: true,
        shift: true,
        key: "b",
      }),
    ).toBe(true)
  })

  it("is case-insensitive on the key", () => {
    expect(matchKeybind(ev({ key: "K", ctrlKey: true }), kb)).toBe(true)
  })
})

describe("formatKeybind", () => {
  it("formats the platform variants", () => {
    expect(formatKeybind({ mod: true, key: "k" }, "other")).toBe("Ctrl+K")
    expect(formatKeybind({ mod: true, key: "k" }, "mac")).toBe("⌘K")
    expect(formatKeybind({ mod: true, shift: true, alt: true, key: "b" }, "other")).toBe(
      "Ctrl+Shift+Alt+B",
    )
  })

  it("knows normalized key display names", () => {
    expect(formatKeybind({ key: "space" })).toBe("Space")
    expect(formatKeybind({ key: "escape" })).toBe("Esc")
    expect(formatKeybind({ mod: true, key: "ArrowDown" }, "mac")).toBe("⌘ArrowDown")
  })
})

describe("eventToKeybind / keybindEquals", () => {
  it("converts a keydown, mapping Ctrl or Meta to mod", () => {
    expect(eventToKeybind(ev({ key: "J", ctrlKey: true }))).toEqual({ mod: true, key: "j" })
    expect(eventToKeybind(ev({ key: "J", metaKey: true, shiftKey: true }))).toEqual({
      mod: true,
      shift: true,
      key: "j",
    })
    expect(eventToKeybind(ev({ key: " " }))).toEqual({ key: "space" })
  })

  it("returns null for bare modifier presses", () => {
    expect(eventToKeybind(ev({ key: "Shift", shiftKey: true }))).toBeNull()
    expect(eventToKeybind(ev({ key: "Control", ctrlKey: true }))).toBeNull()
  })

  it("compares structurally after normalization", () => {
    expect(keybindEquals({ mod: true, key: "K" }, { mod: true, key: "k" })).toBe(true)
    expect(keybindEquals({ key: "a" }, { alt: true, key: "a" })).toBe(false)
  })
})

describe("recorderOutcome", () => {
  it("cancels on bare Escape", () => {
    expect(recorderOutcome(ev({ key: "Escape" }))).toEqual({ kind: "cancel" })
  })

  it("captures combos and special keys", () => {
    expect(recorderOutcome(ev({ key: "k", ctrlKey: true }))).toEqual({
      kind: "capture",
      keybind: { mod: true, key: "k" },
    })
    expect(recorderOutcome(ev({ key: "F2" }))).toEqual({ kind: "capture", keybind: { key: "F2" } })
    expect(recorderOutcome(ev({ key: "ArrowUp", altKey: true }))).toEqual({
      kind: "capture",
      keybind: { alt: true, key: "ArrowUp" },
    })
  })

  it("ignores bare modifiers and unmodified printable keys", () => {
    expect(recorderOutcome(ev({ key: "Alt", altKey: true })).kind).toBe("ignore")
    expect(recorderOutcome(ev({ key: "a" })).kind).toBe("ignore")
    // Still recording afterwards — the hook keeps waiting.
  })
})

describe("overrides persistence", () => {
  const binding: Keybind = { mod: true, key: "j" }

  it("parses stored JSON defensively", () => {
    expect(parseOverrides(null)).toEqual({})
    expect(parseOverrides("not json")).toEqual({})
    expect(parseOverrides("[1,2]")).toEqual({})
    expect(parseOverrides('{"nav.workspace":"x"}')).toEqual({})
    expect(parseOverrides('{"nav.workspace":{"mod":true,"key":"j"}}')).toEqual({
      "nav.workspace": { mod: true, key: "j" },
    })
  })

  it("round-trips through a storage-like double", () => {
    const backing = new Map<string, string>()
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
    }
    expect(readOverrides(storage)).toEqual({})
    writeOverrides(storage, { "nav.workspace": binding })
    expect(backing.get(SHORTCUT_OVERRIDES_KEY)).toContain("nav.workspace")
    expect(readOverrides(storage)).toEqual({ "nav.workspace": binding })
  })

  it("survives throwing and absent storage", () => {
    expect(readOverrides(null)).toEqual({})
    expect(() =>
      writeOverrides(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("quota")
          },
        },
        {},
      ),
    ).not.toThrow()
  })
})
