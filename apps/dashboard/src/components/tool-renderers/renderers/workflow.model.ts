// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workflow tool model layer: create-workflow, save-workflow,
 * get-workflow-run, list-saved-workflows, list-workflow-runs,
 * resume-workflow-run, resolve-workflow-question,
 * get-workflow-run-roster, get-workflow-run-situation,
 * eval-workflow-snippet, workflow-diagnostics, amend-workflow. The
 * dynamic-workflow family keys on runId / workflowId / status / phase —
 * every extractor pulls the full defensive key group so each body shows
 * at least three structured fields (run · workflow · status/phase/count …)
 * when the event carries them. The run-shaped extractors additionally
 * read the engine's WorkflowRunReport fields (scriptHash · completed ·
 * skippedFromJournal · phaseProgress — packages/workflow-engine/src/
 * index.ts), and the run/workflow/status/phase key groups are shared
 * with workflow-cards.model.ts (the compact-card variants).
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

/** Shared defensive key groups (also imported by workflow-cards.model.ts). */
export function runField(obj: Record<string, unknown>): string | undefined {
  return pickStr(obj, ["runId", "run_id", "workflowRunId", "workflow_run_id", "id"])
}

export function workflowField(obj: Record<string, unknown>): string | undefined {
  return pickStr(obj, ["workflowId", "workflow_id", "name", "workflow", "workflowName"])
}

export function statusField(obj: Record<string, unknown>): string | undefined {
  return pickStr(obj, ["status", "state", "lifecycle"])
}

export function phaseField(obj: Record<string, unknown>): string | undefined {
  return pickStr(obj, ["phase", "stage", "currentPhase"])
}

/** Wall-clock duration of a run (candidates mirror the runtime events
 *  and variant-runner.ts's VariantScore.durationMs). */
export function durationField(obj: Record<string, unknown>): number | undefined {
  return pickNum(obj, ["durationMs", "duration_ms", "elapsedMs", "elapsed_ms"])
}

/**
 * Byte-identical script identity of a run (WorkflowDefinition.scriptHash /
 * WorkflowRunReport.scriptHash). Resume refuses mismatches, so the hash is
 * the run's content identity — never rendered off the id row.
 */
export function scriptHashField(obj: Record<string, unknown>): string | undefined {
  return pickStr(obj, ["scriptHash", "script_hash"])
}

/** WorkflowRunReport.skippedFromJournal — steps short-circuited from the
 *  journal on resume (the engine's replay bookkeeping). */
export function skippedFromJournalField(obj: Record<string, unknown>): number | undefined {
  return pickNum(obj, ["skippedFromJournal", "skipped_from_journal"])
}

/** Engine progress — completed steps over the run's total. The total is
 *  optional: WorkflowRunReport carries completed[]/phaseProgress but no
 *  total, so one only renders when the payload states it. */
export interface WorkflowProgress {
  completed: number
  total?: number
}

const PROGRESS_COMPLETED_KEYS = [
  "completedSteps",
  "completed_steps",
  "completedCount",
  "completed_count",
]
const PROGRESS_TOTAL_KEYS = ["totalSteps", "total_steps", "stepsTotal", "steps_total"]

/**
 * Run progress from the engine's shapes: an explicit completed count, the
 * WorkflowRunReport.completed[] array, or the per-phase phaseProgress
 * entries ({ phase, completedSteps } — index.ts buildPhaseProgress) summed.
 * Total comes from an explicit total-steps number or the definition's
 * steps[] length; a total below the completed count clamps it.
 */
export function progressField(obj: Record<string, unknown>): WorkflowProgress | undefined {
  const explicit = pickNum(obj, PROGRESS_COMPLETED_KEYS)
  const completedArr = pickArray(obj, ["completed"])
  const phaseEntries = pickArray(obj, ["phaseProgress", "phase_progress"])
  const completed =
    explicit ??
    (completedArr !== undefined ? completedArr.length : undefined) ??
    (phaseEntries !== undefined
      ? phaseEntries.reduce<number>(
          (sum, entry) => sum + (pickNum(asRecord(entry), PROGRESS_COMPLETED_KEYS) ?? 0),
          0,
        )
      : undefined)
  if (completed === undefined || completed < 0) return undefined
  const totalSteps = pickArray(obj, ["steps"])
  const total = pickNum(obj, PROGRESS_TOTAL_KEYS) ?? totalSteps?.length
  if (total === undefined) return { completed }
  return { completed: Math.min(completed, total), total }
}

