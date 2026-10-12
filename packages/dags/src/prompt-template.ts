// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Prompt-template rendering — single-pass brace-depth scan (conductor
 * e171f9d8e borrowing).
 *
 * Capability `promptTemplate`s carry `{{placeholder}}` slots (today
 * `{{userRequest}}`) that are filled with caller-supplied text at
 * blueprint-generation time. This replaces the literal-regex
 * `.replace(/\{\{userRequest\}\}/g, …)` with the same single-pass scanner
 * the workflow engine uses for `${...}` expressions, so the whole repo has
 * ONE template-extraction discipline:
 *
 *   - matching time is linear in the template; placeholder names may come
 *     from stored/generated blueprints, and a brace-heavy name can no
 *     longer be a pathological input,
 *   - nested/stray braces fold into the outermost placeholder (the same
 *     "everything to the matching close is the slot" semantics as
 *     `${...}` scanning), and
 *   - an unclosed `{{` hides the rest of the template from resolution —
 *     the raw tail stays in the output, nothing after it is filled.
 *
 * Kept local to @max/dags on purpose: the algorithm is ~25 lines and
 * adding a workspace dependency (dags → workflow-engine) purely for it
 * would churn the lockfile. The workflow-engine module is the general
 * tool for future `${...}` evaluation surfaces.
 */

export interface PlaceholderRange {
  start: number
  /** Index just past the closing `}}`. */
  end: number
  /** Placeholder name between the braces, trimmed. */
  name: string
}

/** Index of the `}}` closing the `{{` at `opening`, or -1 when never closed. */
function findClosingDoubleBrace(template: string, opening: number): number {
  for (let i = opening; i < template.length - 1; i++) {
    if (template[i] === "}" && template[i + 1] === "}") return i
  }
  return -1
}

/** Find top-level `{{...}}` slots in a single pass; unclosed `{{` hides the tail. */
export function findPlaceholders(template: string): PlaceholderRange[] {
  const found: PlaceholderRange[] = []
  const length = template.length
  let i = 0
  while (i < length - 1) {
    if (template[i] !== "{" || template[i + 1] !== "{") {
      i++
      continue
    }
    const closing = findClosingDoubleBrace(template, i + 2)
    if (closing < 0) break
    found.push({ start: i, end: closing + 2, name: template.slice(i + 2, closing).trim() })
    i = closing + 2
  }
  return found
}

/**
 * Fill every `{{name}}` slot from `params`. Unknown names render empty; a
 * replacement is spliced verbatim (never re-scanned, so a value containing
 * `{{` cannot inject a second round of substitution).
 */
export function renderPromptTemplate(template: string, params: Record<string, string>): string {
  let out = ""
  let cursor = 0
  for (const slot of findPlaceholders(template)) {
    out += template.slice(cursor, slot.start)
    out += Object.hasOwn(params, slot.name) ? params[slot.name] : ""
    cursor = slot.end
  }
  out += template.slice(cursor)
  return out
}
