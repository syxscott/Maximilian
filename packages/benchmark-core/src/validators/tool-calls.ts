// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tool-calls validator (borrowing MiniMax-Provider-Verifier
 * `validator/tool_calls.py:64-202` + verify.py's match-rate denominator).
 *
 * Per case: record the protocol `finish_reason`, and when the model
 * triggered tool calls, validate each call's arguments against the
 * declared tool schema (see json-schema.ts for the schema-subset
 * selection rationale).
 *
 * Summary — expected×actual confusion matrix over the EXTERNAL
 * `expectedToolCall` label crossed with the observed `finish_reason`:
 *
 *                  actual tool_calls   actual stop    other finish
 *   expected true      TP                FN            others
 *   expected false     FP                TN            others
 *
 * - `toolCallsMatchRate = (TP + TN) / labeled total` — the denominator
 *   prefers the external label count (verify.py:550-555: expected counts
 *   first, request-success count only as a fallback). With no labels the
 *   rate is undefined rather than a fabricated 0.
 * - `toolCallsSchemaAccuracy = schema-valid / triggered` — the
 *   denominator is conditional on triggering (tool_calls.py +
 *   calculate_toolcall_similarity.py:219-238): a model that never calls
 *   tools has no schema accuracy to measure.
 */

import { validateAgainstSchema } from "./json-schema.js"
import type {
  CaseValidator,
  ObservedToolCall,
  ToolDefinition,
  ValidatorCaseRun,
  ValidatorFields,
} from "./types.js"

export interface ToolCallsValidateFields extends ValidatorFields {
  /** Protocol finish_reason, null when absent. */
  toolCallsFinishReason: string | null
  /** Schema validity of the triggered calls; null when nothing triggered. */
  toolCallsValid: boolean | null
  /** Number of tool calls in the response. */
  toolCallsCount: number
}

export interface ToolCallsSummary extends ValidatorFields {
  /** expected=true, actual=tool_calls. */
  toolCallsTp: number
  /** expected=true, actual=stop. */
  toolCallsFn: number
  /** expected=false, actual=tool_calls. */
  toolCallsFp: number
  /** expected=false, actual=stop. */
  toolCallsTn: number
  /** finish_reason outside {tool_calls, stop} on a labeled case. */
  toolCallsFinishOthers: number
  toolCallsFinishOthersDetail: Record<string, number>
  /** External label count (true + false). Denominator for match rate. */
  expectedToolCallTotalCount: number
  /**
   * (TP + TN) / labeled total; undefined when nothing is labeled. The
   * denominator prefers the EXTERNAL annotation count — a fabricated
   * fallback over unlabeled cases would report a fake 0 rate on tool-less
   * suites (spec: 分母优先外部标注统计).
   */
  toolCallsMatchRate: number | undefined
  /** Cases where the model triggered tool calls. */
  toolCallsTriggeredCount: number
  /** Triggered cases whose calls all validated against the schema. */
  toolCallsSuccessfulCount: number
  /** Triggered cases with at least one schema-invalid call. */
  toolCallsSchemaValidationErrorCount: number
  /** Total tool calls observed across cases. */
  toolCallsTotalCount: number
  /** schema-valid / triggered; undefined when the model never triggered. */
  toolCallsSchemaAccuracy: number | undefined
  /** Per-case tool-call count histogram (key = count as string). */
  toolCallsCountDistribution: Record<string, number>
}

export class ToolCallsValidator implements CaseValidator {
  readonly name = "tool_calls"

  validate(ctx: ValidatorCaseRun["ctx"]): ToolCallsValidateFields {
    const result: ToolCallsValidateFields = {
      toolCallsFinishReason: ctx.finishReason ?? null,
      toolCallsValid: null,
      toolCallsCount: 0,
    }
    if (ctx.status !== "success") return result

    if (result.toolCallsFinishReason === "tool_calls") {
      const calls = ctx.message?.toolCalls ?? []
      result.toolCallsCount = calls.length
      result.toolCallsValid =
        calls.length > 0 && calls.every((tc) => this.validateToolCall(tc, ctx.tools ?? []))
    }
    return result
  }