/** "5/8" when the total is known, the bare completed count otherwise. */
export function progressText(progress: WorkflowProgress): string {
  return progress.total === undefined
    ? String(progress.completed)
    : `${progress.completed}/${progress.total}`
}

/** Progress row value when a run payload carries progress shapes. */
function progressRow(obj: Record<string, unknown>): RendererRow | undefined {
  const progress = progressField(obj)
  return progress === undefined ? undefined : row(FIELDS.progress, progressText(progress))
}

/** Distinct phase markers across definition steps (WorkflowStep.phase —
 *  progress grouping only, per workflow-engine index.ts). */
export function distinctPhases(steps: unknown[]): number {
  const phases = new Set<string>()
  for (const step of steps) {
    const phase = pickStr(asRecord(step), ["phase"])
    if (phase !== undefined) phases.add(phase)
  }
  return phases.size
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
  // WorkflowStep.phase markers group the steps for progress reporting —
  // a phased definition surfaces its distinct phase count.
  const phaseCount = steps === undefined ? 0 : distinctPhases(steps)
  // The script is the byte-identical source the engine journals its
  // scriptHash over — the primary payload, shown as the clamped block
  // (round-3 audit: it was previously dropped to the JSON fallback).
  const script = pickStr(obj, ["script", "source"])
  // Declared workflow arguments ({ name: { type, … } }) → key count.
  const argsCount = Object.keys(asRecord(obj["args"])).length
  if (!name && !description && steps === undefined && script === undefined && argsCount === 0) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.name, name),
    row(FIELDS.description, description),
    steps === undefined ? undefined : row(FIELDS.steps, steps.length),
    phaseCount > 0 ? row(FIELDS.phases, phaseCount) : undefined,
    script === undefined ? undefined : row(FIELDS.lines, script.split("\n").length),
    argsCount > 0 ? row(FIELDS.args, argsCount) : undefined,
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(name ?? ""),
    script === undefined ? numberedBlock(steps ?? []) : { text: script, maxLines: 20 },
  )
}

export function extractSaveWorkflow(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const name = pickStr(obj, ["name", "workflowName", "label", "title"])
  const scope = pickStr(obj, ["scope", "visibility"])
  // whenToUse is the facade's discovery alias for description.
  const description = pickStr(obj, ["description", "desc", "whenToUse"])
  const force = pickBool(obj, ["force", "overwrite"])
  const script = pickStr(obj, ["script", "source"])
  const argsCount = Object.keys(asRecord(obj["args"])).length
  if (
    !name &&
    !scope &&
    !description &&
    force === undefined &&
    script === undefined &&
    argsCount === 0
  ) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.name, name),
    row(FIELDS.scope, scope),
    row(FIELDS.description, description),
    force === undefined ? undefined : row(FIELDS.force, force ? "true" : "false", true),
    script === undefined ? undefined : row(FIELDS.lines, script.split("\n").length),
    argsCount > 0 ? row(FIELDS.args, argsCount) : undefined,
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(name ?? ""),
    script === undefined ? undefined : { text: script, maxLines: 20 },
  )
}

export function extractGetWorkflowRun(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const runId = runField(obj)
  const workflowId = workflowField(obj)
  const status = statusField(obj)
  const phase = phaseField(obj)
  // WorkflowRunReport fields (engine index.ts): the run's script identity,
  // how far it got, and how many steps were journal-skipped.
  const scriptHash = scriptHashField(obj)
  const skipped = skippedFromJournalField(obj)
  const progress = progressRow(obj)
  if (
    !runId &&
    !workflowId &&
    !status &&
    !phase &&
    scriptHash === undefined &&
    skipped === undefined &&
    progress === undefined
  ) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
    row(FIELDS.status, status),
    row(FIELDS.phase, phase),
    scriptHash === undefined ? undefined : row(FIELDS.scriptHash, scriptHash, true),
    progress,
    skipped === undefined ? undefined : row(FIELDS.skipped, skipped),
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
  // Resume replays journaled steps: the report carries the same
  // WorkflowRunReport shapes (skippedFromJournal is the resume-specific
  // count, scriptHash the byte-identity gate — WorkflowScriptChangedError).
  const scriptHash = scriptHashField(obj)
  const skipped = skippedFromJournalField(obj)
  const progress = progressRow(obj)
  if (
    !runId &&
    !workflowId &&
    !status &&
    !phase &&
    scriptHash === undefined &&
    skipped === undefined &&
    progress === undefined
  ) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
    row(FIELDS.status, status),
    row(FIELDS.phase, phase),
    scriptHash === undefined ? undefined : row(FIELDS.scriptHash, scriptHash, true),
    progress,
    skipped === undefined ? undefined : row(FIELDS.skipped, skipped),
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
  // phaseProgress is the engine's per-phase progress — a situation report
  // without it would not say how far the run got.
  const progress = progressRow(obj)
  if (!runId && !workflowId && !status && !phase && progress === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
    row(FIELDS.status, status),
    row(FIELDS.phase, phase),
    progress,
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(runId ?? workflowId ?? phase ?? status ?? ""),
  )
}

