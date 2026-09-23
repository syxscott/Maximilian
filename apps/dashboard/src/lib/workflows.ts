// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workflow run model layer (P4) — journal-entry grouping for the runs
 * list. Pure and tested.
 */

export interface WorkflowJournalEntryLike {
  runId: string
  siteId: string
  ok: boolean
  output: unknown
  recordedAt: string
}

export interface WorkflowRunSummary {
  runId: string
  completedSteps: number
  failedSteps: number
  scriptHash?: string
  lastActivity: string
}

const SCRIPT_HASH_SITE = "__script_hash__"

/** Collapse a flat journal into one summary row per run, newest first. */
export function groupWorkflowRuns(entries: WorkflowJournalEntryLike[]): WorkflowRunSummary[] {
  const byRun = new Map<string, WorkflowRunSummary>()
  for (const entry of entries) {
    let summary = byRun.get(entry.runId)
    if (!summary) {
      summary = {
        runId: entry.runId,
        completedSteps: 0,
        failedSteps: 0,
        lastActivity: entry.recordedAt,
      }
      byRun.set(entry.runId, summary)
    }
    if (entry.siteId === SCRIPT_HASH_SITE) {
      summary.scriptHash = typeof entry.output === "string" ? entry.output.slice(0, 12) : undefined
      continue
    }
    if (entry.ok) summary.completedSteps += 1
    else summary.failedSteps += 1
    if (entry.recordedAt > summary.lastActivity) summary.lastActivity = entry.recordedAt
  }
  return [...byRun.values()].sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1))
}
