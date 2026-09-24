// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tool-call model layer — pure extractors that turn a passthrough tool
 * event payload into typed view models. Presentation (see registry.tsx)
 * never touches the raw `unknown` input; each renderer declares a
 * `summarize` (one-line) and a `detail` (structured rows) extraction.
 * Mirrors the DisciplineFiles model/presentation split of ZCode's
 * ToolCallBlocks.
 *
 * The core tools (bash/read/glob/grep/permission/lsp) are keyed to the REAL
 * input schemas in packages/tools/src via renderers/core.model.ts — the
 * read/write/edit target is `path` (the schema field), not the historical
 * `file_path` alias. write/edit detail rendering lives in
 * renderers/edit-inline-diff.model.ts (inline oldString/newString diff).
 */

export interface ToolInputRows {
  /** Ordered (label, value) rows for the detail view. */
  rows: Array<{ label: string; value: string; mono?: boolean }>
  /** Primary target (file path / command head) for the collapsed line. */
  title: string
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)

function head(text: string, max = 120): string {
  const one = text.replace(/\s+/g, " ").trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

function rowsFrom(
  obj: Record<string, unknown>,
  spec: Array<[string, string, boolean?]>,
): ToolInputRows {
  const rows: ToolInputRows["rows"] = []
  for (const [key, label, mono] of spec) {
    const raw = obj[key]
    if (raw === undefined) continue
    const value = typeof raw === "string" ? raw : JSON.stringify(raw)
    rows.push({ label, value, mono })
  }
  return { rows, title: "" }
}

import { extractFileChange } from "./renderers/edit-inline-diff.model"
import { coreHeadline, coreInputRows } from "./renderers/core.model"

export function summarizeToolInput(tool: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>
  switch (tool) {
    case "bash":
    case "read":
    case "glob":
    case "grep":
    case "permission":
    case "lsp": {
      // Schema-aligned extraction (packages/tools input schemas) — see
      // core.model.ts for the per-tool key sets. Falls back to the raw
      // JSON (or the tool name) when nothing lands, like the default arm.
      const core = coreHeadline(tool, obj)
      if (core !== undefined && core.length > 0) return head(core)
      return head(Object.keys(obj).length > 0 ? JSON.stringify(obj) : tool)
    }
    case "write":
    case "edit":
      return head(extractFileChange(tool, obj).headline)
    default: {
      // Dedicated renderers expose a headline extractor (see renderers/)
      // — reuse it so collapsed lines read as a target, not raw JSON.
      const extractor = HEADLINE_EXTRACTORS[tool]
      if (extractor) {
        const headline = extractor(obj).headline
        if (headline.length > 0) return head(headline)
      }
      return head(Object.keys(obj).length > 0 ? JSON.stringify(obj) : tool)
    }
  }
}

// Headline extractors for the per-tool renderers (same family model files
// the bodies use). Ordered map — presentation never touches raw fields.
import { extractWebfetch, extractSearch, extractMcp } from "./renderers/web.model"
import { extractTask } from "./renderers/task.model"
import {
  extractAgent,
  extractTaskOutput,
  extractTaskStop,
  extractExplore,
  extractPlanGuidance,
} from "./renderers/agent.model"
import {
  extractAskQuestion,
  extractGoal,
  extractEscalate,
  extractTodo,
  extractSkill,
  extractSendMessage,
  extractSubmitResult,
  extractSwitchMode,
  extractListModels,
  extractReadSessionContext,
  extractRespondToCoordinator,
} from "./renderers/coordination.model"
import { extractCronCreate, extractOffpeakCreate } from "./renderers/schedule.model"
import { extractNodeRepl, extractNodeReplImageGrid } from "./renderers/repl.model"
import {
  extractCreateWorkflow,
  extractSaveWorkflow,
  extractGetWorkflowRun,
  extractListSavedWorkflows,
  extractListWorkflowRuns,
  extractResumeWorkflowRun,
  extractResolveWorkflowQuestion,
  extractGetWorkflowRunRoster,
  extractGetWorkflowRunSituation,
  extractEvalWorkflowSnippet,
  extractWorkflowDiagnostics,
} from "./renderers/workflow.model"

type HeadlineExtractor = (input: unknown) => { headline: string }

const HEADLINE_EXTRACTORS: Record<string, HeadlineExtractor> = {
  webfetch: extractWebfetch,
  search: extractSearch,
  mcp: extractMcp,
  agent: extractAgent,
  task: extractTask,
  "task-output": extractTaskOutput,
  "task-stop": extractTaskStop,
  explore: extractExplore,
  "plan-guidance": extractPlanGuidance,
  "ask-question": extractAskQuestion,
  goal: extractGoal,
  escalate: extractEscalate,
  todo: extractTodo,
  skill: extractSkill,
  "send-message": extractSendMessage,
  "submit-result": extractSubmitResult,
  "switch-mode": extractSwitchMode,
  "list-models": extractListModels,
  "read-session-context": extractReadSessionContext,
  "respond-to-coordinator": extractRespondToCoordinator,
  "cron-create": extractCronCreate,
  "offpeak-create": extractOffpeakCreate,
  "node-repl": extractNodeRepl,
  "node-repl-image-grid": extractNodeReplImageGrid,
  "create-workflow": extractCreateWorkflow,
  "save-workflow": extractSaveWorkflow,
  "get-workflow-run": extractGetWorkflowRun,
  "list-saved-workflows": extractListSavedWorkflows,
  "list-workflow-runs": extractListWorkflowRuns,
  "resume-workflow-run": extractResumeWorkflowRun,
  "resolve-workflow-question": extractResolveWorkflowQuestion,
  "get-workflow-run-roster": extractGetWorkflowRunRoster,
  "get-workflow-run-situation": extractGetWorkflowRunSituation,
  "eval-workflow-snippet": extractEvalWorkflowSnippet,
  "workflow-diagnostics": extractWorkflowDiagnostics,
}

export function toolInputRows(tool: string, input: unknown): ToolInputRows {
  const obj = (input ?? {}) as Record<string, unknown>
  switch (tool) {
    case "bash":
    case "read":
    case "glob":
    case "grep":
    case "permission":
    case "lsp":
      // Schema-aligned rows (core.model.ts); labels are the shortened
      // field names — this generic view is the fallback, the dedicated
      // bodies resolve localized labels through t().
      return { rows: coreInputRows(tool, obj), title: head(coreHeadline(tool, obj) ?? "") }
    case "write": {
      // Schema keys (write.ts {path, content}) with the historical generic
      // labels the timeline tests assert on — the dedicated body renders
      // the full rows + all-added diff via extractFileChange.
      const change = extractFileChange("write", obj)
      const content = str(obj.content)
      const rows: ToolInputRows["rows"] = [
        { label: "file", value: head(change.headline), mono: true },
      ]
      if (content !== undefined) {
        rows.push({ label: "bytes", value: String(utf8Length(content)) })
      }
      return { rows, title: head(change.headline) }
    }
    case "edit": {
      // Schema keys (edit.ts {path, oldString, newString, replaceAll}) —
      // generic rows keep the "file/old/new" contract; the inline diff in
      // the dedicated body shows the real pair.
      const change = extractFileChange("edit", obj)
      const oldText = str(obj.oldString)
      const newText = str(obj.newString)
      const rows: ToolInputRows["rows"] = [
        { label: "file", value: head(change.headline), mono: true },
      ]
      if (oldText !== undefined) {
        rows.push({ label: "old", value: head(oldText, 200), mono: true })
      }
      if (newText !== undefined) {
        rows.push({ label: "new", value: head(newText, 200), mono: true })
      }
      return { rows, title: head(change.headline) }
    }
    default: {
      const keys = Object.keys(obj)
      const rows = keys.slice(0, 8).map((k) => ({
        label: k,
        value: head(typeof obj[k] === "string" ? (obj[k] as string) : JSON.stringify(obj[k])),
        mono: true,
      }))
      return { rows, title: head(keys.length > 0 ? JSON.stringify(obj) : tool, 80) }
    }
  }
}

/** Byte length of a string in UTF-8 (write renderer detail). */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

export function lineCount(text: string): number {
  return text.split("\n").length
}

export { num, str }
