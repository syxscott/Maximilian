// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Agent/task family model layer: agent, task-output, task-stop, explore,
 * plan-guidance. Inputs are passthrough JSON of the runtime tool-start
 * event (tool-integration.ts ToolCall.input) — every extractor is
 * defensive (missing fields, wrong types, malformed payloads) and keyed to
 * the fields each tool actually carries; task/agent itself lives in
 * task.model.ts / this file respectively.
 */

import {
  FIELDS,
  asRecord,
  emptyVm,
  jsonPreview,
  oneLine,
  pickArray,
  pickBool,
  pickNum,
  pickStr,
  row,
  vmFrom,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"

// ── agent ────────────────────────────────────────────────────────────────────

export function extractAgent(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const name = pickStr(obj, ["name", "agentName", "agent", "id"])
  const persona = pickStr(obj, ["system", "persona", "systemPrompt"])
  const model = pickStr(obj, ["model", "modelId", "subagentModel"])
  const prompt = pickStr(obj, ["prompt", "task", "instructions", "message", "ask"])
  const agentRole = pickStr(obj, ["agentRole", "role"])
  if (
    name === undefined &&
    persona === undefined &&
    model === undefined &&
    prompt === undefined &&
    agentRole === undefined
  ) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.name, name, true),
    row(FIELDS.agent, agentRole),
    row(FIELDS.provider, model, true),
    persona === undefined ? undefined : row(FIELDS.description, oneLine(persona, 200)),
  ]
  const headline = name ?? (agentRole === undefined ? "" : `@${agentRole}`)
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(headline || (prompt ?? "")),
    prompt === undefined ? undefined : { text: prompt, maxLines: 10 },
  )
}

// ── task-output ──────────────────────────────────────────────────────────────

export function extractTaskOutput(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const taskId = pickStr(obj, ["taskId", "task_id", "id", "shellId"])
  const timeout = pickNum(obj, ["timeoutMs", "timeout_ms", "timeout"])
  const block = pickBool(obj, ["block", "wait", "blocking"])
  const output = pickStr(obj, ["output", "result", "stdout"])
  if (
    taskId === undefined &&
    timeout === undefined &&
    block === undefined &&
    output === undefined
  ) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.id, taskId, true),
    block === undefined ? undefined : row(FIELDS.block, block ? "true" : "false", true),
    timeout === undefined ? undefined : row(FIELDS.timeout, timeout),
    output === undefined ? undefined : row(FIELDS.result, jsonPreview(output, 240), true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(taskId ?? output ?? ""),
  )
}

// ── task-stop ────────────────────────────────────────────────────────────────

export function extractTaskStop(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const taskId = pickStr(obj, ["taskId", "task_id", "id", "shellId"])
  const reason = pickStr(obj, ["reason", "cause", "because"])
  const force = pickBool(obj, ["force", "aggressive"])
  if (taskId === undefined && reason === undefined && force === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.id, taskId, true),
    force === undefined ? undefined : row(FIELDS.force, force ? "true" : "false", true),
    row(FIELDS.reason, reason),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(taskId ?? reason ?? ""),
  )
}

// ── explore ──────────────────────────────────────────────────────────────────

export function extractExplore(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const query = pickStr(obj, ["query", "topic", "question", "goal", "prompt"])
  const paths = pickArray(obj, ["paths", "dirs", "directories", "targets"])
  const base = pickStr(obj, ["path", "root", "cwd"])
  if (query === undefined && paths === undefined && base === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.query, query),
    base === undefined ? undefined : row(FIELDS.path, base, true),
    paths === undefined
      ? undefined
      : row(FIELDS.target, paths.map((p) => String(p)).join(", "), true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(query ?? base ?? ""),
  )
}

// ── plan-guidance (the "plan" tool) ─────────────────────────────────────────

export function extractPlanGuidance(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const goal = pickStr(obj, ["goal", "objective", "plan", "guidance", "message"])
  const phase = pickStr(obj, ["phase", "stage", "step"])
  const steps = pickArray(obj, ["steps", "tasks", "milestones"])
  const revision = pickNum(obj, ["revision", "version", "iteration"])
  if (goal === undefined && phase === undefined && steps === undefined && revision === undefined) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.goal, goal),
    row(FIELDS.phase, phase),
    steps === undefined ? undefined : row(FIELDS.count, steps.length),
    revision === undefined ? undefined : row(FIELDS.id, `r${revision}`, true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(goal ?? phase ?? ""),
    steps === undefined
      ? undefined
      : { text: steps.map((s, i) => `${i + 1}. ${jsonPreview(s, 120)}`).join("\n"), maxLines: 12 },
  )
}
