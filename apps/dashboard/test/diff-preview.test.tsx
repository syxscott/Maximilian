// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DiffPreview tests — embedded approval-card diff (opencode borrowing).
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { DiffPreview, buildDiffLines, extractChange } from "../src/components/_helpers/DiffPreview"

describe("extractChange", () => {
  it("reads edit old_string/new_string pairs", () => {
    const change = extractChange("edit", { old_string: "a\nb", new_string: "a\nc" })
    expect(change).toEqual({ kind: "edit", oldText: "a\nb", newText: "a\nc" })
  })

  it("reads write content as a full-file replacement", () => {
    const change = extractChange("write", { content: "hello" })
    expect(change).toEqual({ kind: "write", oldText: "", newText: "hello" })
  })

  it("returns null for other tools and malformed inputs", () => {
    expect(extractChange("bash", { command: "ls" })).toBeNull()
    expect(extractChange("edit", { old_string: 42 })).toBeNull()
    expect(extractChange("edit", null)).toBeNull()
  })
})

describe("buildDiffLines", () => {
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
})

describe("DiffPreview component", () => {
  it("renders for an edit permission with +/− gutters", () => {
    render(
      <DiffPreview tool="edit" input={{ old_string: "const x = 1", new_string: "const x = 2" }} />,
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
})
