// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workflow tool model layer: create-workflow, save-workflow,
 * get-workflow-run, list-saved-workflows, list-workflow-runs,
 * resume-workflow-run, resolve-workflow-question,
 * get-workflow-run-roster, get-workflow-run-situation,
 * eval-workflow-snippet, workflow-diagnostics. The dynamic-workflow
 * family keys on runId / workflowId / status / phase — every extractor
 * pulls the full defensive key group so each body shows at least three
 * structured fields (run · workflow · status/phase/count …) when the
 * event carries them.
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
  type RendererCode,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"

function runField(obj: Record<string, unknown>): string | undefined {
  return pickStr(obj, ["runId", "run_id", "workflowRunId", "workflow_run_id", "id"])
}

function workflowField(obj: Record<string, unknown>): string | undefined {
  return pickStr(obj, ["workflowId", "workflow_id", "name", "workflow", "workflowName"])
}

function statusField(obj: Record<string, unknown>): string | undefined {
  return pickStr(obj, ["status", "state", "lifecycle"])
}

function phaseField(obj: Record<string, unknown>): string | undefined {
  return pickStr(obj, ["phase", "stage", "currentPhase"])
}

function countField(
  obj: Record<string, unknown>,
  arrayKeys: string[],
  numKeys: string[],
): number | undefined {
  const entries = pickArray(obj, arrayKeys)
  if (entries !== undefined) return entries.length
  return pickNum(obj, numKeys)
}

/** Numbered one-line-per-entry preview block (steps, models, runs). */
function numberedBlock(entries: unknown[], maxLines = 12): RendererCode | undefined {
  if (entries.length === 0) return undefined
  return {
    text: entries.map((e, i) => `${i + 1}. ${jsonPreview(e, 120)}`).join("\n"),
    maxLines,
  }
}

function codeBlock(obj: Record<string, unknown>, keys: string[]): RendererCode | undefined {
  const code = pickStr(obj, keys)
  return code === undefined ? undefined : { text: code, maxLines: 20 }
}

export function extractCreateWorkflow(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const name = pickStr(obj, ["name", "workflowName", "label", "title"])
  const description = pickStr(obj, ["description", "desc", "whenToUse"])
  const steps = pickArray(obj, ["steps", "phases", "stages", "asks"])
  if (!name && !description && steps === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.name, name),
    row(FIELDS.description, description),
    steps === undefined ? undefined : row(FIELDS.steps, steps.length),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(name ?? ""),
    numberedBlock(steps ?? []),
  )
}

export function extractSaveWorkflow(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const name = pickStr(obj, ["name", "workflowName", "label", "title"])
  const scope = pickStr(obj, ["scope", "visibility"])
  const description = pickStr(obj, ["description", "desc"])
  const force = pickBool(obj, ["force", "overwrite"])
  if (!name && !scope && !description && force === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.name, name),
    row(FIELDS.scope, scope),
    row(FIELDS.description, description),
    force === undefined ? undefined : row(FIELDS.force, force ? "true" : "false", true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(name ?? ""),
  )
}

export function extractGetWorkflowRun(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const runId = runField(obj)
  const workflowId = workflowField(obj)
  const status = statusField(obj)
  const phase = phaseField(obj)
  if (!runId && !workflowId && !status && !phase) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
    row(FIELDS.status, status),
    row(FIELDS.phase, phase),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(runId ?? workflowId ?? status ?? ""),
  )
}

export function extractListSavedWorkflows(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const scope = pickStr(obj, ["scope", "visibility", "filter"])
  const query = pickStr(obj, ["query", "search", "q"])
  const count = countField(obj, ["workflows", "saved", "items", "results"], ["count", "total"])
  const limit = pickNum(obj, ["limit", "max"])
  if (!scope && !query && count === undefined && limit === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.scope, scope),
    row(FIELDS.query, query),
    count === undefined ? undefined : row(FIELDS.count, count),
    limit === undefined ? undefined : row(FIELDS.limit, limit),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(scope ?? query ?? ""),
  )
}

export function extractListWorkflowRuns(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const status = statusField(obj) ?? pickStr(obj, ["filter"])
  const limit = pickNum(obj, ["limit", "count", "max"])
  const workflowId = workflowField(obj)
  const runCount = countField(obj, ["runs", "items", "results"], ["total"])
  if (!status && limit === undefined && !workflowId && runCount === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.status, status),
    limit === undefined ? undefined : row(FIELDS.limit, limit),
    row(FIELDS.workflow, workflowId, true),
    runCount === undefined ? undefined : row(FIELDS.count, runCount),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(status ?? workflowId ?? ""),
  )
}

export function extractResumeWorkflowRun(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const runId = runField(obj)
  const workflowId = workflowField(obj)
  const status = statusField(obj)
  const phase = phaseField(obj)
  if (!runId && !workflowId && !status && !phase) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
    row(FIELDS.status, status),
    row(FIELDS.phase, phase),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(runId ?? workflowId ?? ""),
  )
}

export function extractResolveWorkflowQuestion(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const questionId = pickStr(obj, ["questionId", "question_id", "id"])
  const answer = pickStr(obj, ["answer", "response", "reply", "text"])
  const runId = runField(obj)
  const question = pickStr(obj, ["question", "prompt", "summary"])
  if (!questionId && !answer && !runId && !question) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.id, questionId, true),
    row(FIELDS.run, runId, true),
    row(FIELDS.question, question),
    row(FIELDS.answer, answer),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(questionId ?? answer ?? question ?? ""),
  )
}

export function extractGetWorkflowRunRoster(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const runId = runField(obj)
  const workflowId = workflowField(obj)
  const phase = phaseField(obj) ?? pickStr(obj, ["status"])
  const actors = pickArray(obj, ["actors", "roster", "subagents", "members"])
  if (!runId && !workflowId && !phase && actors === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
    row(FIELDS.phase, phase),
    actors === undefined ? undefined : row(FIELDS.count, actors.length),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(runId ?? workflowId ?? phase ?? ""),
  )
}

export function extractGetWorkflowRunSituation(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const runId = runField(obj)
  const workflowId = workflowField(obj)
  const status = statusField(obj)
  const phase = phaseField(obj)
  if (!runId && !workflowId && !status && !phase) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
    row(FIELDS.status, status),
    row(FIELDS.phase, phase),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(runId ?? workflowId ?? phase ?? status ?? ""),
  )
}

export function extractEvalWorkflowSnippet(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const code = pickStr(obj, ["code", "snippet", "script", "source"])
  const timeout = pickNum(obj, ["timeoutMs", "timeout_ms", "timeout"])
  const assertionEntries = pickArray(obj, ["assertions", "expects", "checks"])
  const assertions =
    assertionEntries !== undefined
      ? assertionEntries.length
      : pickNum(obj, ["assertionCount", "assertion_count", "expectCount"])
  if (!code && timeout === undefined && assertions === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    timeout === undefined ? undefined : row(FIELDS.timeout, timeout),
    assertions === undefined ? undefined : row(FIELDS.assertions, assertions),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(code ?? ""),
    codeBlock(obj, ["code", "snippet", "script", "source"]),
  )
}

export function extractWorkflowDiagnostics(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const runId = runField(obj)
  const workflowId = workflowField(obj)
  const phase = phaseField(obj)
  const status = statusField(obj)
  if (!runId && !workflowId && !phase && !status) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
    row(FIELDS.phase, phase),
    row(FIELDS.status, status),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(runId ?? workflowId ?? phase ?? ""),
  )
}
