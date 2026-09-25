// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the @mention completion hook (ZCode prompt-editor borrowing).
 */
import { renderHook, act } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import {
  activeMentionToken,
  insertMention,
  useMention,
  type MentionSuggestion,
} from "../src/hooks/useMention"

const SUGGESTIONS: MentionSuggestion[] = [
  { token: "backend", description: "agent role" },
  { token: "frontend", description: "agent role" },
  { token: "review", description: "agent role" },
]

describe("activeMentionToken", () => {
  it("detects an @token at the caret only", () => {
    expect(activeMentionToken("hello @bac", 10)).toBe("bac")
    expect(activeMentionToken("@", 1)).toBe("")
    // Not at the caret — mid-text mention without trailing caret is not active.
    expect(activeMentionToken("hello @bac world", 10)).toBe("bac")
    // No mention.
    expect(activeMentionToken("plain text", 10)).toBeNull()
    // The @ is not at a token start (preceded by a letter).
    expect(activeMentionToken("abc@x", 5)).toBe("x")
  })
})

describe("insertMention", () => {
  it("replaces the partial token with the completed mention", () => {
    const r = insertMention("use @bac please", 8, "backend")
    // Two spaces: the inserted token ends with one AND the original text
    // kept its own — harmless in free text.
    expect(r.text).toBe("use @backend  please")
    expect(r.caret).toBe("use @backend ".length)
  })
})

describe("useMention", () => {
  it("opens with filtered suggestions and applies the highlighted one", () => {
    const { result } = renderHook(() => useMention(SUGGESTIONS))
    act(() => result.current.onChange("do it @fr", 9))
    expect(result.current.activeToken).toBe("fr")
    expect(result.current.suggestions.map((s) => s.token)).toEqual(["frontend"])
    const applied = result.current.apply({ value: "do it @fr", selectionStart: 9 })
    expect(applied?.text).toBe("do it @frontend ")
  })

  it("closes on Escape and stays closed until a different token is typed", () => {
    const { result } = renderHook(() => useMention(SUGGESTIONS))
    act(() => result.current.onChange("@rev", 4))
    expect(result.current.suggestions).toHaveLength(1)
    act(() => result.current.onKeyDown({ key: "Escape", preventDefault: () => {} }))
    expect(result.current.activeToken).toBeNull()
    // Same token, still dismissed.
    act(() => result.current.onChange("@revi", 5))
    expect(result.current.activeToken).toBeNull()
    // Different token reopens.
    act(() => result.current.onChange("@ba", 3))
    expect(result.current.activeToken).toBe("ba")
  })

  it("navigates with arrow keys", () => {
    const { result } = renderHook(() => useMention(SUGGESTIONS))
    act(() => result.current.onChange("@", 1))
    expect(result.current.suggestions).toHaveLength(3)
    act(() => result.current.onKeyDown({ key: "ArrowDown", preventDefault: () => {} }))
    expect(result.current.highlighted).toBe(1)
    act(() => result.current.onKeyDown({ key: "ArrowUp", preventDefault: () => {} }))
    act(() => result.current.onKeyDown({ key: "ArrowUp", preventDefault: () => {} }))
    expect(result.current.highlighted).toBe(2)
  })

  it("returns no suggestions when nothing matches", () => {
    const { result } = renderHook(() => useMention(SUGGESTIONS))
    act(() => result.current.onChange("@zzz", 4))
    expect(result.current.suggestions).toHaveLength(0)
    expect(result.current.activeToken).toBeNull()
  })
})

describe("useMention groups (Agent roles / Skills sections)", () => {
  const SKILLS: MentionSuggestion[] = [
    { token: "commit", description: "skill", group: "skills" },
    { token: "codegen", description: "skill", group: "skills" },
  ]

  it("splits the filtered pool into roles and skills sections", () => {
    const { result } = renderHook(() => useMention(SUGGESTIONS, { skills: SKILLS }))
    act(() => result.current.onChange("@c", 2))
    // No role starts with "c"; both skills do — both sections stay
    // present so the popup can head (and explain) each.
    expect(result.current.groups.map((g) => g.id)).toEqual(["roles", "skills"])
    expect(result.current.groups[0]?.items).toEqual([])
    expect(result.current.groups[1]?.items.map((s) => s.token)).toEqual(["commit", "codegen"])
    // The flat list (what apply() indexes into) follows the group order.
    expect(result.current.suggestions.map((s) => s.token)).toEqual(["commit", "codegen"])
  })

  it("defaults untagged suggestions to the roles group, roles first in the flat list", () => {
    const { result } = renderHook(() => useMention(SUGGESTIONS, { skills: SKILLS }))
    act(() => result.current.onChange("@", 1))
    expect(result.current.suggestions.map((s) => s.token)).toEqual([
      "backend",
      "frontend",
      "review",
      "commit",
      "codegen",
    ])
    expect(result.current.groups[0]?.items.map((s) => s.token)).toEqual([
      "backend",
      "frontend",
      "review",
    ])
    expect(result.current.groups[1]?.items.map((s) => s.token)).toEqual(["commit", "codegen"])
  })

  it("defaults the skills source to an empty pool with both sections intact", () => {
    const { result } = renderHook(() => useMention(SUGGESTIONS))
    act(() => result.current.onChange("@", 1))
    expect(result.current.groups.map((g) => g.id)).toEqual(["roles", "skills"])
    expect(result.current.groups[1]?.items).toEqual([])
  })

  it("applies the highlighted token across groups", () => {
    const { result } = renderHook(() => useMention(SUGGESTIONS, { skills: SKILLS }))
    act(() => result.current.onChange("@co", 3))
    act(() => result.current.onKeyDown({ key: "ArrowDown", preventDefault: () => {} }))
    const applied = result.current.apply({ value: "x @co", selectionStart: 5 })
    expect(applied?.text).toBe("x @codegen ")
  })
})
