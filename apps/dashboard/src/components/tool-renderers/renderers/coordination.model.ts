// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Coordination tool model layer: ask-question, goal, escalate, todo,
 * send-message, respond-to-coordinator, submit-result, switch-mode,
 * list-models, read-session-context (+ skill, unchanged). Inputs are the
 * passthrough `input` of the runtime tool-start event, so extraction is
 * defensive — but the candidate keys track what each tool really sends
 * (e.g. todo's {todos:[{content,status,priority}]} and ask-question's
 * {questions:[{question,header,options,multiSelect}]}). todo and
 * ask-question additionally expose STRUCTURED view models their bodies
 * render as real lists, not just rows.
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

// ── todo ─────────────────────────────────────────────────────────────────────

export type TodoStatus = "pending" | "in_progress" | "completed"

export interface TodoItem {
  content: string
  status: TodoStatus
  priority?: string
}

export interface TodoViewModel extends ToolViewModel {
  /** Normalized items; the body renders these as a checklist. */
  items: TodoItem[]
}

function normalizeStatus(raw: unknown): TodoStatus {
  const s = typeof raw === "string" ? raw.toLowerCase() : ""
  if (["completed", "complete", "done", "finished", "✓"].includes(s)) return "completed"
  if (["in_progress", "in-progress", "inprogress", "active", "running", "current"].includes(s)) {
    return "in_progress"
  }
  return "pending"
}

function normalizeTodo(raw: unknown): TodoItem {
  const item = asRecord(raw)
  const content = pickStr(item, ["content", "task", "text", "todo", "description"]) ?? ""
  const priority = pickStr(item, ["priority", "prio"])
  return { content, status: normalizeStatus(item["status"]), ...(priority ? { priority } : {}) }
}

export function extractTodo(input: unknown): TodoViewModel {
  const obj = asRecord(input)
  const todos = pickArray(obj, ["todos", "items", "tasks", "list"])
  const first = pickStr(obj, ["todo", "task", "text"])
  if (todos === undefined && first === undefined) {
    return { ...emptyVm(), items: [] }
  }
  const items = todos === undefined ? [] : todos.map(normalizeTodo)
  const shown = items.filter((t) => t.content.length > 0)
  const rows: Array<RendererRow | undefined> = [
    todos === undefined ? undefined : row(FIELDS.count, todos.length),
    todos === undefined && first !== undefined
      ? row(FIELDS.summary, first)
      : shown[0] !== undefined
        ? row(FIELDS.summary, oneLine(jsonPreview(shown[0].content, 160)))
        : undefined,
  ]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      todos ? `×${todos.length}` : oneLine(first ?? ""),
    ),
    items,
  }
}

// ── ask-question ─────────────────────────────────────────────────────────────

export interface AskQuestionOption {
  label: string
  description?: string
}

export interface AskQuestionEntry {
  header?: string
  question: string
  multiSelect: boolean
  options: AskQuestionOption[]
}

export interface AskQuestionViewModel extends ToolViewModel {
  questions: AskQuestionEntry[]
}

function normalizeOption(raw: unknown): AskQuestionOption {
  if (typeof raw === "string") return { label: raw }
  const obj = asRecord(raw)
  const label = pickStr(obj, ["label", "value", "option", "answer", "text"]) ?? jsonPreview(raw, 60)
  const description = pickStr(obj, ["description", "detail", "hint"])
  return { label, ...(description === undefined ? {} : { description }) }
}

function normalizeQuestion(raw: unknown): AskQuestionEntry {
  const obj = asRecord(raw)
  const options = pickArray(obj, ["options", "choices", "answers"])
  return {
    header: pickStr(obj, ["header", "title", "subject", "topic"]),
    question: pickStr(obj, ["question", "q", "text", "prompt"]) ?? "",
    multiSelect: pickBool(obj, ["multiSelect", "multi_select", "multiple"]) === true,
    options: options === undefined ? [] : options.map(normalizeOption),
  }
}

export function extractAskQuestion(input: unknown): AskQuestionViewModel {
  const obj = asRecord(input)
  const questionList = pickArray(obj, ["questions", "asked", "prompts"])
  const questions =
    questionList !== undefined
      ? questionList.map(normalizeQuestion)
      : (() => {
          const question = pickStr(obj, ["question", "q", "text", "prompt"])
          const options = pickArray(obj, ["options", "choices", "answers"])
          if (question === undefined && options === undefined) return []
          return [
            {
              header: pickStr(obj, ["header", "title"]),
              question: question ?? "",
              multiSelect: pickBool(obj, ["multiSelect", "multi_select", "multiple"]) === true,
              options: options === undefined ? [] : options.map(normalizeOption),
            },
          ]
        })()
  if (questions.length === 0) {
    return { ...emptyVm(), questions: [] }
  }
  const first = questions[0]!
  const anyMulti = questions.some((q) => q.multiSelect)
  const rows: Array<RendererRow | undefined> = [
    questions.length > 1 ? row(FIELDS.count, questions.length) : undefined,
    row(FIELDS.question, first.question || oneLine(jsonPreview(first, 120))),
    first.options.length > 0
      ? row(FIELDS.options, first.options.map((o) => oneLine(o.label, 40)).join(" | "))
      : undefined,
    anyMulti ? row(FIELDS.multiSelect, "true", true) : undefined,
  ]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      oneLine(first.question || (first.header ?? "")),
    ),
    questions,
  }
}

