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

export interface TaskOutputViewModel extends ToolViewModel {
  /** Target task/shell the retrieval names. */
  taskId?: string
  /** Retrieved output (the body renders it as a clamped monospace block). */
  output?: string
}

export function extractTaskOutput(input: unknown): TaskOutputViewModel {
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
    return { ...emptyVm() }
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.id, taskId, true),
    block === undefined ? undefined : row(FIELDS.block, block ? "true" : "false", true),
    timeout === undefined ? undefined : row(FIELDS.timeout, timeout),
    output === undefined ? undefined : row(FIELDS.lines, output.split("\n").length),
  ]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      oneLine(taskId ?? output ?? ""),
      output === undefined ? undefined : { text: output, maxLines: 12 },
    ),
    ...(taskId === undefined ? {} : { taskId }),
    ...(output === undefined ? {} : { output }),
  }
}

// ── task-stop ────────────────────────────────────────────────────────────────

export interface TaskStopViewModel extends ToolViewModel {
  /** Target task/shell id the stop request names. */
  taskId?: string
  /** Why the task is being stopped. */
  reason?: string
  force?: boolean
  /** Batch form — every task id the request stops. */
  stops: string[]
}

function normalizeStopId(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.length > 0) return raw
  const obj = asRecord(raw)
  return pickStr(obj, ["taskId", "task_id", "id", "shellId", "jobId"])
}

export function extractTaskStop(input: unknown): TaskStopViewModel {
  const obj = asRecord(input)
  const taskId = pickStr(obj, ["taskId", "task_id", "id", "task", "taskName", "shellId", "jobId"])
  const reason = pickStr(obj, ["reason", "cause", "because", "why", "note"])
  const force = pickBool(obj, ["force", "aggressive"])
  const stopEntries = pickArray(obj, ["stops", "tasks", "targets", "ids"])
  const stops =
    stopEntries === undefined
      ? []
      : stopEntries.map(normalizeStopId).filter((s): s is string => s !== undefined)
  if (taskId === undefined && reason === undefined && force === undefined && stops.length === 0) {
    return { ...emptyVm(), stops: [] }
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.id, taskId, true),
    force === undefined ? undefined : row(FIELDS.force, force ? "true" : "false", true),
    row(FIELDS.reason, reason),
    stops.length > 0 ? row(FIELDS.stops, stops.join(", "), true) : undefined,
  ]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      oneLine(taskId ?? (stops.length > 0 ? stops.join(", ") : (reason ?? ""))),
    ),
    ...(taskId === undefined ? {} : { taskId }),
    ...(reason === undefined ? {} : { reason }),
    ...(force === undefined ? {} : { force }),
    stops,
  }
}

// ── explore ──────────────────────────────────────────────────────────────────

export function extractExplore(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const query = pickStr(obj, ["query", "topic", "question", "goal", "prompt"])
  const paths = pickArray(obj, ["paths", "dirs", "directories", "targets"])
  const base = pickStr(obj, ["path", "root", "cwd"])
  const strategy = pickStr(obj, ["strategy", "mode", "approach"])
  const depth = pickNum(obj, ["depth", "maxDepth", "max_depth"])
  const breadth = pickNum(obj, ["breadth", "width", "fanout"])
  if (
    query === undefined &&
    paths === undefined &&
    base === undefined &&
    strategy === undefined &&
    depth === undefined &&
    breadth === undefined
  ) {
    return emptyVm()
  }
  const scope = [depth, breadth].filter((n) => n !== undefined)
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.query, query),
    base === undefined ? undefined : row(FIELDS.path, base, true),
    paths === undefined
      ? undefined
      : row(FIELDS.target, paths.map((p) => String(p)).join(", "), true),
    row(FIELDS.strategy, strategy),
    // Scope knobs collapse into one "depth×breadth"-style row when both land.
    scope.length === 2
      ? row(FIELDS.scope, `depth ${depth} × breadth ${breadth}`)
      : depth !== undefined
        ? row(FIELDS.scope, `depth ${depth}`)
        : breadth !== undefined
          ? row(FIELDS.scope, `breadth ${breadth}`)
          : undefined,
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(query ?? base ?? strategy ?? ""),
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
