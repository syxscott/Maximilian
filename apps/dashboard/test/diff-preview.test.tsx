// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DiffPreview tests — embedded approval-card diff (opencode borrowing).
 * The line diff is a bounded true LCS (OpenHands diff-view.tsx borrowing):
 * common prefix/suffix trimmed, middle segments through an O(n·m) LCS with
 * a cell budget that degrades to wholesale replacement, MAX_ROWS cap, and
 * exact +/− tallies for the header.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { render, screen } from "@testing-library/react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"
import {
  DiffPreview,
  buildDiff,
  buildDiffLines,
  extractChange,
} from "../src/components/_helpers/DiffPreview"
import diffPreviewEn from "../src/locales/diff-preview.en-US.json"

/** Domain JSONs are nested; t() looks up flat dotted keys — flatten first. */
function flatten(tree: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === "object") {
      Object.assign(out, flatten(value as Record<string, unknown>, dotted))
    } else {
      out[dotted] = String(value)
    }
  }
  return out
}

// Component tests render against the merged dictionary: register the
// dashboard-side diff-preview overrides (the app does this at boot via
// locales/index.ts applyDashboardDictionaries).
beforeAll(() => {
  const existing = getDictionary("en-US") ?? {}
  registerLocale("en-US", {
    ...existing,
    ...flatten(diffPreviewEn as unknown as Record<string, unknown>),
  })
  setLocale("en-US")
})

describe("extractChange", () => {
  it("reads edit oldString/newString pairs (camelCase, matching tools/src/edit.ts)", () => {
    const change = extractChange("edit", { oldString: "a\nb", newString: "a\nc" })
    expect(change).toEqual({ kind: "edit", oldText: "a\nb", newText: "a\nc" })
  })

  it("reads write content as a full-file replacement", () => {
    const change = extractChange("write", { content: "hello" })
    expect(change).toEqual({ kind: "write", oldText: "", newText: "hello" })
  })

  it("returns null for other tools and malformed inputs", () => {
    expect(extractChange("bash", { command: "ls" })).toBeNull()
    expect(extractChange("edit", { oldString: 42 })).toBeNull()
    expect(extractChange("edit", null)).toBeNull()
  })

  it("returns null when old_string/new_string snake_case keys are used (legacy mistake)", () => {
    // Guards against re-introducing the snake_case typo that crashed
    // approval previews on real runtime events (the runtime always sends
    // camelCase per the edit tool's input schema).
    expect(extractChange("edit", { old_string: "a", new_string: "b" })).toBeNull()
  })
})

