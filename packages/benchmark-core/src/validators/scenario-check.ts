// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Key-order recall probe (borrowing MiniMax-Provider-Verifier
 * `validator/scenario_check.py:14-100`).
 *
 * Deployment/serialization layers can silently REORDER tool parameter
 * keys between the schema the model was shown and the schema it answers
 * from — a schema-understanding degradation that ordinary schema
 * validation never catches (the args still validate; only the order is
 * wrong). The probe extracts the parameter key order from the tools
 * definition, strips `<think>…</think>` blocks from the reply, finds the
 * first occurrence of each parameter name, and requires the reply order
 * to agree with the definition's prefix. Fewer than 2 parameters is not
 * judged (a single key has no order to preserve).
 */

import type { CaseValidator, ToolDefinition, ValidatorCaseRun, ValidatorFields } from "./types.js"

/** Schema keywords that are NOT parameter names (scenario_check.py:28-31). */
const SCHEMA_KEYWORDS = new Set([
  "type",
  "description",
  "required",
  "additionalProperties",
  "$schema",
  "items",
  "enum",
  "default",
])

export interface ScenarioCheckValidateFields extends ValidatorFields {
  /** The probe ran (tools with ≥1 parameter existed and content existed). */
  scenarioCheckChecked: boolean
  /** Order agreement verdict; null when not checked. */
  scenarioCheckValid: boolean | null
  /** Expected vs actually-observed key order. */
  scenarioCheckDetail: { expected: string[]; actual: string[] } | null
}

export interface ScenarioCheckSummary extends ValidatorFields {
  scenarioCheckCheckedCount: number
  scenarioCheckValidCount: number
  scenarioCheckInvalidCount: number
  /** valid / checked; undefined when the probe never ran. */
  scenarioCheckPassRate: number | undefined
}

export class ScenarioCheckValidator implements CaseValidator {
  readonly name = "scenario_check"

  validate(ctx: ValidatorCaseRun["ctx"]): ScenarioCheckValidateFields {
    const result: ScenarioCheckValidateFields = {
      scenarioCheckChecked: false,
      scenarioCheckValid: null,
      scenarioCheckDetail: null,
    }
    if (ctx.status !== "success" || !ctx.output) return result

    const expectedOrder = extractExpectedOrder(ctx.tools ?? [])
    if (!expectedOrder) return result

    const visible = stripThinkBlocks(ctx.output)
    const actualOrder = extractActualOrder(visible, expectedOrder)

    result.scenarioCheckChecked = true
    result.scenarioCheckValid = actualOrder.length >= 2 && isPrefix(actualOrder, expectedOrder)
    result.scenarioCheckDetail = { expected: expectedOrder, actual: actualOrder }
    return result
  }

  computeSummary(runs: readonly ValidatorCaseRun[]): ScenarioCheckSummary {
    const summary: ScenarioCheckSummary = {
      scenarioCheckCheckedCount: 0,
      scenarioCheckValidCount: 0,
      scenarioCheckInvalidCount: 0,
      scenarioCheckPassRate: undefined,
    }
    for (const run of runs) {
      if (run.fields["scenarioCheckChecked"] !== true) continue
      summary.scenarioCheckCheckedCount += 1
      if (run.fields["scenarioCheckValid"] === true) summary.scenarioCheckValidCount += 1
      else summary.scenarioCheckInvalidCount += 1
    }
    if (summary.scenarioCheckCheckedCount > 0) {
      summary.scenarioCheckPassRate = round4(
        summary.scenarioCheckValidCount / summary.scenarioCheckCheckedCount,
      )
    }
    return summary
  }
}

/**
 * Expected parameter key order from the FIRST tool definition
 * (scenario_check.py:15-33): `properties` keys when present, else the
 * non-schema-keyword top-level keys (flat legacy parameter style).
 */
export function extractExpectedOrder(tools: readonly ToolDefinition[]): string[] | null {
  const first = tools[0]
  if (!first) return null
  const params = first.function.parameters
  if (!params) return null

  if (params.properties && typeof params.properties === "object") {
    const keys = Object.keys(params.properties)
    return keys.length > 0 ? keys : null
  }
  const keys = Object.keys(params).filter((k) => !SCHEMA_KEYWORDS.has(k))
  return keys.length > 0 ? keys : null
}

/** Strip <think>…</think> blocks — the visible reply only (scenario_check.py:36-38). */
export function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
}

/**
 * First-occurrence order of each expected parameter in the visible reply
 * (scenario_check.py:41-49). Parameters that never appear are dropped —
 * the verdict then compares against the definition's prefix.
 */
export function extractActualOrder(text: string, expected: readonly string[]): string[] {
  const positions: Array<{ at: number; name: string }> = []
  for (const param of expected) {
    const idx = text.indexOf(param)
    if (idx !== -1) positions.push({ at: idx, name: param })
  }
  positions.sort((a, b) => a.at - b.at)
  return positions.map((p) => p.name)
}

/** Is `order` exactly the first `order.length` entries of `expected`? */
function isPrefix(order: readonly string[], expected: readonly string[]): boolean {
  for (let i = 0; i < order.length; i++) {
    if (order[i] !== expected[i]) return false
  }
  return true
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
