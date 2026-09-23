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
 * family keys on name / workflowId / runId / phase — extraction is
 * defensive across the known aliases.
 */

import {
  FIELDS,
  asRecord,
  emptyVm,
  oneLine,
  pickNum,
  pickStr,
  row,
  vmFrom,
  type RendererCode,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"

function runField(obj: Record<string, unknown>): string | undefined {
  return pickStr(obj, ["runId", "run_id", "workflowRunId", "id"])
}

function workflowField(obj: Record<string, unknown>): string | undefined {
  return pickStr(obj, ["workflowId", "workflow_id", "name", "workflow", "workflowName"])
}

function codeBlock(obj: Record<string, unknown>, keys: string[]): RendererCode | undefined {
  const code = pickStr(obj, keys)
  return code === undefined ? undefined : { text: code, maxLines: 20 }
}

export function extractCreateWorkflow(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const name = pickStr(obj, ["name", "workflowName", "label", "title"])
  const description = pickStr(obj, ["description", "desc", "whenToUse"])
  if (!name && !description) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.name, name),
    row(FIELDS.description, description),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(name ?? ""),
  )
}

export function extractSaveWorkflow(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const name = pickStr(obj, ["name", "workflowName", "label", "title"])
  const scope = pickStr(obj, ["scope", "visibility"])
  const description = pickStr(obj, ["description", "desc"])
  if (!name && !scope && !description) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.name, name),
    row(FIELDS.scope, scope),
    row(FIELDS.description, description),
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
  if (!runId && !workflowId) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(runId ?? workflowId ?? ""),
  )
}

export function extractListSavedWorkflows(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const scope = pickStr(obj, ["scope", "visibility", "filter"])
  const query = pickStr(obj, ["query", "search", "q"])
  if (!scope && !query) return emptyVm()
  const rows: Array<RendererRow | undefined> = [row(FIELDS.scope, scope), row(FIELDS.query, query)]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(scope ?? query ?? ""),
  )
}

export function extractListWorkflowRuns(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const status = pickStr(obj, ["status", "state", "filter"])
  const limit = pickNum(obj, ["limit", "count", "max"])
  const workflowId = workflowField(obj)
  if (!status && limit === undefined && !workflowId) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.status, status),
    limit === undefined ? undefined : row(FIELDS.limit, limit),
    row(FIELDS.workflow, workflowId, true),
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
  if (!runId && !workflowId) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
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
  if (!questionId && !answer) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.id, questionId, true),
    row(FIELDS.answer, answer),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(questionId ?? answer ?? ""),
  )
}

export function extractGetWorkflowRunRoster(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const runId = runField(obj)
  const phase = pickStr(obj, ["phase", "stage", "status"])
  if (!runId && !phase) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.phase, phase),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(runId ?? phase ?? ""),
  )
}

export function extractGetWorkflowRunSituation(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const runId = runField(obj)
  const workflowId = workflowField(obj)
  if (!runId && !workflowId) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(runId ?? workflowId ?? ""),
  )
}

export function extractEvalWorkflowSnippet(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const code = pickStr(obj, ["code", "snippet", "script", "source"])
  const timeout = pickNum(obj, ["timeoutMs", "timeout_ms", "timeout"])
  if (!code && timeout === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    timeout === undefined ? undefined : row(FIELDS.timeout, timeout),
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
  const phase = pickStr(obj, ["phase", "stage"])
  if (!runId && !workflowId && !phase) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
    row(FIELDS.phase, phase),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(runId ?? workflowId ?? phase ?? ""),
  )
}
