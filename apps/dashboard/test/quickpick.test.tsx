// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * QuickPick tests — the fuzzy scorer, ranking/normalization model and
 * render smokes for the dialog (keyboard control, sections, empty state).
 */
import { describe, it, expect, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import enDomain from "../src/locales/quickpick.en-US.json"
import zhDomain from "../src/locales/quickpick.zh-CN.json"
import {
  fuzzyScore,
  normalizeQuickPickItems,
  rankQuickPick,
  groupBySection,
  flattenSections,
  commandQuickPickItems,
  type QuickPickItem,
} from "../src/components/quickpick/model"
import { QuickPick } from "../src/components/quickpick/QuickPick"
import { COMMANDS } from "../src/lib/commands"

// Register the domain dictionary over the core one (en-US is the test
// locale per test/setup.ts).
const en = { ...(getDictionary("en-US") ?? {}), ...(enDomain as Record<string, string>) }
const zh = { ...(getDictionary("zh-CN") ?? {}), ...(zhDomain as Record<string, string>) }
registerLocale("en-US", en)
registerLocale("zh-CN", zh)
setLocale("en-US")

afterEach(() => {
  cleanup()
  setLocale("en-US")
})

describe("fuzzyScore", () => {
  it("matches subsequences and rejects broken order", () => {
    expect(fuzzyScore("wrksp", "Workspace")).not.toBeNull()
    expect(fuzzyScore("abc", "a1b2c3")).not.toBeNull()
    expect(fuzzyScore("acb", "abc")).toBeNull()
  })

  it("is case-insensitive and scores the empty query 0", () => {
    expect(fuzzyScore("WS", "workspace")).not.toBeNull()
    expect(fuzzyScore("", "anything")).toBe(0)
  })

  it("rewards consecutive runs over gapped matches", () => {
    const consecutive = fuzzyScore("ab", "ab") ?? 0
    const gapped = fuzzyScore("ab", "a b") ?? 0
    const spread = fuzzyScore("ab", "axb") ?? 0
    expect(consecutive).toBeGreaterThan(gapped)
    expect(gapped).toBeGreaterThan(spread)
  })

  it("rewards word boundaries (camelCase / separators)", () => {
    const boundary = fuzzyScore("fb", "fooBar") ?? 0
    const midWord = fuzzyScore("fb", "foobAr") ?? 0
    expect(boundary).toBeGreaterThan(midWord)
  })

  it("prefers an opening match", () => {
    const atStart = fuzzyScore("na", "nav.workspace") ?? 0
    const late = fuzzyScore("na", "xnav") ?? 0
    expect(atStart).toBeGreaterThan(late)
  })
})

describe("rankQuickPick / normalizeQuickPickItems", () => {
  const items: QuickPickItem[] = [
    { id: "nav.workspace", label: "Workspace", section: "Navigation" },
    { id: "nav.usage", label: "Usage", section: "Navigation" },
    { id: "action.stop", label: "Stop stream" },
    { id: "hidden", label: "Disabled thing", disabled: true },
  ]

  it("keeps registry order on an empty query", () => {
    expect(rankQuickPick(items, "").map((r) => r.item.id)).toEqual([
      "nav.workspace",
      "nav.usage",
      "action.stop",
    ])
  })

  it("filters, ranks and skips disabled items", () => {
    const ranked = rankQuickPick(items, "wrksp")
    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.item.id).toBe("nav.workspace")
    expect(rankQuickPick(items, "stop").map((r) => r.item.id)).toEqual(["action.stop"])
  })

  it("matches ids too, with a label tie-break advantage", () => {
    const ranked = rankQuickPick(items, "workspace")
    expect(ranked[0]?.item.id).toBe("nav.workspace")
  })

  it("normalizes passthrough blobs defensively", () => {
    const normalized = normalizeQuickPickItems([
      { id: "a", label: "Alpha" },
      { label: "no id" },
      null,
      "string",
      { id: "", label: "empty id" },
      { id: 42 },
    ])
    expect(normalized).toEqual([{ id: "a", label: "Alpha", disabled: false }])
    expect(normalizeQuickPickItems("nope")).toEqual([])
    expect(normalizeQuickPickItems([{ id: "b" }])).toEqual([
      { id: "b", label: "b", disabled: false },
    ])
  })
})

describe("groupBySection", () => {
  it("groups by first appearance with an ungrouped tail", () => {
    const ranked = rankQuickPick(
      [
        { id: "a", label: "A", section: "View" },
        { id: "b", label: "B" },
        { id: "c", label: "C", section: "Navigation" },
        { id: "d", label: "D", section: "View" },
      ],
      "",
    )
    const groups = groupBySection(ranked)
    expect(groups.map((g) => g.section)).toEqual(["View", null, "Navigation"])
    expect(flattenSections(groups).map((r) => r.item.id)).toEqual(["a", "d", "b", "c"])
  })
})

