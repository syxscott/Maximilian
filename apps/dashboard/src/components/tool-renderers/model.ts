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

export function summarizeToolInput(tool: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>
  switch (tool) {
    case "bash":
      return head(str(obj.command) ?? "")
    case "read":
      return head(str(obj.file_path) ?? "")
    case "write":
      return head(str(obj.file_path) ?? "")
    case "edit":
      return head(str(obj.file_path) ?? "")
    case "glob":
      return head(str(obj.pattern) ?? "")
    case "grep":
      return head(str(obj.pattern) ?? "")
    case "permission":
      return head(str(obj.tool) ?? "")
    case "lsp":
      return head(str(obj.method) ?? "")
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
import {
  extractAgent,
  extractTask,
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
    case "bash": {
      const r = rowsFrom(obj, [
        ["command", "command", true],
        ["timeout", "timeout (ms)"],
      ])
      r.title = head(str(obj.command) ?? "")
      return r
    }
    case "read": {
      const r = rowsFrom(obj, [
        ["file_path", "file", true],
        ["offset", "offset"],
        ["limit", "limit"],
      ])
      r.title = head(str(obj.file_path) ?? "")
      return r
    }
    case "write": {
      const r = rowsFrom(obj, [
        ["file_path", "file", true],
        ["content", "content", true],
      ])
      r.title = head(str(obj.file_path) ?? "")
      const content = str(obj.content)
      if (content) {
        r.rows.push({ label: "bytes", value: String(new TextEncoder().encode(content).length) })
      }
      return r
    }
    case "edit": {
      const r = rowsFrom(obj, [
        ["file_path", "file", true],
        ["oldString", "old", true],
        ["newString", "new", true],
      ])
      r.title = head(str(obj.file_path) ?? "")
      return r
    }
    case "glob": {
      const r = rowsFrom(obj, [
        ["pattern", "pattern", true],
        ["path", "base", true],
      ])
      r.title = head(str(obj.pattern) ?? "")
      return r
    }
    case "grep": {
      const r = rowsFrom(obj, [
        ["pattern", "pattern", true],
        ["path", "base", true],
      ])
      r.title = head(str(obj.pattern) ?? "")
      return r
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
