// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  truncateWithoutSplittingSurrogatePair,
  endsWithLoneHighSurrogate,
} from "../src/text-safe.js"

describe("truncateWithoutSplittingSurrogatePair", () => {
  it("returns the input unchanged when the budget covers it", () => {
    expect(truncateWithoutSplittingSurrogatePair("hello", 10)).toBe("hello")
    expect(truncateWithoutSplittingSurrogatePair("hello", 5)).toBe("hello")
  })

  it("returns an empty string for non-positive or non-finite budgets", () => {
    expect(truncateWithoutSplittingSurrogatePair("hello", 0)).toBe("")
    expect(truncateWithoutSplittingSurrogatePair("hello", -3)).toBe("")
    expect(truncateWithoutSplittingSurrogatePair("hello", Number.NaN)).toBe("")
  })

  it("truncates plain BMP text at exactly the budget", () => {
    expect(truncateWithoutSplittingSurrogatePair("abcdef", 3)).toBe("abc")
  })

  it("drops the unpaired high surrogate when the cut lands inside a pair", () => {
    // "a" + U+1F600 (surrogate pair 0xD83D 0xDE00, two code units) + "b"
    const text = "a😀b"
    // Budget 2 keeps "a" and the HIGH half only — the half is dropped.
    expect(truncateWithoutSplittingSurrogatePair(text, 2)).toBe("a")
    // Budget 3 keeps the full pair: "a😀".
    expect(truncateWithoutSplittingSurrogatePair(text, 3)).toBe("a😀")
  })

  it("never emits a lone trailing high surrogate for astral-only text", () => {
    const emoji = "😀😀" // four code units, two pairs
    expect(truncateWithoutSplittingSurrogatePair(emoji, 1)).toBe("")
    expect(truncateWithoutSplittingSurrogatePair(emoji, 3)).toBe("😀")
    const out = truncateWithoutSplittingSurrogatePair(emoji, 1)
    expect(endsWithLoneHighSurrogate(out)).toBe(false)
  })

  it("keeps every produced code unit well-formed at the boundary", () => {
    const text = "x😀y😀z"
    for (let budget = 0; budget <= text.length + 1; budget++) {
      const out = truncateWithoutSplittingSurrogatePair(text, budget)
      expect(out.length).toBeLessThanOrEqual(budget)
      // A well-formed tail: the last unit must not be an unpaired high surrogate.
      expect(endsWithLoneHighSurrogate(out)).toBe(false)
    }
  })

  it("preserves lone surrogates that were already in the input away from the cut", () => {
    // A lone low surrogate at index 1 is malformed input; the function owns
    // only the cut it makes, not repairing the rest of the string.
    const malformed = "a\uDE00b"
    expect(truncateWithoutSplittingSurrogatePair(malformed, 2)).toBe("a\uDE00")
  })

  it("floors fractional budgets", () => {
    expect(truncateWithoutSplittingSurrogatePair("abcde", 2.9)).toBe("ab")
  })
})

describe("endsWithLoneHighSurrogate", () => {
  it("detects a trailing high surrogate", () => {
    expect(endsWithLoneHighSurrogate("a\uD83D")).toBe(true)
  })

  it("is false for a complete pair or plain text", () => {
    expect(endsWithLoneHighSurrogate("a😀")).toBe(false)
    expect(endsWithLoneHighSurrogate("abc")).toBe(false)
    expect(endsWithLoneHighSurrogate("")).toBe(false)
  })
})
