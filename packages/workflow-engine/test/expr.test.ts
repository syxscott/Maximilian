// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the template-expression tool (conductor e171f9d8e +
 * 602bf6e97 + a057c42c7 borrowing): linear scan semantics, an exhaustive
 * differential pin against an independent oracle, the
 * MAX_EXPRESSION_DEPTH gate, and the `{{placeholder}}` renderer dags uses.
 *
 * Conductor pinned its rewrite with an exhaustive comparison against the
 * legacy backtracking regex. That regex leans on Java semantics for a
 * backreference to a not-yet-participating group (the match FAILS); under
 * ECMA-262 the same backreference matches the empty string, so the ported
 * pattern matches nothing at all in JavaScript — the legacy pattern is not
 * expressible as a JS oracle. The exhaustive pin here instead compares
 * against `oracleExpressions`, an independent recursive-descent
 * implementation of the same documented contract (conductor
 * ParametersUtils.findExpressions javadoc), over every string of a small
 * alphabet up to length 6; the behaviour cases below are conductor's own
 * `testFindExpressions` expectations.
 */
import { describe, it, expect, vi } from "vitest"
import {
  MAX_EXPRESSION_DEPTH,
  ABBREV_LIMIT,
  findExpressions,
  evaluateTemplate,
  renderPlaceholderTemplate,
  abbreviate,
} from "../src/expr.js"

function ranges(value: string): string {
  return findExpressions(value)
    .map((r) => `[${r.start}-${r.end}]`)
    .join("")
}

// ── independent oracle: recursive descent over the same contract ────────────

function oracleExpressions(value: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let i = 0
  while (i < value.length - 1) {
    if (!(value[i] === "$" && value[i + 1] === "{" && (i === 0 || value[i - 1] !== "$"))) {
      i++
      continue
    }
    const close = matchBrace(value, i + 2, 0)
    if (close < 0) break
    out.push([i, close + 1])
    i = close + 1
  }
  return out
}

/** Depth counts unmatched inner opens (the opener itself is skipped). */
function matchBrace(value: string, idx: number, depth: number): number {
  if (idx >= value.length) return -1
  const c = value[idx]
  if (c === "{") return matchBrace(value, idx + 1, depth + 1)
  if (c === "}") {
    if (depth === 0) return idx
    return matchBrace(value, idx + 1, depth - 1)
  }
  return matchBrace(value, idx + 1, depth)
}

function oracleRanges(value: string): string {
  return oracleExpressions(value)
    .map(([s, e]) => `[${s}-${e}]`)
    .join("")
}

describe("findExpressions — conductor testFindExpressions expectations", () => {
  it("finds plain and repeated expressions", () => {
    expect(ranges("no expressions here")).toBe("")
    expect(ranges("${a}")).toBe("[0-4]")
    expect(ranges("x ${a} y ${b} z")).toBe("[2-6][9-13]")
  })
  it("folds nested expressions and plain braces into the outer range", () => {
    expect(ranges("${a.${b}}")).toBe("[0-9]")
    expect(ranges("${a{b{c}d}e}")).toBe("[0-12]")
    expect(ranges("${}")).toBe("[0-3]")
  })
  it("treats $${ as the escape for a literal ${", () => {
    expect(ranges("$${a}")).toBe("")
    expect(ranges("$${a} ${b}")).toBe("[6-10]")
  })
  it("ignores stray braces outside an expression", () => {
    expect(ranges("{}} ${a} {")).toBe("[4-8]")
  })
  it("an unclosed expression is reported as nothing, hiding the tail", () => {
    expect(ranges("${a")).toBe("")
    expect(ranges("${a} ${b ${c}")).toBe("[0-4]")
    expect(ranges("$")).toBe("")
    expect(ranges("")).toBe("")
  })
})

describe("findExpressions — exhaustive differential vs the oracle", () => {
  const ALPHABET = ["$", "{", "}", "a", "\n"]
  const MAX_LENGTH = 6

  it("agrees on every string of the alphabet up to length 6", () => {
    const indexes = [0, 0, 0, 0, 0, 0]
    for (let length = 0; length <= MAX_LENGTH; length++) {
      let exhausted = false
      while (!exhausted) {
        const input = indexes
          .slice(0, length)
          .map((i) => ALPHABET[i])
          .join("")
        expect(ranges(input), `input: ${JSON.stringify(input)}`).toBe(oracleRanges(input))
        let pos = MAX_LENGTH - 1
        while (pos >= 0 && ++indexes[pos] === ALPHABET.length) {
          indexes[pos] = 0
          pos--
        }
        exhausted = pos < 0
      }
    }
  })
})