export function extractEvalWorkflowSnippet(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const code = pickStr(obj, ["code", "snippet", "script", "source"])
  // code|path are exclusive (the facade takes one or the other) — a
  // path-only snippet still names its file (round-3 audit addition).
  const path = pickStr(obj, ["path", "snippetPath", "snippet_path"])
  const timeout = pickNum(obj, ["timeoutMs", "timeout_ms", "timeout"])
  const assertionEntries = pickArray(obj, ["assertions", "expects", "checks"])
  const assertions =
    assertionEntries !== undefined
      ? assertionEntries.length
      : pickNum(obj, ["assertionCount", "assertion_count", "expectCount"])
  if (!code && path === undefined && timeout === undefined && assertions === undefined) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    timeout === undefined ? undefined : row(FIELDS.timeout, timeout),
    assertions === undefined ? undefined : row(FIELDS.assertions, assertions),
    path === undefined ? undefined : row(FIELDS.path, path, true),
    // Derived dimension beside the block: the snippet's own line count
    // (round-3 polish, mirroring create/save-workflow's script lines).
    code === undefined ? undefined : row(FIELDS.lines, code.split("\n").length),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(code ?? path ?? ""),
    codeBlock(obj, ["code", "snippet", "script", "source"]),
  )
}

export function extractWorkflowDiagnostics(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const runId = runField(obj)
  const workflowId = workflowField(obj)
  const phase = phaseField(obj)
  const status = statusField(obj)
  // Diagnostics ground on the run report: the script identity (a hash
  // mismatch is the engine's diagnostic — WorkflowScriptChangedError) and
  // how far the run got (phaseProgress).
  const scriptHash = scriptHashField(obj)
  const progress = progressRow(obj)
  if (
    !runId &&
    !workflowId &&
    !phase &&
    !status &&
    scriptHash === undefined &&
    progress === undefined
  ) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
    row(FIELDS.phase, phase),
    row(FIELDS.status, status),
    scriptHash === undefined ? undefined : row(FIELDS.scriptHash, scriptHash, true),
    progress,
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(runId ?? workflowId ?? phase ?? ""),
  )
}

export function extractAmendWorkflow(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const runId = runField(obj)
  const workflowId = workflowField(obj)
  const script =
    pickStr(obj, ["script", "revisedScript", "revised_script", "source"]) ??
    pickStr(obj, ["path", "scriptPath", "script_path"])
  const preserve = pickArray(obj, ["preserve", "keep", "reuse"])
  const settings = asRecord(obj["settings"] ?? obj["changes"] ?? obj["revision"])
  const settingKeys = Object.keys(settings)
  // The facade's settings ride flat too (settings-only amend): the
  // concurrency cap and the subagent model are first-class fields.
  const maxConcurrency = pickNum(obj, ["maxConcurrency", "max_concurrency"])
  const subagentModel = pickStr(obj, ["subagentModel", "subagent_model"])
  if (
    !runId &&
    !workflowId &&
    script === undefined &&
    preserve === undefined &&
    settingKeys.length === 0 &&
    maxConcurrency === undefined &&
    subagentModel === undefined
  ) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.run, runId, true),
    row(FIELDS.workflow, workflowId, true),
    script === undefined ? undefined : row(FIELDS.lines, script.split("\n").length),
    preserve === undefined ? undefined : row(FIELDS.count, preserve.length),
    maxConcurrency === undefined ? undefined : row(FIELDS.limit, maxConcurrency),
    subagentModel === undefined ? undefined : row(FIELDS.model, subagentModel, true),
    settingKeys.length === 0 ? undefined : row(FIELDS.settings, settingKeys.length),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(runId ?? workflowId ?? ""),
    script === undefined ? undefined : { text: script, maxLines: 20 },
  )
}
