// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Coordination tool model layer: ask-question, goal, escalate, todo,
 * skill, send-message, respond-to-coordinator, submit-result,
 * switch-mode, list-models, read-session-context. Inputs are passthrough
 * JSON — every extractor is defensive.
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

export function extractAskQuestion(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const question = pickStr(obj, ["question", "q", "text", "prompt"])
  const options = pickArray(obj, ["options", "choices", "answers"])
  if (!question && !options) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.question, question),
    options === undefined
      ? undefined
      : row(FIELDS.options, options.map((o) => oneLine(jsonPreview(o, 80))).join(" | ")),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(question ?? ""),
  )
}

export function extractGoal(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const goal = pickStr(obj, ["goal", "objective", "text", "description", "message"])
  const status = pickStr(obj, ["status", "state"])
  if (!goal && !status) return emptyVm()
  const rows: Array<RendererRow | undefined> = [row(FIELDS.goal, goal), row(FIELDS.status, status)]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(goal ?? status ?? ""),
  )
}

export function extractEscalate(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const reason = pickStr(obj, ["reason", "message", "cause", "text"])
  const target = pickStr(obj, ["to", "target", "coordinator", "audience"])
  const severity = pickStr(obj, ["severity", "level", "priority"])
  if (!reason && !target && !severity) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.target, target),
    row(FIELDS.reason, reason),
    row(FIELDS.mode, severity),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(reason ?? target ?? ""),
  )
}

export function extractTodo(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const todos = pickArray(obj, ["todos", "items", "tasks", "list"])
  const first = pickStr(obj, ["todo", "task", "text"])
  if (!todos && !first) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    todos === undefined ? undefined : row(FIELDS.count, todos.length),
    first === undefined && todos && todos.length > 0
      ? row(FIELDS.summary, oneLine(jsonPreview(todos[0], 160)))
      : row(FIELDS.summary, first),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    todos ? `×${todos.length}` : oneLine(first ?? ""),
  )
}

export function extractSkill(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const skill = pickStr(obj, ["skill", "skillName", "name", "id"])
  const args = obj["args"] ?? obj["arguments"] ?? obj["input"]
  if (!skill && args === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.skill, skill, true),
    args === undefined ? undefined : row(FIELDS.args, jsonPreview(args, 240), true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(skill ?? ""),
  )
}

export function extractSendMessage(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const to = pickStr(obj, ["to", "target", "recipient", "agent", "channel"])
  const message = pickStr(obj, ["message", "text", "body", "content"])
  if (!to && !message) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.target, to),
    row(FIELDS.message, message),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(message ?? to ?? ""),
  )
}

export function extractRespondToCoordinator(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const summary = pickStr(obj, ["summary", "title", "subject"])
  const message = pickStr(obj, ["message", "text", "body", "result"])
  if (!summary && !message) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.summary, summary),
    row(FIELDS.message, message),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(summary ?? message ?? ""),
  )
}

export function extractSubmitResult(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const summary = pickStr(obj, ["summary", "title", "subject"])
  const result = pickStr(obj, ["result", "outcome", "answer", "content", "report"])
  if (!summary && !result) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.summary, summary),
    row(FIELDS.result, result === undefined ? undefined : jsonPreview(result, 300), true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(summary ?? result ?? ""),
  )
}

export function extractSwitchMode(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const mode = pickStr(obj, ["mode", "to", "newMode", "target", "next"])
  const from = pickStr(obj, ["from", "previous", "oldMode", "current"])
  if (!mode && !from) return emptyVm()
  const rows: Array<RendererRow | undefined> = [row(FIELDS.mode, mode), row(FIELDS.from, from)]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(mode ?? ""),
  )
}

export function extractListModels(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const provider = pickStr(obj, ["provider", "vendor", "filter"])
  const models = pickArray(obj, ["models", "ids"])
  if (!provider && !models) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.provider, provider, true),
    models === undefined ? undefined : row(FIELDS.count, models.length),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(provider ?? ""),
  )
}

export function extractReadSessionContext(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const sessionId = pickStr(obj, ["sessionId", "session_id", "id", "session"])
  const query = pickStr(obj, ["query", "question", "prompt"])
  const strategy = pickStr(obj, ["strategy", "mode"])
  if (!sessionId && !query && !strategy) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.session, sessionId, true),
    row(FIELDS.query, query),
    row(FIELDS.strategy, strategy),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(sessionId ?? query ?? ""),
  )
}