describe("evaluateTemplate — conductor replaceVariables behaviour", () => {
  const io = new Map<string, unknown>([
    ["name", "maximilian"],
    ["a", "b"],
    ["b", "resolved"],
  ])
  const resolve = (path: string) => io.get(path)

  it("splices resolved values and keeps surrounding text", () => {
    expect(evaluateTemplate("hello ${name}!", resolve)).toBe("hello maximilian!")
    expect(evaluateTemplate("${name} ${name}", resolve)).toBe("maximilian maximilian")
  })
  it("resolves nested expressions inner-out", () => {
    expect(evaluateTemplate("${${a}}", resolve)).toBe("resolved")
  })
  it("missing paths and blank bodies resolve to empty text", () => {
    expect(evaluateTemplate("[${missing}]", resolve)).toBe("[]")
    expect(evaluateTemplate("${}", resolve)).toBe("")
  })
  it("unescapes $${ to a literal ${", () => {
    expect(evaluateTemplate("$${name} = ${name}", resolve)).toBe("${name} = maximilian")
  })
  it("an unclosed expression resolves nothing and stays raw (conductor: unchanged)", () => {
    expect(evaluateTemplate("${name} ${unclosed", resolve)).toBe("maximilian ${unclosed")
    expect(evaluateTemplate("keep ${unclosed", resolve)).toBe("keep ${unclosed")
  })

  describe("depth gate (conductor 602bf6e97 boundary)", () => {
    function chainedIo(depth: number): Map<string, unknown> {
      const io2 = new Map<string, unknown>()
      for (let i = 1; i <= depth; i++) {
        io2.set(`k${i}`, i === depth ? "resolvedValue" : `k${i + 1}`)
      }
      return io2
    }
    it("resolves nesting depth MAX_EXPRESSION_DEPTH - 1 within the cap", () => {
      const io2 = chainedIo(MAX_EXPRESSION_DEPTH - 1)
      const nested =
        "${".repeat(MAX_EXPRESSION_DEPTH - 1) + "k1" + "}".repeat(MAX_EXPRESSION_DEPTH - 1)
      const warns: string[] = []
      expect(evaluateTemplate(nested, (p) => io2.get(p), { warn: (m) => warns.push(m) })).toBe(
        "resolvedValue",
      )
      expect(warns).toHaveLength(0)
    })
    it("resolves one deeper to null with exactly one warning", () => {
      const io2 = chainedIo(MAX_EXPRESSION_DEPTH - 1)
      const nested = "${".repeat(MAX_EXPRESSION_DEPTH) + "k1" + "}".repeat(MAX_EXPRESSION_DEPTH)
      const warns: string[] = []
      expect(evaluateTemplate(nested, (p) => io2.get(p), { warn: (m) => warns.push(m) })).toBe("")
      expect(warns).toHaveLength(1)
      expect(warns[0]).toContain(`depth limit exceeded (${MAX_EXPRESSION_DEPTH})`)
    })
    it("does not stack-overflow at pathological nesting (100k deep)", () => {
      const nested = "${".repeat(100_000) + "name" + "}".repeat(100_000)
      const warns: string[] = []
      expect(evaluateTemplate(nested, () => "x", { warn: (m) => warns.push(m) })).toBe("")
      expect(warns).toHaveLength(1)
    })
    it("abbreviates the expression text in the warning to ABBREV_LIMIT", () => {
      // The gate trips on a deeply nested expression whose innermost text is
      // long; the warning must quote a truncated form, never all of it.
      const long = "y".repeat(1000)
      const nested = "${".repeat(33) + long + "}".repeat(33)
      const warns: string[] = []
      evaluateTemplate(nested, () => "x", { warn: (m) => warns.push(m) })
      expect(warns).toHaveLength(1)
      // abbreviate keeps 256 chars; the quoted text opens with "${", so 254 y's fit.
      expect(warns[0]).toContain("${" + "y".repeat(ABBREV_LIMIT - 2))
      expect(warns[0]).not.toContain(long)
      expect(warns[0].length).toBeLessThan(ABBREV_LIMIT + 200)
    })
    it("defaults the warn sink to console.warn", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const nested = "${".repeat(MAX_EXPRESSION_DEPTH) + "k" + "}".repeat(MAX_EXPRESSION_DEPTH)
      evaluateTemplate(nested, () => "x")
      expect(spy).toHaveBeenCalledTimes(1)
      spy.mockRestore()
    })
  })
})

describe("renderPlaceholderTemplate (dags {{...}} dialect)", () => {
  it("replaces named placeholders, literally, repeatedly", () => {
    expect(
      renderPlaceholderTemplate("Hi {{userRequest}} — {{userRequest}}!", { userRequest: "x" }),
    ).toBe("Hi x — x!")
  })
  it("trims whitespace inside the braces", () => {
    expect(renderPlaceholderTemplate("Hi {{  userRequest  }}", { userRequest: "x" })).toBe("Hi x")
  })
  it("unknown placeholders render empty; a replacement is not re-scanned", () => {
    expect(renderPlaceholderTemplate("{{nope}}", { userRequest: "x" })).toBe("")
    expect(renderPlaceholderTemplate("{{a}}", { a: "{{b}}", b: "boom" })).toBe("{{b}}")
  })
  it("an unclosed {{ leaves the tail raw, like the ${ scanner", () => {
    expect(renderPlaceholderTemplate("keep {{ userRequest", { userRequest: "x" })).toBe(
      "keep {{ userRequest",
    )
    expect(renderPlaceholderTemplate("}", {})).toBe("}")
    expect(renderPlaceholderTemplate("{{", {})).toBe("{{")
  })
  it("nested/stray braces fold into the outer placeholder, linearly", () => {
    expect(renderPlaceholderTemplate("{{ {a} {{b}} }}", { "{a} {{b": "folded" })).toBe("folded }}")
    const template = "{".repeat(100_000)
    expect(renderPlaceholderTemplate(template, { userRequest: "y" })).toBe(template)
  })
})

describe("abbreviate", () => {
  it("keeps short text and caps long text", () => {
    expect(abbreviate("short")).toBe("short")
    expect(abbreviate("x".repeat(300))).toHaveLength(ABBREV_LIMIT)
  })
})
