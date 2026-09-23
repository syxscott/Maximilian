// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Agent/task tool model layer: agent, task, task-output, task-stop,
 * explore, plan-guidance. Inputs are passthrough JSON — every extractor
 * is defensive (missing fields, wrong types, malformed payloads).
 */

import {
  FIELDS,
  asRecord,
  emptyVm,
  jsonPreview,
  oneLine,
  pickArray,
  pickNum,
  pickStr,
  row,
  vmFrom,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"

export function extractAgent(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const role = pickStr(obj, ["agentRole", "role", "persona", "agent"])
  const name = pickStr(obj, ["name", "agentName", "id"])
  const prompt = pickStr(obj, ["prompt", "task", "instructions", "message"])
  if (!role && !name && !prompt) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.agent, role),
    row(FIELDS.name, name),
    row(FIELDS.prompt, prompt),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(role ? `@${role}` : (prompt ?? name ?? "")),
  )
}

export function extractTask(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const taskId = pickStr(obj, ["taskId", "task_id", "id", "name"])
  const status = pickStr(obj, ["status", "state"])
  const description = pickStr(obj, ["description", "content", "subject", "prompt"])
  if (!taskId && !status && !description) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.id, taskId, true),
    row(FIELDS.status, status),
    row(FIELDS.description, description),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(taskId ?? description ?? ""),
  )
}

export function extractTaskOutput(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const taskId = pickStr(obj, ["taskId", "task_id", "id"])
  const timeout = pickNum(obj, ["timeoutMs", "timeout_ms", "timeout"])
  const output = pickStr(obj, ["output", "result", "stdout"])
  if (!taskId && timeout === undefined && !output) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.id, taskId, true),
    timeout === undefined ? undefined : row(FIELDS.timeout, timeout),
    output === undefined ? undefined : row(FIELDS.result, jsonPreview(output, 240), true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(taskId ?? output ?? ""),
  )
}

export function extractTaskStop(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const taskId = pickStr(obj, ["taskId", "task_id", "id", "shellId"])
  const reason = pickStr(obj, ["reason", "cause"])
  if (!taskId && !reason) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.id, taskId, true),
    row(FIELDS.reason, reason),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(taskId ?? reason ?? ""),
  )
}

export function extractExplore(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const query = pickStr(obj, ["query", "topic", "question", "goal", "prompt"])
  const paths = pickArray(obj, ["paths", "dirs", "directories", "targets"])
  const base = pickStr(obj, ["path", "root", "cwd"])
  if (!query && !paths && !base) return emptyVm()
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

export function extractPlanGuidance(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const goal = pickStr(obj, ["goal", "objective", "plan", "guidance", "message"])
  const phase = pickStr(obj, ["phase", "stage", "step"])
  if (!goal && !phase) return emptyVm()
  const rows: Array<RendererRow | undefined> = [row(FIELDS.goal, goal), row(FIELDS.phase, phase)]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(goal ?? phase ?? ""),
  )
}
