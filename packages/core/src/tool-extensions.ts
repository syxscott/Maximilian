// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tool-loop extensions (minimax-code borrowing) — two ready-made behaviours
 * built on the loop's hook seams, not baked into it:
 *
 *  - createRunawayGuard(): onStepEnd observer (mcode agent-extension/
 *    runaway-guard.ts). Detects non-convergence — N consecutive steps with
 *    no new tool output progress — and returns a one-shot strategy reminder
 *    injected as a user message, exactly the seam mcode's guard uses for
 *    `agent.steer()`. shadow mode observes without intervening.
 *
 *  - createToolOutputBudget(): afterToolCall transformer (mcode
 *    tool-output-budget.ts). Oversized tool results are externalized to a
 *    file artifact and replaced with a bounded receipt carrying recovery
 *    instructions, so one huge tool output cannot tax every subsequent
 *    round (the C2C paper's communication-cost lesson applied to tool
 *    results).
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import type { AfterToolCallContext, AfterToolCallResult } from "./types.js"

// ── Runaway guard ────────────────────────────────────────────────────────────

export interface RunawayGuardOptions {
  /** Consecutive no-progress steps before the reminder fires. Default 4. */
  patience?: number
  /** Shadow mode: track state but never emit the reminder. Default false. */
  shadow?: boolean
}

export interface RunawayGuardState {
  consecutiveNoProgress: number
  lastFingerprint: string
  fired: boolean
}

/**
 * Create an `onStepEnd` handler for runToolLoop. Progress is fingerprinted
 * from the round's tool-call count — a round that issued tool calls made
 * *something* happen; the dangerous pattern is repeated rounds that stop
 * calling tools entirely while the task remains unfinished.
 */
export function createRunawayGuard(opts: RunawayGuardOptions = {}): {
  onStepEnd: (round: number, info: { toolCalls: number; stopReason?: string }) => string | undefined
  state: RunawayGuardState
} {
  const patience = opts.patience ?? 4
  const state: RunawayGuardState = {
    consecutiveNoProgress: 0,
    lastFingerprint: "",
    fired: false,
  }
  return {
    state,
    onStepEnd(round, info) {
      if (info.toolCalls === 0) {
        state.consecutiveNoProgress += 1
      } else {
        state.consecutiveNoProgress = 0
      }
      state.lastFingerprint = `${info.toolCalls}|${info.stopReason ?? ""}`
      if (state.consecutiveNoProgress >= patience && !state.fired) {
        state.fired = true
        if (opts.shadow) return undefined
        return (
          `[strategy reminder] ${state.consecutiveNoProgress} consecutive steps made no tool ` +
          `progress. Either try a DIFFERENT approach with a concrete tool call, or summarize ` +
          `what you have and finish — do not keep stalling.`
        )
      }
      return undefined
    },
  }
}

// ── Tool output budget ───────────────────────────────────────────────────────

export interface ToolOutputBudgetOptions {
  /** Max characters of tool output kept inline. Default 20_000 (~5k tokens). */
  maxChars?: number
  /** Directory to externalize oversized outputs into. Required. */
  artifactDir: string
  /** Session/task scoping for the artifact filename. */
  scope?: string
}

/**
 * Create an `afterToolCall` transformer for runToolLoop. Oversized outputs
 * are written to `<artifactDir>/<tool>-<ts>.txt` and replaced with a bounded
 * receipt telling the model where the full output lives and how to read it
 * back in slices (via the read tool). Media/content blocks are preserved;
 * failure to write the artifact degrades to a head+tail preview.
 */
export function createToolOutputBudget(opts: ToolOutputBudgetOptions): {
  afterToolCall: (context: AfterToolCallContext) => Promise<AfterToolCallResult | undefined>
} {
  const maxChars = opts.maxChars ?? 20_000
  return {
    async afterToolCall(context) {
      if (context.isError) return undefined
      const text = stringifyOutput(context.result)
      if (text.length <= maxChars) return undefined

      const toolName =
        typeof (context.toolCall as { name?: unknown } | undefined)?.name === "string"
          ? (context.toolCall as { name: string }).name
          : "tool"
      const fileName = `${toolName}-${Date.now().toString(36)}.txt`
      const filePath = path.join(opts.artifactDir, fileName)
      try {
        await fs.mkdir(opts.artifactDir, { recursive: true })
        await fs.writeFile(filePath, text, "utf8")
      } catch {
        // Artifact write failed — degrade to head+tail preview.
        const head = text.slice(0, 2000)
        const tail = text.slice(-1000)
        return {
          content: [
            {
              type: "text",
              text:
                `[output truncated — ${text.length} chars exceeded the ${maxChars}-char budget, ` +
                `artifact write failed]\n${head}\n[…]\n${tail}`,
            },
          ],
        }
      }
      const receipt =
        `[Tool output externalized: ${text.length} chars exceeded the ${maxChars}-char budget.\n` +
        `Full output saved to: ${filePath}\n` +
        `Read it back with the read tool in slices (offset/limit) instead of re-running the command.]`
      return {
        content: [{ type: "text", text: receipt }],
      }
    },
  }
}

function stringifyOutput(result: unknown): string {
  if (typeof result === "string") return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}
