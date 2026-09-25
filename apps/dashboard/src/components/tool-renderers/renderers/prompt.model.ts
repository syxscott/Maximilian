// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Prompt-display tool model layer: agent-prompt, enter-plan-mode,
 * exit-plan-mode — the agent-prompt-section family. Their payloads lead
 * with a long prompt/plan TEXT, so the extractors keep the full text as
 * the clamped code block and reduce the rest to section metadata (agent
 * identity, model, line counts, allow-list preview); defensive against
 * missing fields and malformed payloads like every other model file.
 */

import {
  FIELDS,
  asRecord,
  emptyVm,
  jsonPreview,
  oneLine,
  pickArray,
  pickStr,
  row,
  vmFrom,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"

export interface AgentPromptViewModel extends ToolViewModel {
  /** Section heading (the addressed agent / prompt name). */
  name?: string
  /** Total line count of the prompt text. */
  lineCount?: number
}

export function extractAgentPrompt(input: unknown): AgentPromptViewModel {
  const obj = asRecord(input)
  const name = pickStr(obj, ["name", "agent", "agentName", "subagent", "title", "label"])
  const model = pickStr(obj, ["model", "provider", "modelId", "model_id"])
  const text = pickStr(obj, ["prompt", "system", "instructions", "text", "message", "body"])
  if (name === undefined && model === undefined && text === undefined) {
    return { ...emptyVm() }
  }
  const rows: Array<RendererRow | undefined> = [
    name === undefined ? undefined : row(FIELDS.agent, name),
    model === undefined ? undefined : row(FIELDS.provider, model),
    text === undefined ? undefined : row(FIELDS.lines, text.split("\n").length),
  ]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      oneLine(name ?? (text === undefined ? "" : text.replace(/\s+/g, " ").slice(0, 80))),
      text === undefined ? undefined : { text, maxLines: 16 },
    ),
    ...(name === undefined ? {} : { name }),
    ...(text === undefined ? {} : { lineCount: text.split("\n").length }),
  }
}

export function extractEnterPlanMode(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const mode = pickStr(obj, ["mode", "planMode", "plan_mode"])
  const reason = pickStr(obj, ["reason", "why", "note"])
  const scope = pickStr(obj, ["scope", "target", "task"])
  if (mode === undefined && reason === undefined && scope === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.mode, mode),
    row(FIELDS.target, scope),
    row(FIELDS.reason, reason),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(mode ?? scope ?? ""),
  )
}

export function extractExitPlanMode(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const plan = pickStr(obj, ["plan", "planMarkdown", "plan_markdown", "markdown", "summary"])
  const prompts = pickArray(obj, ["allowedPrompts", "allowed_prompts", "prompts", "requests"])
  if (plan === undefined && prompts === undefined) return emptyVm()
  // The prompts row carries the count AND the first labels, so the
  // allow-list reads as content beside the plan document (round-3 top-up).
  const promptLabels =
    prompts === undefined
      ? []
      : prompts.map((p) =>
          typeof p === "string"
            ? p
            : (pickStr(asRecord(p), ["label", "value", "prompt", "command", "tool"]) ??
              jsonPreview(p, 40)),
        )
  const promptsValue =
    prompts === undefined
      ? undefined
      : promptLabels.length > 0
        ? `${prompts.length} · ${promptLabels.slice(0, 3).join(", ")}`
        : "0"
  const rows: Array<RendererRow | undefined> = [
    plan === undefined ? undefined : row(FIELDS.lines, plan.split("\n").length),
    row(FIELDS.prompts, promptsValue),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(plan === undefined ? "" : plan.replace(/\s+/g, " ").slice(0, 80)),
    plan === undefined ? undefined : { text: plan, maxLines: 16 },
  )
}