describe("buildDiffLines — LCS mechanics", () => {
  it("marks removals and additions with shared context trimmed", () => {
    const lines = buildDiffLines("a\nb\nc", "a\nX\nc")
    expect(lines).toEqual([
      { type: "ctx", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "X" },
      { type: "ctx", text: "c" },
    ])
  })

  it("a write renders everything as additions", () => {
    const lines = buildDiffLines("", "l1\nl2")
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.type === "add")).toBe(true)
  })

  it("identical texts yield context only — no adds or removals", () => {
    const lines = buildDiffLines("same", "same")
    expect(lines).toEqual([{ type: "ctx", text: "same" }])
    expect(lines.every((l) => l.type !== "add" && l.type !== "del")).toBe(true)
  })

  it("splits a multi-hunk edit into per-hunk groups separated by real shared context", () => {
    // The old prefix/suffix-trim + line pairing misread this as one giant
    // replacement block; the LCS keeps both hunks' shared lines as context.
    const oldText = "a\nb\nc\nd\ne\nf\ng\nh"
    const newText = "a\nX\nc\nd\ne\nY\ng\nh"
    const lines = buildDiffLines(oldText, newText)
    expect(lines).toEqual([
      { type: "ctx", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "X" },
      { type: "ctx", text: "c" },
      { type: "ctx", text: "d" },
      { type: "ctx", text: "e" },
      { type: "del", text: "f" },
      { type: "add", text: "Y" },
      { type: "ctx", text: "g" },
      { type: "ctx", text: "h" },
    ])
  })

  it("renders an all-delete edit as removals only (no phantom trailing add)", () => {
    // newLines used to keep a [""] phantom row for an empty replacement;
    // deleting the whole file must not add an empty line.
    const lines = buildDiffLines("a\nb", "")
    expect(lines).toEqual([
      { type: "del", text: "a" },
      { type: "del", text: "b" },
    ])
  })

  it("renders an all-add edit as additions only", () => {
    const lines = buildDiffLines("", "x\ny\nz")
    expect(lines).toEqual([
      { type: "add", text: "x" },
      { type: "add", text: "y" },
      { type: "add", text: "z" },
    ])
  })

  it("degrades to wholesale replacement above the LCS cell budget", () => {
    // 600 × 600 = 360_000 cells > 250_000 budget: no LCS table is built and
    // the middle segments collapse to "delete all old, add all new". Every
    // over-budget diff is also larger than MAX_ROWS, so the result comes
    // back truncated with exact (untruncated) tallies.
    const oldLines = Array.from({ length: 600 }, (_, i) => `old-${i}`)
    const newLines = Array.from({ length: 600 }, (_, i) => `new-${i}`)
    const result = buildDiff(oldLines.join("\n"), newLines.join("\n"))
    expect(result.lines).toHaveLength(300)
    expect(result.truncated).toBe(true)
    expect(result.removed).toBe(600)
    expect(result.added).toBe(600)
    expect(result.lines[0]).toEqual({ type: "del", text: "old-0" })
    expect(result.lines[299]).toEqual({ type: "del", text: "old-299" })
  })

  it("still runs the LCS under the budget for large-but-sparse rewrites", () => {
    // 100 × 100 = 10_000 cells < 250_000 budget: the LCS runs. Half the
    // lines are shared, so the diff keeps real context instead of reading
    // as one wholesale swap.
    const oldLines = Array.from({ length: 100 }, (_, i) =>
      i % 2 === 0 ? `shared-${i}` : `old-${i}`,
    )
    const newLines = Array.from({ length: 100 }, (_, i) =>
      i % 2 === 0 ? `shared-${i}` : `new-${i}`,
    )
    const result = buildDiff(oldLines.join("\n"), newLines.join("\n"))
    expect(result.truncated).toBe(false)
    const ctx = result.lines.filter((l) => l.type === "ctx")
    // 49 shared middle lines + the shared-0 lead context row.
    expect(ctx).toHaveLength(50)
    expect(ctx[0]).toEqual({ type: "ctx", text: "shared-0" })
    // 50 ctx + 50 del + 50 add = 150 rows.
    expect(result.lines).toHaveLength(150)
    expect(result.removed).toBe(50)
    expect(result.added).toBe(50)
  })

  it("caps the returned rows at MAX_ROWS while keeping exact tallies", () => {
    // 200 del + 150 add = 350 rows; product 30_000 cells keeps the LCS on.
    const oldText = Array.from({ length: 200 }, (_, i) => `old-${i}`).join("\n")
    const newText = Array.from({ length: 150 }, (_, i) => `new-${i}`).join("\n")
    const result = buildDiff(oldText, newText)
    expect(result.lines).toHaveLength(300)
    expect(result.truncated).toBe(true)
    // Tallies count the UNtruncated diff.
    expect(result.removed).toBe(200)
    expect(result.added).toBe(150)
  })

  it("reports not-truncated and empty-vs-empty without rows", () => {
    expect(buildDiff("", "").lines).toEqual([])
    expect(buildDiff("", "").truncated).toBe(false)
    expect(buildDiff("a", "b").truncated).toBe(false)
  })
})

describe("DiffPreview component", () => {
  it("renders for an edit permission with +/− gutters", () => {
    render(
      <DiffPreview tool="edit" input={{ oldString: "const x = 1", newString: "const x = 2" }} />,
    )
    expect(screen.getByTestId("diff-preview")).toBeTruthy()
    expect(screen.getByText(/const x = 2/)).toBeTruthy()
    expect(screen.getByText(/const x = 1/)).toBeTruthy()
    expect(screen.getByText("−")).toBeTruthy()
    expect(screen.getByText("+")).toBeTruthy()
  })

  it("renders nothing for tools without a textual change", () => {
    const { container } = render(<DiffPreview tool="bash" input={{ command: "ls" }} />)
    expect(container.firstChild).toBeNull()
  })

  it("caps long diffs with an overflow note", () => {
    const long = Array.from({ length: 60 }, (_, i) => `line${i}`).join("\n")
    render(<DiffPreview tool="write" input={{ content: long }} maxLines={10} />)
    expect(screen.getByText(/more line\(s\)/)).toBeTruthy()
  })

  it("shows the exact +/− tallies in the header for a multi-hunk edit", () => {
    render(
      <DiffPreview
        tool="edit"
        input={{ oldString: "a\nb\nc\nd\ne\nf\ng\nh", newString: "a\nX\nc\nd\ne\nY\ng\nh" }}
      />,
    )
    // 2 removals, 2 additions — not the whole-file 8→8 line counts.
    expect(screen.getByText(/\+2 −2 lines/)).toBeTruthy()
  })

  it("shows zero removals for a write", () => {
    render(<DiffPreview tool="write" input={{ content: "l1\nl2\nl3" }} />)
    expect(screen.getByText(/\+3 −0 lines/)).toBeTruthy()
  })
})