describe("QuickPick rendering", () => {
  const items: QuickPickItem[] = [
    { id: "nav.workspace", label: "Workspace", section: "Navigation" },
    { id: "nav.usage", label: "Usage", section: "Navigation" },
    { id: "action.stop", label: "Stop stream" },
    { id: "gone", label: "Disabled", disabled: true },
  ]

  it("renders sections, skips disabled, shows the hint", () => {
    render(<QuickPick open onOpenChange={() => {}} items={items} />)
    expect(screen.getByText("Navigation")).toBeInTheDocument()
    expect(screen.getByText("Workspace")).toBeInTheDocument()
    expect(screen.getByText("Stop stream")).toBeInTheDocument()
    expect(screen.queryByText("Disabled")).not.toBeInTheDocument()
    expect(screen.getByText(enDomain["quickpick.hint"])).toBeInTheDocument()
  })

  it("filters as the user types", () => {
    render(<QuickPick open onOpenChange={() => {}} items={items} />)
    fireEvent.change(screen.getByTestId("quickpick-input"), { target: { value: "wrksp" } })
    expect(screen.getAllByTestId("quickpick-item")).toHaveLength(1)
  })

  it("shows the empty state for hopeless queries", () => {
    render(<QuickPick open onOpenChange={() => {}} items={items} />)
    fireEvent.change(screen.getByTestId("quickpick-input"), { target: { value: "zzzzzz" } })
    expect(screen.getByRole("status")).toHaveTextContent(enDomain["quickpick.empty"])
    expect(screen.queryByTestId("quickpick-item")).not.toBeInTheDocument()
  })

  it("navigates with arrows and selects with Enter", () => {
    const onSelect = vi.fn()
    const onOpenChange = vi.fn()
    render(<QuickPick open onOpenChange={onOpenChange} items={items} onSelect={onSelect} />)
    const input = screen.getByTestId("quickpick-input")
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSelect).toHaveBeenCalledWith(items[1])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("closes on Escape", () => {
    const onOpenChange = vi.fn()
    render(<QuickPick open onOpenChange={onOpenChange} items={items} />)
    fireEvent.keyDown(screen.getByTestId("quickpick-input"), { key: "Escape" })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("does not render while closed", () => {
    render(<QuickPick open={false} onOpenChange={() => {}} items={items} />)
    expect(screen.queryByTestId("quickpick")).not.toBeInTheDocument()
  })
})

describe('commandQuickPickItems (ChatPanel "/" slash menu)', () => {
  it("represents every registry command in order with i18n section labels", () => {
    const items = commandQuickPickItems(COMMANDS, (key) => key, {
      openPalette: true,
      stopStream: true,
    })
    expect(items.map((i) => i.id)).toEqual(COMMANDS.map((c) => c.id))
    const nav = items.find((i) => i.id === "nav.workspace")
    expect(nav).toMatchObject({
      label: "nav.workspace",
      section: "quickpick.slash.navigation",
      disabled: false,
    })
    const action = items.find((i) => i.id === "action.openPalette")
    expect(action).toMatchObject({
      label: "command.openPalette",
      section: "quickpick.slash.actions",
      disabled: false,
    })
  })

  it("describes commands with their i18n description, falling back to the keybind", () => {
    const items = commandQuickPickItems(COMMANDS, (key) => key, {
      openPalette: true,
      stopStream: true,
    })
    // descriptionKey wins when present...
    expect(items.find((i) => i.id === "action.stopStream")?.description).toBe(
      "command.stopStream.desc",
    )
    // ...otherwise the formatted keybind describes the command.
    expect(items.find((i) => i.id === "nav.workspace")?.description).toBe("Ctrl+1")
    expect(items.find((i) => i.id === "view.toggleSidebar")?.description).toBe("Ctrl+Shift+B")
  })

  it("gates actions on their executor, always offers navigation, never offers view toggles", () => {
    const wired = commandQuickPickItems(COMMANDS, (k) => k, {
      openPalette: true,
      stopStream: true,
    })
    // Navigation routes through the caller's onNavigate — always offered.
    expect(wired.find((i) => i.id === "nav.usage")?.disabled).toBe(false)
    expect(wired.find((i) => i.id === "action.stopStream")?.disabled).toBe(false)
    // View toggles have no panel-reachable executor, wired or not.
    expect(wired.find((i) => i.id === "view.toggleSidebar")?.disabled).toBe(true)

    const unwired = commandQuickPickItems(COMMANDS, (k) => k, {
      openPalette: false,
      stopStream: false,
    })
    expect(unwired.find((i) => i.id === "nav.usage")?.disabled).toBe(false)
    expect(unwired.find((i) => i.id === "action.openPalette")?.disabled).toBe(true)
    expect(unwired.find((i) => i.id === "action.stopStream")?.disabled).toBe(true)
  })
})