  computeSummary(runs: readonly ValidatorCaseRun[]): ToolCallsSummary {
    const summary: ToolCallsSummary = {
      toolCallsTp: 0,
      toolCallsFn: 0,
      toolCallsFp: 0,
      toolCallsTn: 0,
      toolCallsFinishOthers: 0,
      toolCallsFinishOthersDetail: {},
      expectedToolCallTotalCount: 0,
      toolCallsMatchRate: undefined,
      toolCallsTriggeredCount: 0,
      toolCallsSuccessfulCount: 0,
      toolCallsSchemaValidationErrorCount: 0,
      toolCallsTotalCount: 0,
      toolCallsSchemaAccuracy: undefined,
      toolCallsCountDistribution: {},
    }

    for (const run of runs) {
      const finishReason =
        typeof run.fields["toolCallsFinishReason"] === "string"
          ? (run.fields["toolCallsFinishReason"] as string)
          : null
      const valid = run.fields["toolCallsValid"]
      const count =
        typeof run.fields["toolCallsCount"] === "number"
          ? (run.fields["toolCallsCount"] as number)
          : 0
      const expected = run.ctx.expectedToolCall

      summary.toolCallsTotalCount += count

      // Count external labels — the preferred match-rate denominator.
      if (expected === true || expected === false) {
        summary.expectedToolCallTotalCount += 1
      }

      const actualToolCall = finishReason === "tool_calls"
      const actualStop = finishReason === "stop"

      if (expected === true) {
        if (actualToolCall) {
          summary.toolCallsTp += 1
          summary.toolCallsTriggeredCount += 1
          if (valid === true) summary.toolCallsSuccessfulCount += 1
          else summary.toolCallsSchemaValidationErrorCount += 1
          const key = String(count)
          summary.toolCallsCountDistribution[key] =
            (summary.toolCallsCountDistribution[key] ?? 0) + 1
        } else if (actualStop) {
          summary.toolCallsFn += 1
        } else if (finishReason !== null) {
          summary.toolCallsFinishOthers += 1
          summary.toolCallsFinishOthersDetail[finishReason] =
            (summary.toolCallsFinishOthersDetail[finishReason] ?? 0) + 1
        }
      } else if (expected === false) {
        if (actualToolCall) {
          summary.toolCallsFp += 1
        } else if (actualStop) {
          summary.toolCallsTn += 1
        } else if (finishReason !== null) {
          summary.toolCallsFinishOthers += 1
          summary.toolCallsFinishOthersDetail[finishReason] =
            (summary.toolCallsFinishOthersDetail[finishReason] ?? 0) + 1
        }
      }
      // expected undefined — unlabeled case: not in the confusion matrix.
    }

    // Match rate: (TP + TN) over the labeled total — external annotations
    // are the denominator of record; nothing is labeled → no rate.
    const matched = summary.toolCallsTp + summary.toolCallsTn
    if (summary.expectedToolCallTotalCount > 0) {
      summary.toolCallsMatchRate = round4(matched / summary.expectedToolCallTotalCount)
    }

    // Schema accuracy: conditional on having triggered at all.
    if (summary.toolCallsTriggeredCount > 0) {
      summary.toolCallsSchemaAccuracy = round4(
        summary.toolCallsSuccessfulCount / summary.toolCallsTriggeredCount,
      )
    }

    return summary
  }

  /**
   * Validate one tool call's arguments against the declared schema
   * (tool_calls.py:166-202, minus the Bash-specific array-merging
   * heuristic — that rule belongs to that repo's Bash tool, not to a
   * generic benchmark validator).
   */
  validateToolCall(toolCall: ObservedToolCall, tools: readonly ToolDefinition[]): boolean {
    const schema = tools.find((t) => t.function.name === toolCall.function.name)?.function
      .parameters
    if (!schema) return false

    let args: unknown = toolCall.function.arguments
    if (typeof args === "string") {
      try {
        args = JSON.parse(args)
      } catch {
        return false // unparseable arguments string
      }
    }
    const issues = validateAgainstSchema(args, schema)
    return issues.length === 0
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