// ── goal ─────────────────────────────────────────────────────────────────────

export function extractGoal(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const goal = pickStr(obj, ["goal", "objective", "text", "description", "message"])
  const status = pickStr(obj, ["status", "state"])
  const progress = pickNum(obj, ["progress", "percent", "pct"])
  if (goal === undefined && status === undefined && progress === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.goal, goal),
    row(FIELDS.status, status),
    progress === undefined ? undefined : row(FIELDS.progress, `${progress}%`),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(goal ?? status ?? ""),
  )
}

// ── escalate ─────────────────────────────────────────────────────────────────

export function extractEscalate(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const reason = pickStr(obj, ["reason", "message", "question", "summary", "cause", "text"])
  const target = pickStr(obj, ["to", "target", "coordinator", "audience"])
  const severity = pickStr(obj, ["severity", "level", "priority"])
  const context = pickStr(obj, ["context", "detail", "background"])
  if (reason === undefined && target === undefined && severity === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.target, target),
    row(FIELDS.mode, severity),
    row(FIELDS.reason, reason),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(reason ?? target ?? ""),
    context === undefined ? undefined : { text: context, maxLines: 8 },
  )
}

// ── send-message ─────────────────────────────────────────────────────────────

export function extractSendMessage(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const to = pickStr(obj, ["to", "target", "recipient", "agent", "channel", "recipientName"])
  const summary = pickStr(obj, ["summary", "title", "subject"])
  const message = pickStr(obj, ["message", "text", "body", "content"])
  if (to === undefined && summary === undefined && message === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.target, to),
    row(FIELDS.summary, summary),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(summary ?? message ?? to ?? ""),
    message === undefined ? undefined : { text: message, maxLines: 12 },
  )
}

// ── respond-to-coordinator ───────────────────────────────────────────────────

export function extractRespondToCoordinator(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const summary = pickStr(obj, ["summary", "title", "subject"])
  const message = pickStr(obj, ["message", "text", "body", "result"])
  const task = pickStr(obj, ["task", "taskId", "task_id"])
  if (summary === undefined && message === undefined && task === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.summary, summary),
    row(FIELDS.id, task, true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(summary ?? message ?? ""),
    message === undefined ? undefined : { text: message, maxLines: 12 },
  )
}

// ── submit-result ────────────────────────────────────────────────────────────

export function extractSubmitResult(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const summary = pickStr(obj, ["summary", "title", "subject"])
  const result = pickStr(obj, ["result", "outcome", "answer", "content", "report"])
  const task = pickStr(obj, ["task", "taskId", "task_id"])
  if (summary === undefined && result === undefined && task === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.summary, summary),
    row(FIELDS.id, task, true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(summary ?? result ?? ""),
    result === undefined
      ? undefined
      : { text: result.length > 400 ? `${result.slice(0, 400)}…` : result, maxLines: 12 },
  )
}

// ── switch-mode ──────────────────────────────────────────────────────────────

export function extractSwitchMode(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const mode = pickStr(obj, ["mode", "to", "newMode", "target", "next"])
  const from = pickStr(obj, ["from", "previous", "oldMode", "current"])
  const reason = pickStr(obj, ["reason", "because", "cause"])
  if (mode === undefined && from === undefined && reason === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.mode, mode, true),
    row(FIELDS.from, from, true),
    row(FIELDS.reason, reason),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(mode ?? ""),
  )
}

// ── list-models ──────────────────────────────────────────────────────────────

export function extractListModels(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const provider = pickStr(obj, ["provider", "vendor", "filter"])
  const reasoning = pickStr(obj, ["reasoningLevel", "reasoning_level", "level"])
  const models = pickArray(obj, ["models", "ids"])
  const limit = pickNum(obj, ["limit", "count", "max"])
  if (
    provider === undefined &&
    reasoning === undefined &&
    models === undefined &&
    limit === undefined
  ) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.provider, provider, true),
    row(FIELDS.mode, reasoning, true),
    models === undefined ? undefined : row(FIELDS.count, models.length),
    limit === undefined ? undefined : row(FIELDS.limit, limit),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(provider ?? reasoning ?? ""),
  )
}

// ── read-session-context ─────────────────────────────────────────────────────

export function extractReadSessionContext(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const sessionId = pickStr(obj, ["sessionId", "session_id", "id", "session"])
  const query = pickStr(obj, ["query", "question", "prompt"])
  const strategy = pickStr(obj, ["strategy", "mode"])
  const maxTokens = pickNum(obj, ["maxTokens", "max_tokens", "tokenBudget"])
  if (
    sessionId === undefined &&
    query === undefined &&
    strategy === undefined &&
    maxTokens === undefined
  ) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.session, sessionId, true),
    row(FIELDS.query, query),
    row(FIELDS.strategy, strategy),
    maxTokens === undefined ? undefined : row(FIELDS.maxTokens, maxTokens),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(sessionId ?? query ?? ""),
  )
}

// ── skill (unchanged scope) ──────────────────────────────────────────────────

export function extractSkill(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const skill = pickStr(obj, ["skill", "skillName", "name", "id"])
  const args = obj["args"] ?? obj["arguments"] ?? obj["input"]
  if (skill === undefined && args === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.skill, skill, true),
    args === undefined ? undefined : row(FIELDS.args, jsonPreview(args, 240), true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(skill ?? ""),
  )
}
