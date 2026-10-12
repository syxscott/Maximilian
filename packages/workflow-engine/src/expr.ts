// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Template-expression evaluation — single-pass, depth-capped (conductor
 * e171f9d8e + 602bf6e97 + a057c42c7 borrowing).
 *
 * Workflow step parameters may carry `${...}` expressions that are resolved
 * against earlier steps' outputs (and, in the future, workflow input). The
 * reference implementation here replaces the classic backtracking extraction
 * regex with a single linear pass that tracks brace depth:
 *
 *   - matching time is linear in the input; the old pattern's grew
 *     polynomially with nesting depth (a 3 KB `${${...}}` chain 1000 deep
 *     took seconds — worker-returned step output is attacker-controlled
 *     input here), and
 *   - the semantics are unchanged, pinned by an exhaustive differential
 *     test against the legacy pattern (see test/expr.test.ts): `$${` is
 *     the escape for a literal `${`, nested expressions belong to the
 *     outer one's range, and an unclosed expression hides the rest of the
 *     string.
 *
 * Resolution is additionally capped at {@link MAX_EXPRESSION_DEPTH}: a
 * deeper expression resolves to `null` with a warning (abbreviated to
 * {@link ABBREV_LIMIT} chars so a hostile parameter cannot turn the log
 * line into a second bomb) instead of recursing to a stack overflow.
 */

/** Maximum nesting depth of `${...}` expressions resolved; beyond it → null. */
export const MAX_EXPRESSION_DEPTH = 32

/** Length cap for expression text embedded in warnings (log-bomb guard). */
export const ABBREV_LIMIT = 256

/** `[start, end)` index range of one top-level `${...}` expression. */
export interface ExpressionRange {
  start: number
  end: number
}

/**
 * Find the top-level `${...}` expressions of `value` in a single pass.
 *
 * An expression starts at a `${` not preceded by `$` (`$${` is the escape
 * for a literal `${`) and ends at the matching closing brace, so nested
 * expressions are part of the same range. If an expression is never closed,
 * neither it nor anything after it is reported. Braces outside an
 * expression are ignored.
 */
export function findExpressions(value: string): ExpressionRange[] {
  const expressions: ExpressionRange[] = []
  const length = value.length
  let i = 0
  while (i < length - 1) {
    const startsExpression =
      value[i] === "$" && value[i + 1] === "{" && (i === 0 || value[i - 1] !== "$")
    if (!startsExpression) {
      i++
      continue
    }
    const closing = findClosingBrace(value, i + 1)
    if (closing < 0) break
    expressions.push({ start: i, end: closing + 1 })
    i = closing + 1
  }
  return expressions
}

/** Index of the brace closing the one at `openingBrace`, or -1 when never closed. */
function findClosingBrace(value: string, openingBrace: number): number {
  let depth = 0
  for (let i = openingBrace; i < value.length; i++) {
    const c = value[i]
    if (c === "{") {
      depth++
    } else if (c === "}" && --depth === 0) {
      return i
    }
  }
  return -1
}

/** Log sink so hosts can route the depth warning; defaults to console.warn. */
export type WarnFn = (message: string) => void

export interface EvaluateOptions {
  /** Log sink for depth-limit warnings; default console.warn. */
  warn?: WarnFn
}

/**
 * Resolve every top-level `${...}` expression in `value` via `resolve` and
 * splice the results in. The expression's *inner text* is itself expanded
 * first (nested expressions), which is what makes the depth gate necessary:
 * a 100k-deep chain must resolve to `null` — with one abbreviated warning —
 * instead of recursing to a stack overflow. A resolved value is stringified
 * (`undefined`/`null` → empty text, conductor's "missing path" behaviour);
 * `$${` escapes unescape to `${` at the end.
 */
export function evaluateTemplate(
  value: string,
  resolve: (path: string) => unknown,
  opts: EvaluateOptions = {},
): string {
  return evaluateAtDepth(value, resolve, 0, opts.warn ?? defaultWarn) ?? ""
}

/**
 * Returns `null` when the depth limit is hit at this level — which the
 * caller turns into "the whole enclosing expression resolves to null"
 * (removed, `resolve` never called), exactly like a JSONPath read of a path
 * that no longer exists.
 */
function evaluateAtDepth(
  value: string,
  resolve: (path: string) => unknown,
  depth: number,
  warn: WarnFn,
): string | null {
  if (depth >= MAX_EXPRESSION_DEPTH) {
    warn(
      `Expression nesting depth limit exceeded (${MAX_EXPRESSION_DEPTH}) for: ` +
        `${abbreviate(value)}. Resolving to null.`,
    )
    return null
  }
  let out = ""
  let cursor = 0
  for (const { start, end } of findExpressions(value)) {
    out += value.slice(cursor, start)
    const inner = evaluateAtDepth(value.slice(start + 2, end - 1), resolve, depth + 1, warn)
    // A depth-limit hit innermost-out replaces the whole expression with
    // null; a blank path (`${}`, `${  }`) resolves to the empty string
    // without a lookup — both conductor semantics.
    if (inner === null) {
      cursor = end
      continue
    }
    if (inner.trim() === "") {
      out += ""
      cursor = end
      continue
    }
    const resolved = resolve(inner)
    out += resolved === null || resolved === undefined ? "" : String(resolved)
    cursor = end
  }
  out += value.slice(cursor)
  return out.replaceAll("$${", "${")
}

function defaultWarn(message: string): void {
  console.warn(message)
}

/** Truncate `text` to `limit` chars with an ellipsis marker (log-bomb guard). */
export function abbreviate(text: string, limit = ABBREV_LIMIT): string {
  if (text.length <= limit) return text
  return text.slice(0, limit)
}

/**
 * Render a `{{placeholder}}` template in a single pass (dags prompt
 * templates). Same discipline as {@link findExpressions}: a `{{` that is
 * never closed swallows the rest of the string instead of letting a regex
 * decide; unknown placeholders render as empty text. Placeholder names are
 * matched literally against `params`.
 */
export function renderPlaceholderTemplate(
  template: string,
  params: Record<string, string>,
): string {
  let out = ""
  let cursor = 0
  let i = 0
  const length = template.length
  while (i < length - 1) {
    if (template[i] !== "{" || template[i + 1] !== "{") {
      i++
      continue
    }
    const closing = findClosingDoubleBrace(template, i + 2)
    if (closing < 0) break
    out += template.slice(cursor, i)
    const name = template.slice(i + 2, closing).trim()
    const replacement = Object.hasOwn(params, name) ? params[name] : ""
    out += replacement
    cursor = closing + 2
    i = closing + 2
  }
  out += template.slice(cursor)
  return out
}

/** Index of the `}}` closing the `{{` at `opening`, or -1 when never closed. */
function findClosingDoubleBrace(template: string, opening: number): number {
  for (let i = opening; i < template.length - 1; i++) {
    if (template[i] === "}" && template[i + 1] === "}") return i
  }
  return -1
}
