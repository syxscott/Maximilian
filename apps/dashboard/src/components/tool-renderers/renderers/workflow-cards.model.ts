// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workflow compact-card model layer — the "*-card" variants of four
 * workflow-family renderers (get-workflow-run, list-workflow-runs,
 * resume-workflow-run, get-workflow-run-roster). The dynamic-workflow
 * card mode mounts the same payload as its full renderer but on a
 * constrained surface, so the collapsed line is composed INFO-DENSE:
 * status · phase · run · ×count in one headline, and the card body gets
 * a typed view model (chips + counts) instead of plain rows. The chip
 * dimensions (status/phase/count/run) stay OFF the row list — the body
 * renders them as chips, so nothing appears twice. Key groups are the
 * workflow.model.ts ones: same events, tighter presentation.
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
  type RendererCode,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"
import { durationField, phaseField, runField, statusField, workflowField } from "./workflow.model"

export interface WorkflowCardViewModel extends ToolViewModel {
  run?: string
  workflow?: string
  status?: string
  phase?: string
  count?: number
  durationMs?: number
}

/** Info-dense collapsed line: every present dimension, joined by " · ". */
function cardHeadline(parts: Array<string | undefined>): string {
  return oneLine(parts.filter((p): p is string => p !== undefined && p.length > 0).join(" · "))
}

/** Numbered one-line-per-entry preview (roster actor names). */
function numberedBlock(entries: string[], maxLines = 8): RendererCode | undefined {
  if (entries.length === 0) return undefined
  return { text: entries.map((name, i) => `${i + 1}. ${name}`).join("\n"), maxLines }
}

/** Actor names from a roster payload, normalized to one line each. */
function actorNames(entries: unknown[]): string[] {
  return entries.map((entry) => {
    if (typeof entry === "string") return oneLine(entry, 80)
    const obj = asRecord(entry)
    return oneLine(pickStr(obj, ["name", "id", "role", "title"]) ?? jsonPreview(entry, 60), 80)
  })
}

export function extractGetWorkflowRunCard(input: unknown): WorkflowCardViewModel {
  const obj = asRecord(input)
  const run = runField(obj)
  const workflow = workflowField(obj)
  const status = statusField(obj)
  const phase = phaseField(obj)
  const duration = durationField(obj)
  if (run === undefined && workflow === undefined && status === undefined && phase === undefined) {
    return { ...emptyVm() }
  }
  // Chips carry status · phase · run; rows keep the rest.
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.workflow, workflow, true),
    duration === undefined ? undefined : row(FIELDS.duration, duration),
  ]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      cardHeadline([status, phase, run]),
    ),
    isEmpty: false,
    ...(run === undefined ? {} : { run }),
    ...(workflow === undefined ? {} : { workflow }),
    ...(status === undefined ? {} : { status }),
    ...(phase === undefined ? {} : { phase }),
    ...(duration === undefined ? {} : { durationMs: duration }),
  }
}

export function extractListWorkflowRunsCard(input: unknown): WorkflowCardViewModel {
  const obj = asRecord(input)
  const status = statusField(obj) ?? pickStr(obj, ["filter"])
  const limit = pickNum(obj, ["limit", "count", "max"])
  const workflow = workflowField(obj)
  const entries = pickArray(obj, ["runs", "items", "results"])
  const count = entries !== undefined ? entries.length : pickNum(obj, ["total"])
  const duration = durationField(obj)
  if (
    status === undefined &&
    limit === undefined &&
    workflow === undefined &&
    count === undefined
  ) {
    return { ...emptyVm() }
  }
  // Chips carry status · count; rows keep the rest.
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.workflow, workflow, true),
    limit === undefined ? undefined : row(FIELDS.limit, limit),
    duration === undefined ? undefined : row(FIELDS.duration, duration),
  ]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      cardHeadline([status, workflow, count === undefined ? undefined : `×${count}`]),
    ),
    isEmpty: false,
    ...(status === undefined ? {} : { status }),
    ...(workflow === undefined ? {} : { workflow }),
    ...(count === undefined ? {} : { count }),
    ...(duration === undefined ? {} : { durationMs: duration }),
  }
}

export function extractResumeWorkflowRunCard(input: unknown): WorkflowCardViewModel {
  const obj = asRecord(input)
  const run = runField(obj)
  const workflow = workflowField(obj)
  const status = statusField(obj)
  const phase = phaseField(obj)
  const reason = pickStr(obj, ["reason", "cause", "note"])
  if (run === undefined && workflow === undefined && status === undefined && phase === undefined) {
    return { ...emptyVm() }
  }
  // Chips carry status · phase · run; rows keep the rest.
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.workflow, workflow, true),
    row(FIELDS.reason, reason),
  ]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      cardHeadline([run, status, phase]),
    ),
    isEmpty: false,
    ...(run === undefined ? {} : { run }),
    ...(workflow === undefined ? {} : { workflow }),
    ...(status === undefined ? {} : { status }),
    ...(phase === undefined ? {} : { phase }),
  }
}

export function extractGetWorkflowRunRosterCard(input: unknown): WorkflowCardViewModel {
  const obj = asRecord(input)
  const run = runField(obj)
  const workflow = workflowField(obj)
  const phase = phaseField(obj) ?? statusField(obj)
  const actors = pickArray(obj, ["actors", "roster", "subagents", "members"])
  if (run === undefined && workflow === undefined && phase === undefined && actors === undefined) {
    return { ...emptyVm() }
  }
  const names = actors === undefined ? [] : actorNames(actors)
  // Chips carry phase · count · run; rows keep only the workflow id.
  const rows: Array<RendererRow | undefined> = [row(FIELDS.workflow, workflow, true)]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      cardHeadline([run, phase, actors === undefined ? undefined : `×${actors.length}`]),
      numberedBlock(names),
    ),
    isEmpty: false,
    ...(run === undefined ? {} : { run }),
    ...(workflow === undefined ? {} : { workflow }),
    ...(phase === undefined ? {} : { phase }),
    ...(actors === undefined ? {} : { count: actors.length }),
  }
}
