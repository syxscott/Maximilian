// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tool-renderers tests — the completed renderer set. Covers, per
 * CONVENTIONS: model-layer extraction (typical / missing / malformed
 * inputs), glyph resolution for every renderer (non-fallback), and render
 * smokes through ToolCallBlock with @testing-library/react.
 *
 * The extended set exercises REAL runtime event fixtures: tool-start /
 * tool-end pairs built with the exact RuntimeEvent shapes of
 * packages/core/src/runtime.ts ({type:"tool-start", workspaceId, taskId,
 * toolName, input} / {type:"tool-end", …, ok, durationMs, error?}),
 * asserting both the collapsed line and the expanded detail.
 *
 * "Final alignment" adds the last real-field pass: the eight coordination
 * / web renderers (webfetch, search, send-message, submit-result,
 * switch-mode, goal, escalate, task-stop) each get ≥3 event-fixture cases
 * covering the fields their real events carry — method/selector/excerpt,
 * result counts + top titles, message preview, metadata key count, the
 * from → to arrow, the normalized progress bar, severity labeling and the
 * stop-reason fallback.
 *
 * The "remaining twelve" round upgrades the defensive-tier renderers to
 * precise rendering the same way — read-session-context (result block),
 * respond-to-coordinator (coordinator + response-type chips), explore
 * (strategy/depth/breadth), task-output (clamped output block),
 * task-stop (stops list), list-models (numbered model block), cron-create
 * (timezone/description), offpeak-create (window range + duration),
 * node-repl (title heading + line count), node-repl-image-grid
 * (classified data-URI/URL imgs vs path list), create-workflow (step
 * count + numbered preview) and eval-workflow-snippet (assertion count) —
 * and lifts the whole workflow family to ≥3 structured fields per body
 * (run · workflow · status/phase/count). Each upgraded renderer carries
 * ≥3 real event fixtures (typical / missing-field / malformed).
 *
 * Core tools (bash/read/glob/grep/permission/lsp) are asserted against the
 * input schemas of packages/tools/src — field names, optionality and
 * defaults (e.g. read's `path`/offset/limit, bash's 120000 ms default
 * timeout capped at 600000, glob/grep limit default 100).
 *
 * The "ai-elements mounts" round wires the previously unconsumed
 * ai-elements widgets into the real render surfaces: bash swaps its code
 * block for CommandBlock (exit-code badge), write output becomes a
 * DocumentPreviewBlock, the webfetch summary a LinkPreviewCard, search
 * hits CitationBlock ordinals, task/agent grow a StatusPill spawn-status
 * capsule, usage-bearing payloads (submit-result, respond-to-coordinator)
 * a TokenUsageBadge, every measured call a LatencyMeter, failures an
 * ErrorBlock and the generic fallback JsonPeek. Assertions that pointed
 * at the old DOM moved to the new widgets; the model-layer expectations
 * are untouched.
 *
 * The domain dictionaries are registered here directly (the aggregator
 * in src/locales/index.ts is main-session-owned), which also lets us
 * assert zh/en key parity.
 *
 * The "round-3 field audit" completes the real-event verification pass:
 * RENDERER_FIELD_AUDIT (renderers/audit.ts) maps every registry key's
 * extracted fields to the real source they were checked against — the
 * packages/tools/src input schemas, the core runtime passthrough
 * (tool-integration.ts forwards ToolCall.input verbatim) and the workflow
 * engine's payload shapes — and marks the sub-3-field bodies. The audit
 * surfaced five mismatches, each fixed with fixtures here: permission's
 * pattern row and bash's explicit-timeout row were dropped on otherwise-
 * empty payloads, todo mis-read the runtime's fourth status ("cancelled",
 * packages/core/src/types.ts TodoItem), create/save-workflow ignored the
 * script + declared-args payload, and eval-workflow-snippet dropped the
 * path form.
 *
 * The "round-3 polish" closes the audit's low-density remainder: the group
 * renderers gain a countOutcomes summary row (✓ ok / ✗ failed / unrecorded
 * badges), ToolCallBlock carries the failure error on the collapsed row as
 * a single truncated red line with the full text in its title tooltip, and
 * the last sub-3-field bodies are topped up (skill's args key count, todo's
 * per-status tallies + done/total line, exit-plan-mode's allow-list
 * preview, eval-workflow-snippet's snippet line count) — leaving only edit
 * and list-apps as deliberate primary-plus-fallback entries.
 */

import { describe, it, expect, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import zhDomain from "../src/locales/tool-renderers.zh-CN.json"
import enDomain from "../src/locales/tool-renderers.en-US.json"
import aiZhDomain from "../src/locales/ai-elements.zh-CN.json"
import aiEnDomain from "../src/locales/ai-elements.en-US.json"
import {
  ToolCallBlock,
  resolveToolRenderer,
  type ToolRendererDef,
} from "../src/components/tool-renderers/registry"
import { summarizeToolInput, toolInputRows } from "../src/components/tool-renderers/model"
import { RENDERED_TOOLS, RENDERERS } from "../src/components/tool-renderers/renderers/index"
import {
  LOW_DENSITY_RENDERERS,
  RENDERER_FIELD_AUDIT,
} from "../src/components/tool-renderers/renderers/audit"
import {
  extractWebfetch,
  extractSearch,
  extractMcp,
  urlHost,
} from "../src/components/tool-renderers/renderers/web.model"
import { extractTask, spawnStatus } from "../src/components/tool-renderers/renderers/task.model"
import {
  extractAgent,
  extractTaskOutput,
  extractTaskStop,
  extractExplore,
  extractPlanGuidance,
} from "../src/components/tool-renderers/renderers/agent.model"
import {
  extractAskQuestion,
  extractGoal,
  extractEscalate,
  extractTodo,
  extractSkill,
  extractSendMessage,
  extractRespondToCoordinator,
  extractSubmitResult,
  extractSwitchMode,
  extractListModels,
  extractReadSessionContext,
  normalizeProgress,
} from "../src/components/tool-renderers/renderers/coordination.model"
import {
  extractBash,
  extractRead,
  extractGlob,
  extractGrep,
  extractPermission,
  extractLsp,
  coreInputRows,
  BASH_DEFAULT_TIMEOUT_MS,
  BASH_MAX_TIMEOUT_MS,
  SEARCH_LIMIT_DEFAULT,
} from "../src/components/tool-renderers/renderers/core.model"
import {
  extractCronCreate,
  extractOffpeakCreate,
} from "../src/components/tool-renderers/renderers/schedule.model"
import {
  extractNodeRepl,
  extractNodeReplImageGrid,
  isRenderableImageSrc,
} from "../src/components/tool-renderers/renderers/repl.model"
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
  extractAmendWorkflow,
} from "../src/components/tool-renderers/renderers/workflow.model"
import {
  extractGetWorkflowRunCard,
  extractListWorkflowRunsCard,
  extractResumeWorkflowRunCard,
  extractGetWorkflowRunRosterCard,
} from "../src/components/tool-renderers/renderers/workflow-cards.model"
import {
  extractAgentPrompt,
  extractEnterPlanMode,
  extractExitPlanMode,
} from "../src/components/tool-renderers/renderers/prompt.model"
import {
  extractCuaAction,
  extractGetAppState,
  extractListApps,
  extractScreenshot,
  screenshotIsRenderable,
} from "../src/components/tool-renderers/renderers/cua.model"
import {
  extractBrowserNavigate,
  extractBrowserAction,
} from "../src/components/tool-renderers/renderers/browser.model"
import {
  countOutcomes,
  extractGroupChildren,
} from "../src/components/tool-renderers/renderers/group.model"
import { extractFileChange } from "../src/components/tool-renderers/renderers/edit-inline-diff.model"
import { usageOf } from "../src/components/tool-renderers/renderers/shared.model"

// Register the domain dictionaries over the core ones (en-US is the test
// locale per test/setup.ts; zh-CN registered for the localized smoke).
// The mounted ai-elements widgets (CommandBlock, StatusPill, JsonPeek, …)
// read the aiElements.* keys, so that domain is flattened in as well.
function flatten(tree: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === "object") {
      Object.assign(out, flatten(value as Record<string, unknown>, dotted))
    } else {
      out[dotted] = String(value)
    }
  }
  return out
}
const en = {
  ...(getDictionary("en-US") ?? {}),
  ...(enDomain as Record<string, string>),
  ...flatten(aiEnDomain as Record<string, unknown>),
}
const zh = {
  ...(getDictionary("zh-CN") ?? {}),
  ...(zhDomain as Record<string, string>),
  ...flatten(aiZhDomain as Record<string, unknown>),
}
registerLocale("en-US", en)
registerLocale("zh-CN", zh)
setLocale("en-US")

afterEach(() => {
  cleanup()
  setLocale("en-US")
})

/** The 54 non-core tools this renderer set registers. */
const NEW_TOOLS = [
  "webfetch",
  "search",
  "mcp",
  "agent",
  "agent-prompt",
  "task",
  "task-output",
  "task-stop",
  "explore",
  "plan-guidance",
  "enter-plan-mode",
  "exit-plan-mode",
  "ask-question",
  "goal",
  "escalate",
  "todo",
  "todo-read",
  "todo-write",
  "skill",
  "send-message",
  "submit-result",
  "switch-mode",
  "list-models",
  "read-session-context",
  "respond-to-coordinator",
  "cron-create",
  "offpeak-create",
  "node-repl",
  "node-repl-image-grid",
  "cua-action",
  "get-app-state",
  "list-apps",
  "screenshot",
  "browser-navigate",
  "browser-action",
  "create-workflow",
  "save-workflow",
  "amend-workflow",
  "get-workflow-run",
  "list-saved-workflows",
  "list-workflow-runs",
  "resume-workflow-run",
  "resolve-workflow-question",
  "get-workflow-run-roster",
  "get-workflow-run-situation",
  "eval-workflow-snippet",
  "workflow-diagnostics",
  "get-workflow-run-card",
  "list-workflow-runs-card",
  "resume-workflow-run-card",
  "get-workflow-run-roster-card",
  "execute-group",
  "changes-group",
  "cua-group",
]

const CORE_TOOLS = ["bash", "read", "glob", "grep", "permission", "lsp", "edit", "write"]

const ALL_EXTRACTORS: Array<(input: unknown) => { isEmpty: boolean }> = [
  extractBash,
  extractRead,
  extractGlob,
  extractGrep,
  extractPermission,
  extractLsp,
  extractTask,
  extractWebfetch,
  extractSearch,
  extractMcp,
  extractAgent,
  extractTaskOutput,
  extractTaskStop,
  extractExplore,
  extractPlanGuidance,
  extractAskQuestion,
  extractGoal,
  extractEscalate,
  extractTodo,
  extractSkill,
  extractSendMessage,
  extractRespondToCoordinator,
  extractSubmitResult,
  extractSwitchMode,
  extractListModels,
  extractReadSessionContext,
  extractCronCreate,
  extractOffpeakCreate,
  extractNodeRepl,
  extractNodeReplImageGrid,
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
  extractAmendWorkflow,
  extractGetWorkflowRunCard,
  extractListWorkflowRunsCard,
  extractResumeWorkflowRunCard,
  extractGetWorkflowRunRosterCard,
  extractAgentPrompt,
  extractEnterPlanMode,
  extractExitPlanMode,
  extractCuaAction,
  extractGetAppState,
  extractListApps,
  extractScreenshot,
  extractBrowserNavigate,
  extractBrowserAction,
]

const MALFORMED: unknown[] = [null, undefined, 42, "text", [], { nested: { deep: true } }]

// ── runtime event fixtures (packages/core/src/runtime.ts shapes) ────────────

const WORKSPACE_ID = "ws-20260924"
const TASK_ID = "task-7"

/** Exact shape of the runtime's `tool-start` RuntimeEvent. */
interface ToolStartEvent {
  type: "tool-start"
  workspaceId: string
  taskId: string
  toolName: string
  input?: unknown
}

/** Exact shape of the runtime's `tool-end` RuntimeEvent. */
interface ToolEndEvent {
  type: "tool-end"
  workspaceId: string
  taskId: string
  toolName: string
  ok: boolean
  durationMs: number
  error?: string
}

function toolStart(toolName: string, input: unknown): ToolStartEvent {
  return { type: "tool-start", workspaceId: WORKSPACE_ID, taskId: TASK_ID, toolName, input }
}

function toolEnd(toolName: string, ok = true, durationMs = 42, error?: string): ToolEndEvent {
  return {
    type: "tool-end",
    workspaceId: WORKSPACE_ID,
    taskId: TASK_ID,
    toolName,
    ok,
    durationMs,
    error,
  }
}

/** Render one event pair through the registry (open, so detail is visible). */
function renderPair(start: ToolStartEvent, end: ToolEndEvent) {
  return render(
    <ToolCallBlock
      tool={start.toolName}
      input={start.input}
      ok={end.ok}
      durationMs={end.durationMs}
      error={end.error}
      defaultOpen
    />,
  )
}

/** Render a single open block (input-level fixtures). */
function renderInput(tool: string, input: unknown) {
  return render(<ToolCallBlock tool={tool} input={input} defaultOpen />)
}

/** Value of the detail row with the given (localized) label, if rendered. */
function rowValue(label: string): string | undefined {
  const body = screen.getByTestId("tool-body")
  const dts = [...body.querySelectorAll("dt")]
  const match = dts.find((el) => el.textContent === label)
  return match?.nextElementSibling?.textContent ?? undefined
}

/** All detail row labels currently rendered. */
function rowLabels(): string[] {
  return [...screen.getByTestId("tool-body").querySelectorAll("dt")].map(
    (el) => el.textContent ?? "",
  )
}

describe("glyph resolution", () => {
  it("every new renderer resolves to a dedicated glyph (not the · fallback) with a Body", () => {
    expect(NEW_TOOLS).toHaveLength(54)
    for (const tool of NEW_TOOLS) {
      const def = resolveToolRenderer(tool)
      expect(def.glyph, tool).not.toBe("·")
      expect(def.glyph.length, tool).toBeGreaterThan(0)
      expect(def.Body, tool).toBeDefined()
    }
  })

  it("keeps the core glyphs and the fallback intact — now with dedicated bodies", () => {
    expect(resolveToolRenderer("bash").glyph).toBe("$")
    expect(resolveToolRenderer("read").glyph).toBe("›")
    expect(resolveToolRenderer("edit").glyph).toBe("±")
    expect(resolveToolRenderer("write").glyph).toBe("+")
    expect(resolveToolRenderer("totally-unknown-tool").glyph).toBe("·")
    expect(resolveToolRenderer("totally-unknown-tool").Body).toBeUndefined()
    for (const tool of CORE_TOOLS) {
      expect(resolveToolRenderer(tool).Body, tool).toBeDefined()
    }
  })

  it("exposes every rendered tool through the aggregation", () => {
    for (const tool of [...NEW_TOOLS, ...CORE_TOOLS]) {
      expect(RENDERED_TOOLS, tool).toContain(tool)
    }
  })
})

describe("i18n dictionaries", () => {
  it("zh and en key sets are identical", () => {
    expect(Object.keys(zhDomain).sort()).toEqual(Object.keys(enDomain).sort())
  })

  it("every rendered tool has a title key in both locales", () => {
    for (const tool of [...NEW_TOOLS, ...CORE_TOOLS]) {
      const key = `toolRenderers.${tool}.title`
      expect(enDomain[key as keyof typeof enDomain], key).toBeDefined()
      expect(zhDomain[key as keyof typeof zhDomain], key).toBeDefined()
    }
  })

  it("covers the new schema field labels (defaults, domains, todo statuses)", () => {
    const keys = [
      "toolRenderers.fields.timeoutDefault",
      "toolRenderers.fields.limitDefault",
      "toolRenderers.fields.workdir",
      "toolRenderers.fields.include",
      "toolRenderers.fields.range",
      "toolRenderers.fields.replaceAll",
      "toolRenderers.fields.allowedDomains",
      "toolRenderers.fields.blockedDomains",
      "toolRenderers.fields.maxTokens",
      "toolRenderers.fields.multiSelect",
      "toolRenderers.todo.status.completed",
      "toolRenderers.listModels.noFilters",
    ]
    for (const key of keys) {
      expect(enDomain[key as keyof typeof enDomain], key).toBeDefined()
      expect(zhDomain[key as keyof typeof zhDomain], key).toBeDefined()
    }
  })
})

describe("core schema alignment — bash (packages/tools/src/bash.ts)", () => {
  it("extracts every schema field: command, workdir, timeout, description", () => {
    const vm = extractBash({
      command: "pnpm vitest run",
      workdir: "apps/dashboard",
      timeout: 5000,
      description: "run the dashboard suite",
    })
    expect(vm.isEmpty).toBe(false)
    expect(vm.headline).toBe("pnpm vitest run")
    expect(vm.rows.map((r) => r.value)).toEqual([
      "run the dashboard suite",
      "apps/dashboard",
      "5000",
    ])
    expect(vm.code?.text).toBe("pnpm vitest run")
  })

  it("applies the schema default timeout (120000) and caps at the max (600000)", () => {
    expect(BASH_DEFAULT_TIMEOUT_MS).toBe(120_000)
    expect(BASH_MAX_TIMEOUT_MS).toBe(600_000)
    const defaulted = extractBash({ command: "ls" })
    expect(defaulted.rows.some((r) => r.labelKey === "toolRenderers.fields.timeoutDefault")).toBe(
      true,
    )
    expect(defaulted.rows.some((r) => r.value === "120000")).toBe(true)
    const clamped = extractBash({ command: "x", timeout: 999_999_999 })
    expect(clamped.rows.some((r) => r.value === "600000")).toBe(true)
  })

  it("stays empty for malformed payloads and non-schema fields", () => {
    expect(extractBash(null).isEmpty).toBe(true)
    expect(extractBash({ verbose: true }).isEmpty).toBe(true)
  })
})

describe("core schema alignment — read (packages/tools/src/read.ts)", () => {
  it("keys on `path` (the schema field) with optional offset/limit", () => {
    const vm = extractRead({ path: "src/app.ts", offset: 5, limit: 20 })
    expect(vm.headline).toBe("src/app.ts")
    // read.ts slices lines.slice(offset, offset+limit) and reports
    // startLine = offset+1 — the range row shows the effective window.
    expect(vm.rows.map((r) => r.value)).toEqual(["src/app.ts", "5", "20", "6-25"])
  })

  it("accepts the historical file_path alias and renders pathless payloads defensively", () => {
    expect(extractRead({ file_path: "legacy.ts" }).headline).toBe("legacy.ts")
    expect(extractRead({ limit: 10 }).rows.some((r) => r.value === "10")).toBe(true)
    expect(extractRead({}).isEmpty).toBe(true)
  })
})

describe("core schema alignment — glob/grep (packages/tools/src)", () => {
  it("glob shows pattern/path/limit with the 100-result default", () => {
    expect(SEARCH_LIMIT_DEFAULT).toBe(100)
    const explicit = extractGlob({ pattern: "**/*.tsx", path: "src", limit: 25 })
    expect(explicit.rows.map((r) => r.value)).toEqual(["**/*.tsx", "src", "25"])
    const defaulted = extractGlob({ pattern: "**/*.ts" })
    expect(defaulted.rows.some((r) => r.value === "100")).toBe(true)
  })

  it("grep shows pattern/path/include/limit (include is the file filter)", () => {
    const vm = extractGrep({ pattern: "TODO", path: "src", include: "*.ts" })
    expect(vm.headline).toBe("TODO")
    expect(vm.rows.map((r) => r.value)).toEqual(["TODO", "src", "*.ts", "100"])
    // include alone still renders its row (schema field), just no headline
    const filterOnly = extractGrep({ include: "*.ts" })
    expect(filterOnly.isEmpty).toBe(false)
    expect(filterOnly.rows[0]?.value).toBe("*.ts")
  })
})

describe("core schema alignment — permission/lsp (packages/tools/src)", () => {
  it("permission mirrors PermissionRequestInput: tool, target, requestId, pattern, timeout", () => {
    const vm = extractPermission({
      tool: "bash",
      target: "rm -rf /tmp/x",
      requestId: "req-1",
      pattern: "rm -rf *",
      timeoutMs: 30_000,
    })
    expect(vm.headline).toBe("bash rm -rf /tmp/x")
    expect(vm.rows.map((r) => r.value)).toEqual([
      "bash",
      "rm -rf /tmp/x",
      "req-1",
      "rm -rf *",
      "30000",
    ])
  })

  it("lsp shows the client surface: method, uri, languageId and content size", () => {
    const vm = extractLsp({
      method: "diagnostics",
      uri: "file:///workspace/a.ts",
      languageId: "typescript",
      content: "const x = 1",
    })
    expect(vm.headline).toBe("diagnostics")
    expect(vm.rows.map((r) => r.value)).toEqual([
      "diagnostics",
      "file:///workspace/a.ts",
      "typescript",
      "11",
    ])
    expect(vm.code?.text).toBe("const x = 1")
    expect(extractLsp({}).isEmpty).toBe(true)
  })
})

describe("core schema alignment — registry plumbing", () => {
  it("summarize reads the schema field names (read uses `path`, not file_path)", () => {
    expect(summarizeToolInput("read", { path: "src/x.ts" })).toBe("src/x.ts")
    expect(summarizeToolInput("edit", { path: "a.ts" })).toBe("a.ts")
    expect(summarizeToolInput("write", { path: "a.ts", content: "hi" })).toBe("a.ts")
    expect(summarizeToolInput("glob", { pattern: "**/*" })).toBe("**/*")
    expect(summarizeToolInput("grep", { pattern: "x", include: "*.ts" })).toBe("x")
    expect(summarizeToolInput("permission", { tool: "bash", target: "make" })).toBe("bash make")
    expect(summarizeToolInput("lsp", { method: "documentSymbols" })).toBe("documentSymbols")
  })

  it("generic rows carry the shortened schema labels", () => {
    const { rows } = toolInputRows("read", { path: "p", offset: 5, limit: 20 })
    expect(rows.map((r) => r.label)).toEqual(["path", "offset", "limit", "range"])
    const write = toolInputRows("write", { path: "p", content: "one\ntwo" })
    expect(write.rows.map((r) => r.label)).toEqual(["file", "bytes"])
    expect(write.rows[1]?.value).toBe("7")
    const edit = toolInputRows("edit", { path: "p", oldString: "a", newString: "b" })
    expect(edit.rows.map((r) => r.label)).toEqual(["file", "old", "new"])
  })

  it("coreInputRows maps the extractor rows 1:1", () => {
    expect(coreInputRows("grep", { pattern: "p" }).map((r) => r.label)).toEqual([
      "pattern",
      "limitDefault",
    ])
  })
})

describe("edit/write schema alignment (edit-inline-diff)", () => {
  it("edit shows the real oldString/newString pair plus replaceAll", () => {
    const vm = extractFileChange("edit", {
      path: "src/a.ts",
      oldString: "const a = 1",
      newString: "const a = 2",
      replaceAll: true,
    })
    expect(vm.hasDiff).toBe(true)
    expect(vm.headline).toBe("src/a.ts")
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.replaceAll")).toBe(true)
  })

  it("write reports byte/line counts of the schema `content`", () => {
    const vm = extractFileChange("write", { path: "b.txt", content: "one\ntwo" })
    expect(vm.hasDiff).toBe(true)
    expect(vm.rows.map((r) => r.value)).toEqual(["b.txt", "7", "2"])
  })

  it("rejects snake_case pairs and half-pairs — hasDiff never lies", () => {
    expect(extractFileChange("edit", { old_string: "x", new_string: "y" }).hasDiff).toBe(false)
    expect(extractFileChange("edit", { oldString: "x" }).hasDiff).toBe(false)
  })

  it("marks fully malformed inputs empty", () => {
    const vm = extractFileChange("edit", 42)
    expect(vm.isEmpty).toBe(true)
    expect(vm.hasDiff).toBe(false)
  })
})

describe("extended tool model — agent family", () => {
  it("extractTask reads the spawn parameters: prompt, description, subagent, model", () => {
    const vm = extractTask({
      description: "review the diff",
      prompt: "Review src/** for schema drift",
      subagent_type: "reviewer",
      model: "glm-5.3",
      run_in_background: true,
    })
    expect(vm.headline).toBe("review the diff")
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.description",
      "toolRenderers.fields.subagent",
      "toolRenderers.fields.provider",
      "toolRenderers.fields.mode",
    ])
    expect(vm.rows[0]?.value).toBe("review the diff")
    expect(vm.rows[1]?.value).toBe("reviewer")
    expect(vm.code?.text).toContain("schema drift")
  })

  it("extractAgent reads name/role/model/persona and falls back to the ask", () => {
    expect(extractAgent({ name: "fixer", model: "m1" }).headline).toBe("fixer")
    expect(extractAgent({ agentRole: "explorer", prompt: "find X" }).headline).toBe("@explorer")
    expect(extractAgent({ role: "reviewer" }).rows[0]?.value).toBe("reviewer")
    expect(extractAgent({}).isEmpty).toBe(true)
  })

  it("extractTaskOutput reads taskId, block flag and timeout", () => {
    const vm = extractTaskOutput({ taskId: "t1", block: true, timeoutMs: 3000 })
    expect(vm.headline).toBe("t1")
    expect(vm.rows.map((r) => r.value)).toEqual(["t1", "true", "3000"])
  })

  it("extractTaskStop reads taskId, force and reason", () => {
    expect(extractTaskStop({ taskId: "t1", reason: "superseded" }).headline).toBe("t1")
    const forced = extractTaskStop({ task_id: "t2", force: true })
    expect(forced.rows.some((r) => r.value === "true")).toBe(true)
    expect(extractTaskStop({ reason: "done" }).headline).toBe("done")
  })

  it("extractExplore reads query + paths", () => {
    const vm = extractExplore({ query: "auth flow", paths: ["src/a", "src/b"] })
    expect(vm.headline).toBe("auth flow")
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.target")).toBe(true)
  })

  it("extractPlanGuidance reads goal/phase and numbers the step list", () => {
    const vm = extractPlanGuidance({
      goal: "ship",
      phase: "verify",
      steps: ["build", "test"],
      revision: 2,
    })
    expect(vm.headline).toBe("ship")
    expect(vm.rows.some((r) => r.value === "2")).toBe(true)
    expect(vm.code?.text).toBe("1. build\n2. test")
    expect(extractPlanGuidance({ phase: "verify" }).headline).toBe("verify")
  })
})

describe("extended tool model — web family", () => {
  it("extractWebfetch reads url + prompt and derives the host", () => {
    const vm = extractWebfetch({ url: "https://example.com/a", prompt: "sum it" })
    expect(vm.isEmpty).toBe(false)
    expect(vm.headline).toBe("https://example.com/a")
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.host")).toBe(true)
    expect(vm.rows.some((r) => r.value === "example.com")).toBe(true)
  })

  it("urlHost handles scheme variants and rejects non-URLs", () => {
    expect(urlHost("http://a.b/c?d=1")).toBe("a.b")
    expect(urlHost("not a url")).toBeUndefined()
    expect(urlHost("mailto:x@y.z")).toBeUndefined()
  })

  it("extractSearch reads query with allow/deny domain scopes", () => {
    const vm = extractSearch({
      query: "hook config",
      allowedDomains: ["a.com", "b.com"],
      blockedDomains: ["spam.net"],
    })
    expect(vm.headline).toBe("hook config")
    expect(vm.rows.some((r) => r.value === "a.com, b.com")).toBe(true)
    expect(vm.rows.some((r) => r.value === "spam.net")).toBe(true)
    const aliased = extractSearch({ pattern: "x" })
    expect(aliased.headline).toBe("x")
  })

  it("extractMcp reads server + tool + args preview", () => {
    const vm = extractMcp({ server: "context7", tool: "search", args: { q: 1 } })
    expect(vm.headline).toBe("context7 search")
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.server",
      "toolRenderers.fields.tool",
      "toolRenderers.fields.args",
    ])
  })
})

describe("extended tool model — coordination family", () => {
  it("extractAskQuestion reads question + options", () => {
    const vm = extractAskQuestion({ question: "Go?", options: ["yes", "no"] })
    expect(vm.headline).toBe("Go?")
    expect(vm.questions).toHaveLength(1)
    expect(vm.questions[0]?.options.map((o) => o.label)).toEqual(["yes", "no"])
    expect(vm.rows.some((r) => r.value === "yes | no")).toBe(true)
  })

  it("extractAskQuestion normalizes the structured questions payload", () => {
    const vm = extractAskQuestion({
      questions: [
        {
          header: "Auth",
          question: "Which library?",
          multiSelect: false,
          options: [
            { label: "jose", description: "small" },
            { label: "passport", description: "batteries included" },
          ],
        },
        { question: "Proceed?", multiSelect: true },
      ],
    })
    expect(vm.questions).toHaveLength(2)
    expect(vm.questions[0]?.header).toBe("Auth")
    expect(vm.questions[0]?.options[1]?.description).toBe("batteries included")
    expect(vm.rows.some((r) => r.value === "2")).toBe(true)
  })

  it("extractGoal reads goal/status/progress", () => {
    expect(extractGoal({ goal: "G", status: "active" }).headline).toBe("G")
    expect(extractGoal({ progress: 40 }).rows.some((r) => r.value === "40%")).toBe(true)
    expect(extractGoal({ status: "active" }).headline).toBe("active")
  })

  it("extractEscalate reads reason/target/severity and carries context", () => {
    const vm = extractEscalate({ reason: "blocked", to: "coordinator", severity: "high" })
    expect(vm.headline).toBe("blocked")
    expect(vm.rows.length).toBe(3)
    const withContext = extractEscalate({ reason: "r", context: "long background" })
    expect(withContext.code?.text).toBe("long background")
  })

  it("extractTodo counts todos and normalizes item status/priority", () => {
    const vm = extractTodo({
      todos: [
        { content: "a", status: "done", priority: "high" },
        { content: "b", status: "in_progress" },
        { content: "c", status: "pending" },
        { content: "d", status: "active" },
      ],
    })
    expect(vm.headline).toBe("×4")
    expect(vm.items.map((i) => i.status)).toEqual([
      "completed",
      "in_progress",
      "pending",
      "in_progress",
    ])
    expect(vm.items[0]?.priority).toBe("high")
    const bare = extractTodo({ todos: [{}, {}, {}] })
    expect(bare.headline).toBe("×3")
    expect(bare.rows.some((r) => r.labelKey === "toolRenderers.fields.count")).toBe(true)
  })

  it("extractSkill reads skill + args preview", () => {
    const vm = extractSkill({ skill: "pdf", args: { page: 1 } })
    expect(vm.headline).toBe("pdf")
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.args")).toBe(true)
  })

  it("extractSendMessage reads target/summary with the message body", () => {
    const vm = extractSendMessage({ to: "coord", summary: "s", message: "hi" })
    expect(vm.headline).toBe("s")
    expect(vm.rows[0]?.value).toBe("coord")
    expect(vm.code?.text).toBe("hi")
    expect(extractSendMessage({ message: "hi" }).headline).toBe("hi")
  })

  it("extractRespondToCoordinator prefers summary over message", () => {
    expect(extractRespondToCoordinator({ summary: "done", message: "all green" }).headline).toBe(
      "done",
    )
    expect(extractRespondToCoordinator({ message: "all green" }).headline).toBe("all green")
    const withTask = extractRespondToCoordinator({ summary: "s", task: "task-7" })
    expect(withTask.rows.some((r) => r.value === "task-7")).toBe(true)
  })

  it("extractSubmitResult reads summary/result with the result as a code block", () => {
    const vm = extractSubmitResult({ result: "42" })
    expect(vm.headline).toBe("42")
    expect(vm.code?.text).toBe("42")
  })

  it("extractSwitchMode reads to/from aliases and the reason", () => {
    const vm = extractSwitchMode({ from: "plan", to: "execute", reason: "approved" })
    // Both ends known → the collapsed line reads as the transition.
    expect(vm.headline).toBe("plan → execute")
    expect(vm.to).toBe("execute")
    expect(vm.from).toBe("plan")
    expect(vm.reason).toBe("approved")
    expect(vm.rows.map((r) => r.value)).toEqual(["execute", "plan", "approved"])
  })

  it("extractListModels reads provider/reasoning filters or counts models", () => {
    expect(extractListModels({ provider: "zai" }).headline).toBe("zai")
    const counted = extractListModels({ models: ["a", "b"] })
    expect(counted.isEmpty).toBe(false)
    expect(counted.rows.some((r) => r.value === "2")).toBe(true)
    expect(extractListModels({ reasoningLevel: "high" }).rows.some((r) => r.value === "high")).toBe(
      true,
    )
    expect(extractListModels({}).isEmpty).toBe(true)
  })

  it("extractReadSessionContext reads session/query/strategy/maxTokens", () => {
    const vm = extractReadSessionContext({
      sessionId: "sess_1",
      query: "find X",
      strategy: "handoff",
      maxTokens: 8000,
    })
    expect(vm.headline).toBe("sess_1")
    expect(vm.rows.length).toBe(4)
    expect(vm.rows[3]?.value).toBe("8000")
  })
})

describe("extended tool model — schedule/repl/workflow families", () => {
  it("extractCronCreate reads schedule + payload", () => {
    const vm = extractCronCreate({ schedule: "0 9 * * *", command: "pnpm test" })
    expect(vm.headline).toBe("0 9 * * *")
    expect(vm.rows.some((r) => r.value === "pnpm test")).toBe(true)
  })

  it("extractOffpeakCreate reads interval or intervalMinutes", () => {
    expect(extractOffpeakCreate({ interval: "22:00-06:00", label: "nightly" }).headline).toBe(
      "22:00-06:00",
    )
    const minutes = extractOffpeakCreate({ intervalMinutes: 30 })
    expect(minutes.headline).toBe("30m")
    expect(extractOffpeakCreate({}).isEmpty).toBe(true)
  })

  it("extractNodeRepl extracts code for monospace display", () => {
    const vm = extractNodeRepl({ code: "const a = 1\nconst b = 2", title: "demo" })
    expect(vm.headline).toBe("demo")
    expect(vm.code?.text).toBe("const a = 1\nconst b = 2")
    expect(vm.isEmpty).toBe(false)
  })

  it("extractNodeReplImageGrid counts images (locale-neutral headline)", () => {
    const vm = extractNodeReplImageGrid({ images: ["a.png", "b.png"] })
    expect(vm.headline).toBe("×2")
    expect(vm.rows.some((r) => r.value === "2")).toBe(true)
    expect(extractNodeReplImageGrid({ image: "solo.png" }).headline).toBe("solo.png")
  })

  it("extractCreateWorkflow / extractSaveWorkflow read name + scope", () => {
    expect(extractCreateWorkflow({ name: "pr-review" }).headline).toBe("pr-review")
    expect(extractSaveWorkflow({ name: "w1", scope: "project" }).headline).toBe("w1")
    expect(extractCreateWorkflow({}).isEmpty).toBe(true)
  })

  it("extractGetWorkflowRun reads runId/workflowId with id alias", () => {
    expect(extractGetWorkflowRun({ runId: "r1", workflowId: "w1" }).headline).toBe("r1")
    expect(extractGetWorkflowRun({ id: "r9" }).headline).toBe("r9")
    expect(extractGetWorkflowRun({}).isEmpty).toBe(true)
  })

  it("extractListSavedWorkflows / extractListWorkflowRuns read filters", () => {
    expect(extractListSavedWorkflows({ scope: "global" }).headline).toBe("global")
    expect(extractListWorkflowRuns({ status: "running", limit: 5 }).headline).toBe("running")
    expect(extractListWorkflowRuns({}).isEmpty).toBe(true)
  })

  it("extractResumeWorkflowRun + roster/situation/diagnostics key on run/workflow", () => {
    expect(extractResumeWorkflowRun({ runId: "r1" }).headline).toBe("r1")
    expect(extractGetWorkflowRunRoster({ runId: "r1", phase: "verify" }).headline).toBe("r1")
    expect(extractGetWorkflowRunSituation({ runId: "r2" }).headline).toBe("r2")
    expect(extractWorkflowDiagnostics({ workflowId: "w1" }).headline).toBe("w1")
  })

  it("extractResolveWorkflowQuestion reads questionId + answer", () => {
    const vm = extractResolveWorkflowQuestion({ questionId: "q1", answer: "use X" })
    expect(vm.headline).toBe("q1")
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.answer")).toBe(true)
  })

  it("extractEvalWorkflowSnippet carries a code block", () => {
    const vm = extractEvalWorkflowSnippet({ code: "const a = 1", timeoutMs: 1000 })
    expect(vm.code?.text).toBe("const a = 1")
    expect(vm.isEmpty).toBe(false)
    expect(extractEvalWorkflowSnippet({}).isEmpty).toBe(true)
  })
})

describe("group model", () => {
  it("prefers items over calls/children/subcalls", () => {
    const vm = extractGroupChildren(
      { calls: [{ tool: "read" }], items: [{ tool: "bash", command: "ls" }] },
      "execute",
    )
    expect(vm.total).toBe(1)
    expect(vm.children[0]?.tool).toBe("bash")
    expect(vm.children[0]?.input).toEqual({ tool: "bash", command: "ls" })
  })

  it("normalizes envelope fields (toolName, ok, durationMs, error)", () => {
    const vm = extractGroupChildren(
      { calls: [{ toolName: "edit", ok: false, durationMs: 7, error: { code: "E" } }] },
      "changes",
    )
    expect(vm.children[0]).toMatchObject({ tool: "edit", ok: false, durationMs: 7 })
    expect(vm.children[0]?.error).toContain("E")
  })

  it("guesses the tool from child shape when the envelope omits one", () => {
    const changes = extractGroupChildren(
      { items: [{ file_path: "a.ts", oldString: "x", newString: "y" }, { content: "hi" }] },
      "changes",
    )
    expect(changes.children.map((c) => c.tool)).toEqual(["edit", "write"])
    const execute = extractGroupChildren({ items: [{ command: "ls" }] }, "execute")
    expect(execute.children[0]?.tool).toBe("bash")
    const cua = extractGroupChildren({ items: [{ action: "click" }] }, "cua")
    expect(cua.children[0]?.tool).toBe("cua-action")
  })

  it("wraps primitive payloads so the fallback body can show them", () => {
    const vm = extractGroupChildren({ items: ["ls", 42] }, "execute")
    expect(vm.children[0]?.input).toEqual({ value: "ls" })
    expect(vm.children[1]?.input).toEqual({ value: 42 })
  })

  it("clamps to 8 shown and reports the overflow", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ command: `cmd-${i}` }))
    const vm = extractGroupChildren({ items }, "execute")
    expect(vm.total).toBe(12)
    expect(vm.shown).toBe(8)
    expect(vm.overflow).toBe(4)
  })

  it("yields an empty view for absent or non-array containers", () => {
    expect(extractGroupChildren({}, "execute").total).toBe(0)
    expect(extractGroupChildren({ calls: "nope" }, "execute").total).toBe(0)
    expect(extractGroupChildren(null, "cua").total).toBe(0)
  })
})

describe("model hardening — every extractor", () => {
  it("returns an empty view (no throw) for missing and malformed inputs", () => {
    for (const extract of ALL_EXTRACTORS) {
      for (const bad of MALFORMED) {
        const label = `${String(extract.name)} ${JSON.stringify(bad)}`
        let vm: { isEmpty: boolean } | undefined
        expect(() => {
          vm = extract(bad)
        }, label).not.toThrow()
        expect(vm?.isEmpty, label).toBe(true)
      }
    }
  })

  it("labels rows with toolRenderers i18n keys only", () => {
    const sample = [
      extractBash({ command: "ls" }),
      extractRead({ path: "p", offset: 1 }),
      extractLsp({ method: "m", uri: "u", content: "c" }),
      extractWebfetch({ url: "https://x", prompt: "y" }),
      extractTask({ prompt: "p", description: "d" }),
      extractCronCreate({ schedule: "s", command: "c" }),
      extractNodeReplImageGrid({ images: ["i"] }),
    ]
    for (const vm of sample) {
      for (const row of vm.rows) {
        expect(row.labelKey.startsWith("toolRenderers.")).toBe(true)
      }
    }
  })
})

describe("summarize (collapsed line)", () => {
  it("uses the family headline extractors", () => {
    expect(summarizeToolInput("webfetch", { url: "https://example.com/a" })).toBe(
      "https://example.com/a",
    )
    expect(summarizeToolInput("get-workflow-run", { runId: "r-123" })).toBe("r-123")
    expect(summarizeToolInput("node-repl", { code: "let x = 1" })).toBe("let x = 1")
    expect(summarizeToolInput("cron-create", { schedule: "0 9 * * *" })).toBe("0 9 * * *")
  })

  it("keeps the legacy behavior for core tools and empty inputs", () => {
    expect(summarizeToolInput("bash", { command: "ls -la" })).toBe("ls -la")
    expect(summarizeToolInput("webfetch", {})).toBe("webfetch")
    expect(summarizeToolInput("read", {})).toBe("read")
  })
})

// ── runtime event fixtures — core tools ─────────────────────────────────────

describe("event fixtures — core tools", () => {
  it("bash: collapsed command, expanded workdir/description/timeout rows, success badge", () => {
    renderPair(
      toolStart("bash", {
        command: "pnpm vitest run",
        workdir: "apps/dashboard",
        timeout: 5000,
        description: "dashboard suite",
      }),
      toolEnd("bash", true, 5123),
    )
    const row = screen.getByRole("button")
    expect(row.textContent).toContain("$")
    expect(row.textContent).toContain("pnpm vitest run")
    expect(row.textContent).toContain("5123ms")
    expect(screen.getByText("✓")).toBeInTheDocument()
    expect(rowValue("Workdir")).toBe("apps/dashboard")
    expect(rowValue("Description")).toBe("dashboard suite")
    expect(rowValue("Timeout")).toBe("5000")
    // The command card is the mounted CommandBlock (exit code unknown on
    // the input side — no badge), not the plain code block.
    const command = screen.getByLabelText("Executed command")
    expect(command).toHaveTextContent("pnpm vitest run")
    expect(screen.queryByTestId("tool-code")).toBeNull()
  })

  it("bash: schema-default timeout shown when the model omitted it", () => {
    renderPair(toolStart("bash", { command: "ls" }), toolEnd("bash"))
    expect(rowValue("Timeout (default)")).toBe("120000")
  })

  it("bash: failed tool-end surfaces the ✗ badge and the error line", () => {
    renderPair(toolStart("bash", { command: "exit 1" }), toolEnd("bash", false, 12, "boom"))
    expect(screen.getByText("✗")).toBeInTheDocument()
    expect(screen.getByTestId("tool-error")).toHaveTextContent("boom")
  })

  it("read: offset/limit produce the effective 1-based range row", () => {
    renderPair(toolStart("read", { path: "src/app.ts", offset: 5, limit: 20 }), toolEnd("read"))
    expect(screen.getByRole("button").textContent).toContain("src/app.ts")
    expect(rowValue("Offset")).toBe("5")
    expect(rowValue("Limit")).toBe("20")
    expect(rowValue("Read range")).toBe("6-25")
  })

  it("glob: pattern collapses the row; default limit shows in the detail", () => {
    renderPair(toolStart("glob", { pattern: "**/*.tsx", path: "src" }), toolEnd("glob"))
    expect(screen.getByRole("button").textContent).toContain("**/*.tsx")
    expect(rowValue("Path")).toBe("src")
    expect(rowValue("Limit (default)")).toBe("100")
  })

  it("grep: include filter renders as its own row", () => {
    renderPair(toolStart("grep", { pattern: "TODO", include: "*.ts" }), toolEnd("grep"))
    expect(rowValue("Pattern")).toBe("TODO")
    expect(rowValue("Include")).toBe("*.ts")
  })

  it("permission: tool+target headline and the request id in the detail", () => {
    renderPair(
      toolStart("permission", { tool: "bash", target: "make build", requestId: "req-9" }),
      toolEnd("permission"),
    )
    expect(screen.getByRole("button").textContent).toContain("bash make build")
    expect(rowValue("Tool")).toBe("bash")
    expect(rowValue("Target")).toBe("make build")
    expect(rowValue("ID")).toBe("req-9")
  })

  it("lsp: uri row plus the document content as a monospace block", () => {
    renderPair(
      toolStart("lsp", {
        method: "documentSymbols",
        uri: "file:///w/a.ts",
        languageId: "typescript",
        content: "export const a = 1",
      }),
      toolEnd("lsp"),
    )
    expect(rowValue("Mode")).toBe("documentSymbols")
    expect(rowValue("URI")).toBe("file:///w/a.ts")
    expect(rowValue("Language")).toBe("typescript")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("export const a = 1")
  })

  it("edit: inline diff renders the real oldString/newString via DiffPreview", () => {
    renderPair(
      toolStart("edit", {
        path: "src/a.ts",
        oldString: "const a = 1",
        newString: "const a = 2",
      }),
      toolEnd("edit"),
    )
    expect(screen.getByTestId("diff-preview")).toBeInTheDocument()
    expect(screen.getByTestId("diff-preview")).toHaveTextContent("−const a = 1")
    expect(screen.getByTestId("diff-preview")).toHaveTextContent("+const a = 2")
    expect(screen.getByTestId("tool-body").textContent).toContain("Edit file")
  })

  it("edit: replaceAll=true is visible in the detail rows", () => {
    renderPair(
      toolStart("edit", { path: "a.ts", oldString: "x", newString: "y", replaceAll: true }),
      toolEnd("edit"),
    )
    expect(rowValue("Replace all")).toBe("true")
  })

  it("write: byte/line counts of the schema content plus the document preview", () => {
    renderPair(toolStart("write", { path: "notes.md", content: "one\ntwo" }), toolEnd("write"))
    expect(rowValue("Bytes")).toBe("7")
    expect(rowValue("Lines")).toBe("2")
    // Write output is plain text → DocumentPreviewBlock, not a diff.
    expect(screen.queryByTestId("diff-preview")).toBeNull()
    expect(screen.getByText("Document · 2 lines")).toBeInTheDocument()
    expect(screen.getByTestId("tool-body")).toHaveTextContent("one")
  })
})

// ── runtime event fixtures — extended tools ─────────────────────────────────

describe("event fixtures — extended tools", () => {
  it("task: description collapses the row; subagent/model/prompt in the detail", () => {
    renderPair(
      toolStart("task", {
        description: "explore auth",
        prompt: "Map the auth flow under src/auth",
        subagent_type: "explorer",
      }),
      toolEnd("task", true, 950),
    )
    expect(screen.getByRole("button").textContent).toContain("explore auth")
    expect(rowValue("Subagent")).toBe("explorer")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("Map the auth flow")
    expect(screen.getByText("✓")).toBeInTheDocument()
  })

  it("agent: name/model rows with the persona ask as a code block", () => {
    renderPair(
      toolStart("agent", {
        name: "schema-fixer",
        model: "glm-5.3",
        system: "You fix schemas.",
        prompt: "Fix the drift",
      }),
      toolEnd("agent"),
    )
    expect(screen.getByRole("button").textContent).toContain("schema-fixer")
    expect(rowValue("Name")).toBe("schema-fixer")
    expect(rowValue("Model")).toBe("glm-5.3")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("Fix the drift")
  })

  it("todo: renders the normalized checklist with status glyphs and priority", () => {
    renderPair(
      toolStart("todo", {
        todos: [
          { content: "write schema", status: "completed", priority: "high" },
          { content: "wire body", status: "in_progress" },
          { content: "test", status: "pending" },
        ],
      }),
      toolEnd("todo"),
    )
    expect(screen.getByRole("button").textContent).toContain("×3")
    const items = screen.getAllByTestId("todo-item")
    expect(items).toHaveLength(3)
    expect(items[0]?.textContent).toContain("write schema")
    expect(items[0]?.textContent).toContain("✓")
    expect(items[1]?.textContent).toContain("◐")
    expect(screen.getByTestId("todo-priority")).toHaveTextContent("high")
  })

  it("todo: an all-empty list shows the localized empty note", () => {
    renderPair(toolStart("todo", { todos: [{}] }), toolEnd("todo"))
    expect(screen.getByTestId("tool-body")).toHaveTextContent("(empty list)")
  })

  it("ask-question: question card with header chip, options and multi-select marker", () => {
    renderPair(
      toolStart("ask-question", {
        questions: [
          {
            header: "Auth",
            question: "Which library?",
            multiSelect: false,
            options: [{ label: "jose", description: "small" }, { label: "passport" }],
          },
        ],
      }),
      toolEnd("ask-question"),
    )
    expect(screen.getByTestId("question-header")).toHaveTextContent("Auth")
    expect(screen.getByTestId("question-text")).toHaveTextContent("Which library?")
    const options = screen.getByTestId("question-options")
    expect(options.textContent).toContain("jose")
    expect(options.textContent).toContain("— small")
    expect(options.textContent).toContain("passport")
    expect(screen.queryByTestId("question-multi")).toBeNull()
  })

  it("ask-question: multiSelect marks the card; flat payloads still render", () => {
    renderPair(
      toolStart("ask-question", { question: "Go?", options: ["yes", "no"], multiSelect: true }),
      toolEnd("ask-question"),
    )
    expect(screen.getByTestId("question-multi")).toHaveTextContent("multi-select")
    expect(screen.getByTestId("question-options").textContent).toContain("yes")
  })

  it("webfetch: derived host row under the URL", () => {
    renderPair(
      toolStart("webfetch", { url: "https://example.com/docs?a=1", prompt: "sum" }),
      toolEnd("webfetch"),
    )
    expect(rowValue("URL")).toBe("https://example.com/docs?a=1")
    expect(rowValue("Host")).toBe("example.com")
    expect(rowValue("Prompt")).toBe("sum")
  })

  it("search: allow/deny domain rows", () => {
    renderPair(
      toolStart("search", {
        query: "vitest coverage",
        allowedDomains: ["vitest.dev"],
        blockedDomains: ["aggregator.io"],
      }),
      toolEnd("search"),
    )
    expect(rowValue("Allowed domains")).toBe("vitest.dev")
    expect(rowValue("Blocked domains")).toBe("aggregator.io")
  })

  it("send-message: recipient row and the message body block", () => {
    renderPair(
      toolStart("send-message", { to: "coordinator", summary: "progress", message: "half done" }),
      toolEnd("send-message"),
    )
    expect(screen.getByRole("button").textContent).toContain("progress")
    expect(rowValue("Target")).toBe("coordinator")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("half done")
  })

  it("submit-result: summary headline with the result payload block", () => {
    renderPair(
      toolStart("submit-result", { summary: "done", result: "46 renderers aligned" }),
      toolEnd("submit-result"),
    )
    expect(screen.getByRole("button").textContent).toContain("done")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("46 renderers aligned")
  })

  it("switch-mode: the body draws the from → to arrow", () => {
    renderPair(toolStart("switch-mode", { from: "plan", to: "execute" }), toolEnd("switch-mode"))
    const arrow = screen.getByTestId("switch-mode-arrow")
    expect(arrow).toHaveTextContent("plan")
    expect(arrow).toHaveTextContent("execute")
    expect(arrow.textContent).toContain("→")
  })

  it("task-stop: force flag and reason", () => {
    renderPair(
      toolStart("task-stop", { task_id: "task-7", force: true, reason: "superseded" }),
      toolEnd("task-stop"),
    )
    expect(rowValue("ID")).toBe("task-7")
    expect(rowValue("Force")).toBe("true")
    expect(rowValue("Reason")).toBe("superseded")
  })

  it("task-output: block flag and timeout rows", () => {
    renderPair(
      toolStart("task-output", { taskId: "task-7", block: true, timeout: 2500 }),
      toolEnd("task-output"),
    )
    expect(rowValue("ID")).toBe("task-7")
    expect(rowValue("Block")).toBe("true")
    expect(rowValue("Timeout")).toBe("2500")
  })

  it("goal: the progress bar carries the percent and the status stays a row", () => {
    renderPair(
      toolStart("goal", { goal: "align renderers", status: "active", progress: 60 }),
      toolEnd("goal"),
    )
    expect(screen.getByRole("button").textContent).toContain("align renderers")
    expect(rowValue("Status")).toBe("active")
    expect(screen.getByTestId("goal-progress")).toHaveTextContent("60%")
  })

  it("escalate: severity row and background context block", () => {
    renderPair(
      toolStart("escalate", {
        reason: "schema drift",
        to: "coordinator",
        severity: "high",
        context: "read.ts uses path",
      }),
      toolEnd("escalate"),
    )
    expect(rowValue("Target")).toBe("coordinator")
    expect(rowValue("Severity")).toBe("high")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("read.ts uses path")
  })

  it("list-models: localized discovery note for the usual no-arg call", () => {
    renderPair(toolStart("list-models", {}), toolEnd("list-models"))
    expect(screen.getByTestId("list-models-empty")).toHaveTextContent(
      "Discovery request — returns every configured model.",
    )
  })

  it("list-models: provider filter renders as a row when present", () => {
    renderPair(toolStart("list-models", { provider: "zai" }), toolEnd("list-models"))
    expect(rowValue("Model")).toBe("zai")
  })

  it("read-session-context: session/query/strategy/maxTokens rows", () => {
    renderPair(
      toolStart("read-session-context", {
        sessionId: "sess_9",
        query: "renderer conventions",
        strategy: "handoff",
        maxTokens: 8000,
      }),
      toolEnd("read-session-context"),
    )
    expect(screen.getByRole("button").textContent).toContain("sess_9")
    expect(rowValue("Query")).toBe("renderer conventions")
    expect(rowValue("Strategy")).toBe("handoff")
    expect(rowValue("Max tokens")).toBe("8000")
  })

  it("respond-to-coordinator: summary headline and response block", () => {
    renderPair(
      toolStart("respond-to-coordinator", { summary: "aligned", message: "all 46 green" }),
      toolEnd("respond-to-coordinator"),
    )
    expect(screen.getByRole("button").textContent).toContain("aligned")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("all 46 green")
  })

  it("plan-guidance: goal/phase rows and the numbered step block", () => {
    renderPair(
      toolStart("plan-guidance", {
        goal: "ship renderers",
        phase: "verify",
        steps: ["typecheck", "test"],
      }),
      toolEnd("plan-guidance"),
    )
    expect(rowValue("Goal")).toBe("ship renderers")
    expect(rowValue("Phase")).toBe("verify")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("1. typecheck")
  })

  it("explore: query headline with scoped paths", () => {
    renderPair(
      toolStart("explore", { query: "auth flow", paths: ["src/auth"] }),
      toolEnd("explore"),
    )
    expect(rowValue("Target")).toBe("src/auth")
  })
})

describe("render smoke (ToolCallBlock)", () => {
  it("webfetch: glyph, collapsed headline, localized title and URL row", () => {
    const { container } = render(
      <ToolCallBlock
        tool="webfetch"
        input={{ url: "https://example.com/a", prompt: "sum" }}
        defaultOpen
      />,
    )
    expect(container.querySelector('[data-testid="tool-call-webfetch"]')).not.toBeNull()
    expect(screen.getByText("⇣")).toBeInTheDocument()
    expect(within(screen.getByTestId("tool-body")).getByText("Web fetch")).toBeInTheDocument()
    // The URL appears twice now — the row and the LinkPreviewCard anchor.
    const body = screen.getByTestId("tool-body")
    expect(within(body).getAllByText("https://example.com/a").length).toBeGreaterThan(1)
    expect(within(body).getByLabelText("Link preview")).toHaveAttribute(
      "href",
      "https://example.com/a",
    )
  })

  it("node-repl: renders the code block monospace with overflow note", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `const v${i} = ${i}`).join("\n")
    render(<ToolCallBlock tool="node-repl" input={{ code: lines, title: "demo" }} defaultOpen />)
    const code = screen.getByTestId("tool-code")
    expect(code.className).toContain("font-mono")
    expect(code.textContent).toContain("const v0 = 0")
    expect(code.textContent).not.toContain("const v24 = 24")
    expect(screen.getByTestId("tool-code-overflow")).toHaveTextContent("…5 more lines")
  })

  it("falls back to JsonPeek over the raw JSON when no domain field is found", () => {
    render(<ToolCallBlock tool="create-workflow" input={{ opaque: true }} defaultOpen />)
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
    expect(screen.getByText("Raw input")).toBeInTheDocument()
    const preview = screen.getByTestId("tool-json-preview")
    // JsonPeek pretty-prints the payload (the old path was a flat dump).
    expect(preview.textContent).toContain('"opaque": true')
  })

  it("changes-group: renders 8 recursive children plus the overflow note", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      file_path: `f${i}.ts`,
      oldString: "a",
      newString: "b",
    }))
    render(<ToolCallBlock tool="changes-group" input={{ items }} defaultOpen />)
    expect(screen.getByTestId("tool-group-count")).toHaveTextContent("12 sub-calls")
    expect(screen.getAllByTestId("tool-call-edit")).toHaveLength(8)
    expect(screen.getByTestId("tool-group-more")).toHaveTextContent("4 more")
  })

  it("toggles open/closed from the collapsed row", () => {
    render(<ToolCallBlock tool="agent" input={{ name: "fixer" }} />)
    expect(screen.queryByTestId("tool-body")).toBeNull()
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByTestId("tool-body")).toBeInTheDocument()
  })

  it("surfaces tool errors in the body area", () => {
    render(
      <ToolCallBlock
        tool="task"
        input={{ description: "d" }}
        ok={false}
        error="boom"
        defaultOpen
      />,
    )
    expect(screen.getByTestId("tool-error")).toHaveTextContent("boom")
  })

  it("renders localized titles under zh-CN", () => {
    setLocale("zh-CN")
    render(<ToolCallBlock tool="webfetch" input={{ url: "https://example.com" }} defaultOpen />)
    expect(screen.getByText("网络抓取")).toBeInTheDocument()
  })

  it("renders localized schema rows under zh-CN (bash default timeout)", () => {
    setLocale("zh-CN")
    renderPair(toolStart("bash", { command: "ls" }), toolEnd("bash"))
    expect(rowValue("超时（默认）")).toBe("120000")
  })
})

// ── final alignment — model extensions (last real-field pass) ───────────────

describe("final alignment — model extensions", () => {
  it("webfetch: method/selector rows plus the excerpt block", () => {
    const vm = extractWebfetch({
      url: "https://api.example.dev/v1/items",
      method: "POST",
      selector: ".content table",
      prompt: "list the rows",
      excerpt: "3 items found",
    })
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.url",
      "toolRenderers.fields.host",
      "toolRenderers.fields.method",
      "toolRenderers.fields.selector",
      "toolRenderers.fields.prompt",
    ])
    expect(vm.rows[2]?.value).toBe("POST")
    expect(vm.rows[3]?.value).toBe(".content table")
    expect(vm.code?.text).toBe("3 items found")
  })

  it("webfetch: bare method/excerpt payloads still render without a url", () => {
    const vm = extractWebfetch({ method: "GET", excerpt: "ok" })
    expect(vm.isEmpty).toBe(false)
    expect(vm.rows.some((r) => r.value === "GET")).toBe(true)
    expect(extractWebfetch({}).isEmpty).toBe(true)
  })

  it("search: results normalize to titles, explicit counts win", () => {
    const vm = extractSearch({
      query: "vitest config",
      results: [
        { title: "Configuring Vitest" },
        { title: "Coverage guide" },
        "Plain string hit",
        { title: "Dropped beyond three" },
      ],
    })
    expect(vm.resultCount).toBe(4)
    expect(vm.topResults.map((r) => r.title)).toEqual([
      "Configuring Vitest",
      "Coverage guide",
      "Plain string hit",
    ])
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.results")).toBe(true)
    expect(vm.code?.text).toBe("1. Configuring Vitest\n2. Coverage guide\n3. Plain string hit")
    const counted = extractSearch({ query: "q", resultCount: 7 })
    expect(counted.resultCount).toBe(7)
    expect(counted.topResults).toEqual([])
  })

  it("goal: progress normalizes numbers, string percents and clamps", () => {
    expect(normalizeProgress(40)).toBe(40)
    expect(normalizeProgress("75%")).toBe(75)
    expect(normalizeProgress(140)).toBe(100)
    expect(normalizeProgress(-3)).toBe(0)
    expect(normalizeProgress("many")).toBeUndefined()
    const vm = extractGoal({ goal: "align", percent: "62%" })
    expect(vm.progress).toBe(62)
    expect(vm.goal).toBe("align")
    expect(vm.rows.some((r) => r.value === "62%")).toBe(true)
  })

  it("submit-result: metadata key count and the output alias", () => {
    const vm = extractSubmitResult({
      summary: "done",
      output: "all green",
      metadata: { durationMs: 12, files: 3, score: 9 },
    })
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.metadata")).toBe(true)
    expect(vm.rows.some((r) => r.value === "3")).toBe(true)
    expect(vm.code?.text).toBe("all green")
    expect(extractSubmitResult({ metadata: {} }).isEmpty).toBe(true)
  })

  it("escalate: severity is its own label; blocker/escalate_to aliases land", () => {
    const vm = extractEscalate({ blocker: "flaky suite", escalate_to: "human", level: "medium" })
    expect(vm.headline).toBe("flaky suite")
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.target",
      "toolRenderers.fields.severity",
      "toolRenderers.fields.reason",
    ])
    expect(vm.rows[0]?.value).toBe("human")
    expect(vm.rows[1]?.value).toBe("medium")
  })

  it("task-stop: task/why/jobId aliases and the reason headline fallback", () => {
    expect(extractTaskStop({ task: "task-9", why: "superseded" }).rows[0]?.value).toBe("task-9")
    expect(extractTaskStop({ jobId: "job-3" }).headline).toBe("job-3")
    expect(extractTaskStop({ why: "user requested" }).headline).toBe("user requested")
    const vm = extractTaskStop({ taskName: "task-2", reason: "done" })
    expect(vm.taskId).toBe("task-2")
    expect(vm.reason).toBe("done")
  })

  it("send-message: preview row and agentId alias", () => {
    const vm = extractSendMessage({ agentId: "agent-9", message: "half done" })
    expect(vm.rows[0]?.value).toBe("agent-9")
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.preview")).toBe(true)
    expect(vm.code?.text).toBe("half done")
    // The preview clamps to 80 chars with an ellipsis.
    const long = extractSendMessage({ to: "c", message: "x".repeat(200) })
    expect(long.rows.find((r) => r.labelKey === "toolRenderers.fields.preview")?.value).toMatch(
      /…$/,
    )
  })

  it("switch-mode: modeTo/modeFrom aliases fill the transition", () => {
    const vm = extractSwitchMode({ modeTo: "review", modeFrom: "execute" })
    expect(vm.to).toBe("review")
    expect(vm.from).toBe("execute")
    expect(vm.headline).toBe("execute → review")
  })
})

// ── final alignment — real event fixtures (≥3 per upgraded renderer) ────────

describe("final alignment fixtures — webfetch", () => {
  it("renders method and selector rows beside the url", () => {
    renderPair(
      toolStart("webfetch", {
        url: "https://api.example.dev/v1/items",
        method: "POST",
        selector: ".content table",
        prompt: "list the rows",
      }),
      toolEnd("webfetch", true, 640),
    )
    expect(screen.getByRole("button").textContent).toContain("api.example.dev")
    expect(rowValue("Method")).toBe("POST")
    expect(rowValue("Selector")).toBe(".content table")
    expect(rowValue("Host")).toBe("api.example.dev")
  })

  it("renders the result summary as a LinkPreviewCard", () => {
    renderPair(
      toolStart("webfetch", {
        url: "https://example.com/status",
        excerpt: "All systems operational. Incident resolved at 09:12 UTC.",
      }),
      toolEnd("webfetch", true, 210),
    )
    const card = screen.getByLabelText("Link preview")
    expect(card).toHaveTextContent("All systems operational")
    expect(card).toHaveTextContent("https://example.com/status")
    expect(rowValue("URL")).toBe("https://example.com/status")
  })

  it("surfaces a failed fetch through the tool-end error", () => {
    renderPair(
      toolStart("webfetch", { url: "https://gone.example.net/x" }),
      toolEnd("webfetch", false, 88, "HTTP 404"),
    )
    expect(screen.getByText("✗")).toBeInTheDocument()
    expect(screen.getByTestId("tool-error")).toHaveTextContent("HTTP 404")
    expect(rowValue("URL")).toBe("https://gone.example.net/x")
  })
})

describe("final alignment fixtures — search", () => {
  it("renders the hit count with the top three titles", () => {
    renderPair(
      toolStart("search", {
        query: "vitest coverage",
        results: [
          { title: "Configuring Vitest" },
          { title: "Coverage guide" },
          { title: "Migration notes" },
          { title: "Shadowed title" },
          { title: "Another shadowed" },
        ],
      }),
      toolEnd("search", true, 830),
    )
    expect(rowValue("Results")).toBe("5")
    // Top hits mount as citation ordinals, capped at three.
    const cites = screen.getByTestId("search-citations")
    expect(cites).toHaveTextContent("Configuring Vitest")
    expect(cites).toHaveTextContent("Migration notes")
    expect(cites.textContent).not.toContain("Shadowed title")
    expect(screen.queryByTestId("tool-code")).toBeNull()
  })

  it("renders an explicit result count without a results array", () => {
    renderPair(toolStart("search", { query: "hook config", resultCount: 7 }), toolEnd("search"))
    expect(rowValue("Query")).toBe("hook config")
    expect(rowValue("Results")).toBe("7")
    expect(screen.queryByTestId("search-citations")).toBeNull()
  })

  it("keeps the domain scoping rows beside the results", () => {
    renderPair(
      toolStart("search", {
        query: "runtime events",
        allowedDomains: ["vitest.dev"],
        results: [{ title: "RuntimeEvent" }],
      }),
      toolEnd("search"),
    )
    expect(rowValue("Allowed domains")).toBe("vitest.dev")
    expect(screen.getByTestId("search-citations")).toHaveTextContent("RuntimeEvent")
  })
})

describe("final alignment fixtures — send-message", () => {
  it("renders the target agent with preview row and full message block", () => {
    renderPair(
      toolStart("send-message", {
        to: "coordinator",
        message: "Phase 2 done, starting verification",
      }),
      toolEnd("send-message", true, 12),
    )
    expect(rowValue("Target")).toBe("coordinator")
    expect(rowValue("Preview")).toBe("Phase 2 done, starting verification")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("Phase 2 done, starting verification")
  })

  it("agentId alias resolves as the target", () => {
    renderPair(
      toolStart("send-message", { agentId: "agent-3", message: "need the schema" }),
      toolEnd("send-message"),
    )
    expect(rowValue("Target")).toBe("agent-3")
  })

  it("clamps long messages in the preview row but keeps the full body", () => {
    renderPair(
      toolStart("send-message", { to: "c", message: `${"detail ".repeat(40)}end` }),
      toolEnd("send-message"),
    )
    expect(rowValue("Preview")).toMatch(/…$/)
    expect(screen.getByTestId("tool-code").textContent).toContain("end")
  })
})

describe("final alignment fixtures — submit-result", () => {
  it("renders summary headline, result block and metadata key count", () => {
    renderPair(
      toolStart("submit-result", {
        summary: "renderers aligned",
        result: "46 renderers, all green",
        metadata: { durationMs: 900, files: 12, score: 9.5 },
      }),
      toolEnd("submit-result", true, 940),
    )
    expect(screen.getByRole("button").textContent).toContain("renderers aligned")
    expect(rowValue("Metadata")).toBe("3")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("46 renderers, all green")
  })

  it("accepts the output alias for the result payload", () => {
    renderPair(
      toolStart("submit-result", { summary: "s", output: "done body" }),
      toolEnd("submit-result"),
    )
    expect(screen.getByTestId("tool-code")).toHaveTextContent("done body")
  })

  it("surfaces a failed submit through the tool-end error", () => {
    renderPair(
      toolStart("submit-result", { summary: "s", result: "r" }),
      toolEnd("submit-result", false, 5, "workspace closed"),
    )
    expect(screen.getByText("✗")).toBeInTheDocument()
    expect(screen.getByTestId("tool-error")).toHaveTextContent("workspace closed")
  })
})

describe("final alignment fixtures — switch-mode", () => {
  it("draws the from → to arrow and keeps the reason row", () => {
    renderPair(
      toolStart("switch-mode", { from: "plan", to: "execute", reason: "plan approved" }),
      toolEnd("switch-mode"),
    )
    const arrow = screen.getByTestId("switch-mode-arrow")
    expect(arrow).toHaveTextContent("plan")
    expect(arrow).toHaveTextContent("→")
    expect(arrow).toHaveTextContent("execute")
    expect(rowValue("Reason")).toBe("plan approved")
  })

  it("collapses the line as the transition when both ends are known", () => {
    renderPair(toolStart("switch-mode", { from: "plan", to: "execute" }), toolEnd("switch-mode"))
    expect(screen.getByRole("button").textContent).toContain("plan → execute")
  })

  it("falls back to the mode row when only the target mode is sent", () => {
    renderPair(toolStart("switch-mode", { mode: "review" }), toolEnd("switch-mode"))
    expect(screen.queryByTestId("switch-mode-arrow")).toBeNull()
    expect(rowValue("Mode")).toBe("review")
  })
})

describe("final alignment fixtures — goal", () => {
  it("renders the goal text with a real progress bar", () => {
    renderPair(
      toolStart("goal", { goal: "align renderers", status: "active", progress: 60 }),
      toolEnd("goal"),
    )
    const bar = screen.getByTestId("goal-progress")
    expect(bar).toHaveAttribute("aria-valuenow", "60")
    expect(bar).toHaveTextContent("60%")
    expect(screen.getByTestId("tool-body")).toHaveTextContent("align renderers")
    expect(rowValue("Status")).toBe("active")
  })

  it("parses string percents from the event payload", () => {
    renderPair(toolStart("goal", { goal: "ship", percent: "75%" }), toolEnd("goal"))
    expect(screen.getByTestId("goal-progress")).toHaveAttribute("aria-valuenow", "75")
  })

  it("clamps out-of-range progress and renders goal-less payloads", () => {
    renderPair(toolStart("goal", { progress: 140 }), toolEnd("goal"))
    expect(screen.getByTestId("goal-progress")).toHaveAttribute("aria-valuenow", "100")
    expect(screen.getByTestId("tool-body").textContent).toContain("100%")
  })
})

describe("final alignment fixtures — escalate", () => {
  it("leads with the reason and shows the escalation target + severity", () => {
    renderPair(
      toolStart("escalate", {
        reason: "schema drift between read.ts and the timeline",
        to: "coordinator",
        severity: "high",
      }),
      toolEnd("escalate", true, 9),
    )
    expect(screen.getByRole("button").textContent).toContain("schema drift")
    expect(rowValue("Target")).toBe("coordinator")
    expect(rowValue("Severity")).toBe("high")
    expect(rowValue("Reason")).toContain("schema drift")
  })

  it("blocker/escalate_to aliases land in the same rows", () => {
    renderPair(
      toolStart("escalate", { blocker: "flaky suite", escalate_to: "human", level: "medium" }),
      toolEnd("escalate"),
    )
    expect(rowValue("Reason")).toBe("flaky suite")
    expect(rowValue("Target")).toBe("human")
    expect(rowValue("Severity")).toBe("medium")
  })

  it("carries the background context block and failed ends show errors", () => {
    renderPair(
      toolStart("escalate", { reason: "blocked", context: "read.ts uses path" }),
      toolEnd("escalate", false, 3, "no coordinator available"),
    )
    expect(screen.getByTestId("tool-code")).toHaveTextContent("read.ts uses path")
    expect(screen.getByText("✗")).toBeInTheDocument()
    expect(screen.getByTestId("tool-error")).toHaveTextContent("no coordinator available")
  })
})

describe("final alignment fixtures — task-stop", () => {
  it("renders the target task with the stop reason", () => {
    renderPair(
      toolStart("task-stop", { taskId: "task-7", reason: "superseded by task-9" }),
      toolEnd("task-stop", true, 4),
    )
    expect(rowValue("ID")).toBe("task-7")
    expect(rowValue("Reason")).toBe("superseded by task-9")
    expect(screen.getByRole("button").textContent).toContain("task-7")
  })

  it("renders the force flag beside the id", () => {
    renderPair(
      toolStart("task-stop", { task_id: "task-7", force: true, reason: "hang" }),
      toolEnd("task-stop"),
    )
    expect(rowValue("ID")).toBe("task-7")
    expect(rowValue("Force")).toBe("true")
    expect(rowValue("Reason")).toBe("hang")
  })

  it("falls back to the reason on the collapsed line when no id is given", () => {
    renderPair(toolStart("task-stop", { why: "user requested" }), toolEnd("task-stop"))
    expect(screen.getByRole("button").textContent).toContain("user requested")
    expect(rowValue("Reason")).toBe("user requested")
  })
})

describe("final alignment — localized new bodies", () => {
  it("switch-mode arrow renders under zh-CN", () => {
    setLocale("zh-CN")
    render(<ToolCallBlock tool="switch-mode" input={{ from: "plan", to: "execute" }} defaultOpen />)
    expect(screen.getByTestId("switch-mode-arrow")).toHaveTextContent("plan")
    expect(screen.getByTestId("switch-mode-arrow")).toHaveTextContent("→")
    expect(screen.getByTestId("switch-mode-arrow")).toHaveTextContent("execute")
    expect(screen.getByTestId("tool-title")).toHaveTextContent("切换模式")
  })

  it("goal progress bar renders under zh-CN", () => {
    setLocale("zh-CN")
    renderPair(toolStart("goal", { goal: "对齐渲染器", progress: 40 }), toolEnd("goal"))
    expect(screen.getByTestId("goal-progress")).toHaveTextContent("40%")
    expect(screen.getByTestId("tool-title")).toHaveTextContent("目标")
  })

  it("escalate severity and search result labels exist in both locales", () => {
    for (const domain of [enDomain, zhDomain]) {
      expect(domain["toolRenderers.fields.severity"]).toBeDefined()
      expect(domain["toolRenderers.fields.results"]).toBeDefined()
      expect(domain["toolRenderers.fields.selector"]).toBeDefined()
      expect(domain["toolRenderers.fields.method"]).toBeDefined()
      expect(domain["toolRenderers.fields.preview"]).toBeDefined()
      expect(domain["toolRenderers.fields.metadata"]).toBeDefined()
    }
  })
})

// ── remaining twelve — model extensions ─────────────────────────────────────

describe("remaining twelve — model extensions", () => {
  it("read-session-context keeps the returned summary as a clamped block", () => {
    const vm = extractReadSessionContext({
      sessionId: "sess_a1",
      query: "renderer conventions",
      strategy: "handoff",
      maxTokens: 4000,
      result: "CONVENTIONS.md requires model/presentation split",
    })
    expect(vm.sessionId).toBe("sess_a1")
    expect(vm.result).toBe("CONVENTIONS.md requires model/presentation split")
    expect(vm.rows.length).toBe(4)
    expect(vm.code?.text).toContain("model/presentation split")
    expect(vm.code?.maxLines).toBe(12)
    // A result-only payload still renders (via the code block).
    const resultOnly = extractReadSessionContext({ result: "prior answer" })
    expect(resultOnly.isEmpty).toBe(false)
    expect(resultOnly.code?.text).toBe("prior answer")
    expect(extractReadSessionContext({ nested: {} }).isEmpty).toBe(true)
  })

  it("respond-to-coordinator extracts the target coordinator and response type", () => {
    const vm = extractRespondToCoordinator({
      to: "coordinator",
      responseType: "progress",
      summary: "halfway",
      message: "3 of 6 renderers done",
    })
    expect(vm.target).toBe("coordinator")
    expect(vm.responseType).toBe("progress")
    expect(vm.headline).toBe("halfway")
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.target",
      "toolRenderers.fields.responseType",
      "toolRenderers.fields.summary",
    ])
    expect(vm.code?.text).toBe("3 of 6 renderers done")
    // kind/coordinator_id aliases land in the same slots.
    const aliased = extractRespondToCoordinator({
      coordinatorId: "coord-2",
      kind: "blocker",
      text: "need credentials",
    })
    expect(aliased.target).toBe("coord-2")
    expect(aliased.responseType).toBe("blocker")
    expect(aliased.headline).toBe("need credentials")
    expect(extractRespondToCoordinator({ task: "t1" }).isEmpty).toBe(false)
    expect(extractRespondToCoordinator({}).isEmpty).toBe(true)
  })

  it("explore reads strategy plus depth/breadth scope knobs", () => {
    const vm = extractExplore({
      query: "auth flow",
      strategy: "breadth_first",
      depth: 3,
      breadth: 2,
    })
    expect(vm.headline).toBe("auth flow")
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.strategy")).toBe(true)
    expect(vm.rows.some((r) => r.value === "depth 3 × breadth 2")).toBe(true)
    const depthOnly = extractExplore({ query: "q", depth: 1 })
    expect(depthOnly.rows.some((r) => r.value === "depth 1")).toBe(true)
    const breadthOnly = extractExplore({ breadth: 4 })
    expect(breadthOnly.isEmpty).toBe(false)
    expect(breadthOnly.rows.some((r) => r.value === "breadth 4")).toBe(true)
    expect(extractExplore({}).isEmpty).toBe(true)
  })

  it("task-output moves the retrieved output into a clamped block with a line count", () => {
    const vm = extractTaskOutput({
      taskId: "t1",
      block: true,
      timeoutMs: 3000,
      output: "line one\nline two",
    })
    expect(vm.taskId).toBe("t1")
    expect(vm.output).toBe("line one\nline two")
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.id",
      "toolRenderers.fields.block",
      "toolRenderers.fields.timeout",
      "toolRenderers.fields.lines",
    ])
    expect(vm.rows[3]?.value).toBe("2")
    expect(vm.code?.text).toBe("line one\nline two")
    expect(extractTaskOutput({ output: "only output" }).headline).toBe("only output")
    expect(extractTaskOutput({ stdout: "alias" }).isEmpty).toBe(false)
  })

  it("task-stop normalizes the batch stops list beside the single-task form", () => {
    const vm = extractTaskStop({ stops: ["task-1", { taskId: "task-2" }, 42], reason: "wave done" })
    expect(vm.stops).toEqual(["task-1", "task-2"])
    expect(vm.reason).toBe("wave done")
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.stops")).toBe(true)
    expect(vm.rows.find((r) => r.labelKey === "toolRenderers.fields.stops")?.value).toBe(
      "task-1, task-2",
    )
    // No id → the collapsed line names the stops.
    expect(extractTaskStop({ stops: ["a", "b"] }).headline).toBe("a, b")
    expect(extractTaskStop({ stops: [] }).isEmpty).toBe(true)
    expect(extractTaskStop({}).stops).toEqual([])
  })

  it("list-models normalizes {id|model} records into the numbered block", () => {
    const vm = extractListModels({
      provider: "zai",
      models: [{ id: "glm-5.3" }, { model: "glm-4.7" }, "bare-id", 42],
    })
    expect(vm.provider).toBe("zai")
    expect(vm.models).toEqual(["glm-5.3", "glm-4.7", "bare-id"])
    // The count row reports what the server sent; garbage is dropped
    // from the normalized list and its numbered block.
    expect(vm.rows.some((r) => r.value === "4")).toBe(true)
    expect(vm.code?.text).toBe("1. glm-5.3\n2. glm-4.7\n3. bare-id")
    expect(extractListModels({ models: [] }).rows.some((r) => r.value === "0")).toBe(true)
    expect(extractListModels({ models: [] }).code).toBeUndefined()
  })

  it("cron-create reads the timezone and description rows", () => {
    const vm = extractCronCreate({
      schedule: "0 9 * * 1-5",
      name: "standup-notes",
      description: "weekday digest",
      timezone: "Asia/Shanghai",
      command: "pnpm digest",
    })
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.schedule",
      "toolRenderers.fields.name",
      "toolRenderers.fields.timezone",
      "toolRenderers.fields.description",
      "toolRenderers.fields.command",
    ])
    expect(vm.rows[2]?.value).toBe("Asia/Shanghai")
    // tz alias + headline fallback to the name when no schedule is sent.
    const aliased = extractCronCreate({ name: "nightly", timeZone: "UTC" })
    expect(aliased.rows.some((r) => r.value === "UTC")).toBe(true)
    expect(aliased.headline).toBe("nightly")
    expect(extractCronCreate({ description: "only" }).isEmpty).toBe(false)
  })

  it("offpeak-create reads the start–end window and the run duration", () => {
    const vm = extractOffpeakCreate({
      label: "nightly-backfill",
      start: "22:00",
      end: "06:00",
      durationMinutes: 45,
      command: "pnpm backfill",
    })
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.window",
      "toolRenderers.fields.duration",
      "toolRenderers.fields.name",
      "toolRenderers.fields.command",
    ])
    expect(vm.rows[0]?.value).toBe("22:00 – 06:00")
    expect(vm.rows[1]?.value).toBe("45m")
    // The headline prefers the window over the label.
    expect(vm.headline).toBe("22:00 – 06:00")
    const durationAlias = extractOffpeakCreate({ duration: 30 })
    expect(durationAlias.rows.some((r) => r.value === "30m")).toBe(true)
    expect(extractOffpeakCreate({ start: "22:00" }).isEmpty).toBe(false)
  })

  it("node-repl carries the title and the script line count", () => {
    const vm = extractNodeRepl({
      code: "const a = 1\nconst b = 2",
      title: "demo",
      timeoutMs: 15000,
    })
    expect(vm.title).toBe("demo")
    expect(vm.lineCount).toBe(2)
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.title",
      "toolRenderers.fields.timeout",
      "toolRenderers.fields.lines",
    ])
    expect(vm.code?.text).toBe("const a = 1\nconst b = 2")
    // A title-less script still headlines from the code.
    const bare = extractNodeRepl({ code: "let x = 1" })
    expect(bare.title).toBeUndefined()
    expect(bare.headline).toBe("let x = 1")
    expect(bare.rows.some((r) => r.value === "1")).toBe(true)
  })

  it("node-repl-image-grid classifies inline sources vs bare paths", () => {
    expect(isRenderableImageSrc("data:image/png;base64,AAAA")).toBe(true)
    expect(isRenderableImageSrc("https://x/y.png")).toBe(true)
    expect(isRenderableImageSrc("http://x/y.png")).toBe(true)
    expect(isRenderableImageSrc("charts/out.png")).toBe(false)
    const vm = extractNodeReplImageGrid({
      title: "captures",
      images: ["data:image/png;base64,AAAA", { url: "https://x/y.png" }, "charts/out.png"],
    })
    expect(vm.images).toEqual([
      { src: "data:image/png;base64,AAAA" },
      { src: "https://x/y.png" },
      { path: "charts/out.png" },
    ])
    expect(vm.rows.some((r) => r.value === "2 inline / 1 path")).toBe(true)
    // Records with path-ish keys classify as paths, not broken sources.
    const pathRecords = extractNodeReplImageGrid({
      images: [{ path: "a.png" }, { file: "b.png" }],
    })
    expect(pathRecords.images).toEqual([{ path: "a.png" }, { path: "b.png" }])
    expect(pathRecords.rows.some((r) => r.value === "0 inline / 2 path")).toBe(true)
  })

  it("create-workflow counts the steps and previews them as a numbered block", () => {
    const vm = extractCreateWorkflow({
      name: "pr-review",
      description: "review the diff",
      steps: [{ ask: "diff review" }, { ask: "confirm" }, { ask: "gate tests" }, { ask: "report" }],
    })
    expect(vm.headline).toBe("pr-review")
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.steps")).toBe(true)
    expect(vm.rows.find((r) => r.labelKey === "toolRenderers.fields.steps")?.value).toBe("4")
    expect(vm.code?.text).toContain("1. ")
    expect(vm.code?.text).toContain("4. ")
    // phases alias; steps alone still render without a name.
    const aliased = extractCreateWorkflow({ phases: ["a", "b"] })
    expect(aliased.rows.some((r) => r.value === "2")).toBe(true)
    expect(aliased.code?.text).toBe("1. a\n2. b")
    expect(extractCreateWorkflow({}).isEmpty).toBe(true)
  })

  it("eval-workflow-snippet counts assertions from an array or an explicit number", () => {
    const vm = extractEvalWorkflowSnippet({
      code: "const a = 1",
      timeoutMs: 2000,
      assertions: [{ ok: true }, { ok: false }],
    })
    expect(vm.code?.text).toBe("const a = 1")
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.timeout",
      "toolRenderers.fields.assertions",
      "toolRenderers.fields.lines",
    ])
    expect(vm.rows[1]?.value).toBe("2")
    // assertion_count alias, and expects arrays land the same way.
    const counted = extractEvalWorkflowSnippet({ code: "x", assertionCount: 5 })
    expect(counted.rows.some((r) => r.value === "5")).toBe(true)
    const expects = extractEvalWorkflowSnippet({ expects: [1, 2, 3] })
    expect(expects.rows.some((r) => r.value === "3")).toBe(true)
    expect(extractEvalWorkflowSnippet({}).isEmpty).toBe(true)
  })
})

// ── remaining twelve — workflow family ≥3 structured fields ─────────────────

describe("remaining twelve — workflow family fields", () => {
  it("get-workflow-run shows run · workflow · status · phase", () => {
    const vm = extractGetWorkflowRun({
      runId: "run-01",
      workflowId: "pr-review",
      status: "running",
      phase: "verify",
    })
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.run",
      "toolRenderers.fields.workflow",
      "toolRenderers.fields.status",
      "toolRenderers.fields.phase",
    ])
    expect(vm.rows[2]?.value).toBe("running")
    expect(extractGetWorkflowRun({ status: "completed" }).isEmpty).toBe(false)
  })

  it("get-workflow-run-roster adds workflow/status/actor-count to the run+phase pair", () => {
    const vm = extractGetWorkflowRunRoster({
      runId: "run-02",
      workflowId: "pr-review",
      phase: "review",
      actors: [{ name: "reviewer-a" }, { name: "reviewer-b" }, { name: "fixer" }],
    })
    expect(vm.rows.map((r) => r.value)).toEqual(["run-02", "pr-review", "review", "3"])
    expect(extractGetWorkflowRunRoster({ actors: [1] }).isEmpty).toBe(false)
  })

  it("get-workflow-run-situation shows run · workflow · status · phase", () => {
    const vm = extractGetWorkflowRunSituation({
      runId: "run-03",
      workflowId: "w",
      status: "errored",
      phase: "report",
    })
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.run",
      "toolRenderers.fields.workflow",
      "toolRenderers.fields.status",
      "toolRenderers.fields.phase",
    ])
    expect(vm.headline).toBe("run-03")
    expect(extractGetWorkflowRunSituation({ phase: "p" }).rows.length).toBeGreaterThan(0)
  })

  it("list-workflow-runs keeps status/limit/workflow and reports the run count", () => {
    const vm = extractListWorkflowRuns({
      status: "running",
      limit: 20,
      workflowId: "pr-review",
      runs: [{ runId: "a" }, { runId: "b" }],
    })
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.status",
      "toolRenderers.fields.limit",
      "toolRenderers.fields.workflow",
      "toolRenderers.fields.count",
    ])
    expect(vm.rows[3]?.value).toBe("2")
    // A bare total (no array) lands in the same count row.
    expect(extractListWorkflowRuns({ total: 9 }).rows.some((r) => r.value === "9")).toBe(true)
    // `count` belongs to the limit family here, not the count row.
    expect(extractListWorkflowRuns({ count: 5 }).rows.some((r) => r.value === "5")).toBe(true)
  })

  it("list-saved-workflows shows scope · query · count · limit", () => {
    const vm = extractListSavedWorkflows({
      scope: "project",
      query: "pr",
      workflows: [{ name: "pr-review" }, { name: "bench" }],
      limit: 10,
    })
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.scope",
      "toolRenderers.fields.query",
      "toolRenderers.fields.count",
      "toolRenderers.fields.limit",
    ])
    expect(vm.rows[2]?.value).toBe("2")
    expect(extractListSavedWorkflows({ workflows: [] }).isEmpty).toBe(false)
  })

  it("resume-workflow-run shows run · workflow · status · phase", () => {
    const vm = extractResumeWorkflowRun({
      runId: "run-04",
      workflowId: "pr-review",
      status: "pending",
      phase: "gate",
    })
    expect(vm.rows.map((r) => r.value)).toEqual(["run-04", "pr-review", "pending", "gate"])
    expect(extractResumeWorkflowRun({}).isEmpty).toBe(true)
  })

  it("resolve-workflow-question adds the run id and question preview to id+answer", () => {
    const vm = extractResolveWorkflowQuestion({
      questionId: "dwfq-9",
      runId: "run-05",
      question: "limit parallelism?",
      answer: "no",
    })
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.id",
      "toolRenderers.fields.run",
      "toolRenderers.fields.question",
      "toolRenderers.fields.answer",
    ])
    expect(vm.rows[3]?.value).toBe("no")
    expect(extractResolveWorkflowQuestion({ question: "only q" }).isEmpty).toBe(false)
  })

  it("save-workflow shows name · scope · description · force", () => {
    const vm = extractSaveWorkflow({
      name: "bench",
      scope: "global",
      description: "nightly bench",
      force: true,
    })
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.name",
      "toolRenderers.fields.scope",
      "toolRenderers.fields.description",
      "toolRenderers.fields.force",
    ])
    expect(vm.rows[3]?.value).toBe("true")
    expect(extractSaveWorkflow({ overwrite: true }).isEmpty).toBe(false)
  })

  it("workflow-diagnostics shows run · workflow · phase · status", () => {
    const vm = extractWorkflowDiagnostics({
      runId: "run-06",
      workflowId: "pr-review",
      phase: "gate",
      status: "running",
    })
    expect(vm.rows.map((r) => r.value)).toEqual(["run-06", "pr-review", "gate", "running"])
    expect(extractWorkflowDiagnostics({ status: "completed" }).rows.length).toBe(1)
  })
})

// ── remaining twelve — real event fixtures (≥3 per upgraded renderer) ───────

describe("remaining fixtures — read-session-context", () => {
  it("renders the query params and the returned context block", () => {
    renderPair(
      toolStart("read-session-context", {
        sessionId: "sess_41",
        query: "renderer conventions",
        strategy: "handoff",
        maxTokens: 6000,
        result: "Model layer must stay locale-free; bodies resolve labels via t().",
      }),
      toolEnd("read-session-context", true, 810),
    )
    expect(screen.getByRole("button").textContent).toContain("sess_41")
    expect(rowValue("Session")).toBe("sess_41")
    expect(rowValue("Query")).toBe("renderer conventions")
    expect(rowValue("Strategy")).toBe("handoff")
    expect(rowValue("Max tokens")).toBe("6000")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("bodies resolve labels")
  })

  it("a missing session id falls back to the query on the collapsed line", () => {
    renderPair(
      toolStart("read-session-context", { query: "find the diff gate", maxTokens: 2000 }),
      toolEnd("read-session-context"),
    )
    expect(screen.getByRole("button").textContent).toContain("find the diff gate")
    expect(rowValue("Query")).toBe("find the diff gate")
    expect(rowValue("Session")).toBeUndefined()
    expect(screen.queryByTestId("tool-code")).toBeNull()
  })

  it("an opaque payload degrades to the raw JSON preview", () => {
    renderPair(
      toolStart("read-session-context", { deep: { nested: true } }),
      toolEnd("read-session-context", false, 3, "session gone"),
    )
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
    expect(screen.getByText("✗")).toBeInTheDocument()
  })
})

describe("remaining fixtures — respond-to-coordinator", () => {
  it("leads with the coordinator + response-type chips and the message block", () => {
    renderPair(
      toolStart("respond-to-coordinator", {
        to: "coordinator",
        responseType: "progress",
        summary: "halfway",
        message: "6 of 12 renderers aligned",
      }),
      toolEnd("respond-to-coordinator", true, 11),
    )
    expect(screen.getByRole("button").textContent).toContain("halfway")
    expect(screen.getByTestId("respond-target")).toHaveTextContent("coordinator")
    expect(screen.getByTestId("respond-type")).toHaveTextContent("progress")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("6 of 12 renderers aligned")
  })

  it("renders summary-only replies without chips and keeps the task id row", () => {
    renderPair(
      toolStart("respond-to-coordinator", { summary: "done", task: "task-7" }),
      toolEnd("respond-to-coordinator"),
    )
    expect(screen.queryByTestId("respond-target")).toBeNull()
    expect(screen.queryByTestId("respond-type")).toBeNull()
    expect(rowValue("Summary")).toBe("done")
    expect(rowValue("ID")).toBe("task-7")
  })

  it("a rejected reply surfaces the tool-end error", () => {
    renderPair(
      toolStart("respond-to-coordinator", { summary: "s", message: "m" }),
      toolEnd("respond-to-coordinator", false, 4, "coordinator stopped"),
    )
    expect(screen.getByText("✗")).toBeInTheDocument()
    expect(screen.getByTestId("tool-error")).toHaveTextContent("coordinator stopped")
  })
})

describe("remaining fixtures — explore", () => {
  it("renders scope paths, strategy and the depth × breadth knobs", () => {
    renderPair(
      toolStart("explore", {
        query: "tool call pipeline",
        paths: ["src/components", "src/lib"],
        strategy: "breadth_first",
        depth: 2,
        breadth: 3,
      }),
      toolEnd("explore", true, 1540),
    )
    expect(screen.getByRole("button").textContent).toContain("tool call pipeline")
    expect(rowValue("Target")).toBe("src/components, src/lib")
    expect(rowValue("Strategy")).toBe("breadth_first")
    expect(rowValue("Scope")).toBe("depth 2 × breadth 3")
  })

  it("a base-path-only recon still names the path on the collapsed line", () => {
    renderPair(toolStart("explore", { path: "packages/core", depth: 1 }), toolEnd("explore"))
    expect(screen.getByRole("button").textContent).toContain("packages/core")
    expect(rowValue("Path")).toBe("packages/core")
    expect(rowValue("Scope")).toBe("depth 1")
  })

  it("an opaque payload degrades to the raw JSON preview", () => {
    renderPair(toolStart("explore", { see: "everywhere" }), toolEnd("explore"))
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
  })
})

describe("remaining fixtures — task-output", () => {
  it("renders the target task with the retrieved output as a clamped block", () => {
    renderPair(
      toolStart("task-output", {
        taskId: "task-7",
        block: false,
        timeoutMs: 1000,
        output: "stdout line 1\nstdout line 2",
      }),
      toolEnd("task-output", true, 1040),
    )
    expect(rowValue("ID")).toBe("task-7")
    expect(rowValue("Block")).toBe("false")
    expect(rowValue("Lines")).toBe("2")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("stdout line 1")
  })

  it("clamps long output with the overflow note", () => {
    const output = Array.from({ length: 16 }, (_, i) => `out-${i}`).join("\n")
    renderPair(toolStart("task-output", { taskId: "t", output }), toolEnd("task-output"))
    expect(screen.getByTestId("tool-code-overflow")).toHaveTextContent("…4 more lines")
    expect(rowValue("Lines")).toBe("16")
  })

  it("a timeout retrieval surfaces the tool-end error", () => {
    renderPair(
      toolStart("task-output", { taskId: "t-404", block: true, timeoutMs: 30000 }),
      toolEnd("task-output", false, 30040, "timed out"),
    )
    expect(screen.getByText("✗")).toBeInTheDocument()
    expect(screen.getByTestId("tool-error")).toHaveTextContent("timed out")
  })
})

describe("remaining fixtures — task-stop", () => {
  it("renders the batch stops list beside the reason", () => {
    renderPair(
      toolStart("task-stop", { stops: ["task-1", "task-2", "task-3"], reason: "wave complete" }),
      toolEnd("task-stop", true, 6),
    )
    expect(rowValue("Stops")).toBe("task-1, task-2, task-3")
    expect(rowValue("Reason")).toBe("wave complete")
    expect(screen.getByRole("button").textContent).toContain("task-1, task-2, task-3")
  })

  it("normalizes stop records down to their ids", () => {
    renderPair(
      toolStart("task-stop", { stops: [{ taskId: "a" }, { id: "b" }], force: true }),
      toolEnd("task-stop"),
    )
    expect(rowValue("Stops")).toBe("a, b")
    expect(rowValue("Force")).toBe("true")
  })

  it("an opaque payload degrades to the raw JSON preview", () => {
    renderPair(toolStart("task-stop", { halted: true }), toolEnd("task-stop"))
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
  })
})

describe("remaining fixtures — list-models", () => {
  it("renders the provider filter with the numbered model block", () => {
    renderPair(
      toolStart("list-models", {
        provider: "zai",
        models: [{ id: "glm-5.3" }, { id: "glm-4.7" }],
      }),
      toolEnd("list-models", true, 120),
    )
    expect(rowValue("Model")).toBe("zai")
    expect(rowValue("Count")).toBe("2")
    const code = screen.getByTestId("tool-code")
    expect(code).toHaveTextContent("1. glm-5.3")
    expect(code).toHaveTextContent("2. glm-4.7")
  })

  it("renders the reasoning-level filter without a model list", () => {
    renderPair(toolStart("list-models", { reasoningLevel: "high" }), toolEnd("list-models"))
    expect(rowValue("Mode")).toBe("high")
    expect(screen.queryByTestId("tool-code")).toBeNull()
  })

  it("the usual no-arg call shows the localized discovery note", () => {
    renderPair(toolStart("list-models", null), toolEnd("list-models"))
    expect(screen.getByTestId("list-models-empty")).toHaveTextContent("Discovery request")
  })
})

describe("remaining fixtures — cron-create", () => {
  it("renders schedule, timezone, description and the deferred command", () => {
    renderPair(
      toolStart("cron-create", {
        name: "weekday-digest",
        schedule: "0 9 * * 1-5",
        description: "morning digest",
        timezone: "Asia/Shanghai",
        command: "pnpm digest",
      }),
      toolEnd("cron-create", true, 15),
    )
    expect(screen.getByRole("button").textContent).toContain("0 9 * * 1-5")
    expect(rowValue("Schedule")).toBe("0 9 * * 1-5")
    expect(rowValue("Timezone")).toBe("Asia/Shanghai")
    expect(rowValue("Description")).toBe("morning digest")
    expect(rowValue("Command")).toBe("pnpm digest")
  })

  it("a missing schedule falls back to the job name", () => {
    renderPair(
      toolStart("cron-create", { name: "nightly", prompt: "run bench" }),
      toolEnd("cron-create"),
    )
    expect(screen.getByRole("button").textContent).toContain("nightly")
    expect(rowValue("Name")).toBe("nightly")
    expect(rowValue("Timezone")).toBeUndefined()
  })

  it("a rejected registration surfaces the tool-end error", () => {
    renderPair(
      toolStart("cron-create", { schedule: "not a cron" }),
      toolEnd("cron-create", false, 8, "invalid expression"),
    )
    expect(screen.getByText("✗")).toBeInTheDocument()
    expect(screen.getByTestId("tool-error")).toHaveTextContent("invalid expression")
  })
})

describe("remaining fixtures — offpeak-create", () => {
  it("renders the start–end window with duration and command", () => {
    renderPair(
      toolStart("offpeak-create", {
        label: "backfill",
        start: "23:30",
        end: "05:00",
        durationMinutes: 90,
        command: "pnpm backfill",
      }),
      toolEnd("offpeak-create", true, 12),
    )
    expect(rowValue("Window")).toBe("23:30 – 05:00")
    expect(rowValue("Duration")).toBe("90m")
    expect(rowValue("Command")).toBe("pnpm backfill")
    expect(screen.getByRole("button").textContent).toContain("23:30 – 05:00")
  })

  it("interval payloads keep the classic interval/duration rows", () => {
    renderPair(
      toolStart("offpeak-create", {
        interval: "22:00-06:00",
        label: "nightly",
        intervalMinutes: 30,
      }),
      toolEnd("offpeak-create"),
    )
    expect(rowValue("Interval")).toBe("22:00-06:00")
    expect(rowValue("Name")).toBe("nightly")
  })

  it("an opaque payload degrades to the raw JSON preview", () => {
    renderPair(toolStart("offpeak-create", { whenever: true }), toolEnd("offpeak-create"))
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
  })
})

describe("remaining fixtures — node-repl", () => {
  it("renders the script title heading with the code block", () => {
    renderPair(
      toolStart("node-repl", {
        title: "schema probe",
        code: "const rows = files.glob('*.ts')\nrows.length",
        timeoutMs: 20000,
      }),
      toolEnd("node-repl", true, 320),
    )
    expect(screen.getByTestId("node-repl-title")).toHaveTextContent("schema probe")
    expect(rowValue("Lines")).toBe("2")
    expect(rowValue("Timeout")).toBe("20000")
    const code = screen.getByTestId("tool-code")
    expect(code.className).toContain("font-mono")
    expect(code).toHaveTextContent("files.glob")
  })

  it("a title-less script headlines from the code", () => {
    renderPair(toolStart("node-repl", { code: "1 + 1" }), toolEnd("node-repl"))
    expect(screen.queryByTestId("node-repl-title")).toBeNull()
    expect(screen.getByRole("button").textContent).toContain("1 + 1")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("1 + 1")
  })

  it("an opaque payload degrades to the raw JSON preview", () => {
    renderPair(
      toolStart("node-repl", { eval: "dangerous()" }),
      toolEnd("node-repl", false, 2, "blocked"),
    )
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
    expect(screen.getByTestId("tool-error")).toHaveTextContent("blocked")
  })
})

describe("remaining fixtures — node-repl-image-grid", () => {
  it("draws inline sources (data URIs and URLs) as an image grid", () => {
    renderPair(
      toolStart("node-repl-image-grid", {
        title: "captures",
        images: ["data:image/png;base64,AAAA", { url: "https://img.example.net/shot.png" }],
      }),
      toolEnd("node-repl-image-grid", true, 45),
    )
    expect(screen.getByTestId("tool-title")).toHaveTextContent("Image grid")
    expect(rowValue("Images")).toBe("2")
    const imgs = screen.getAllByTestId("repl-image")
    expect(imgs).toHaveLength(2)
    expect(imgs[0]).toHaveAttribute("src", "data:image/png;base64,AAAA")
    expect(imgs[1]).toHaveAttribute("src", "https://img.example.net/shot.png")
    expect(screen.queryByTestId("repl-image-paths")).toBeNull()
  })

  it("lists bare file paths as monospace text instead of broken images", () => {
    renderPair(
      toolStart("node-repl-image-grid", { images: [{ path: "charts/a.png" }, { file: "b.png" }] }),
      toolEnd("node-repl-image-grid"),
    )
    expect(screen.queryByTestId("repl-image")).toBeNull()
    const paths = screen.getByTestId("repl-image-paths")
    expect(paths).toHaveTextContent("charts/a.png")
    expect(paths).toHaveTextContent("b.png")
    expect(rowValue("Preview")).toBe("0 inline / 2 path")
  })

  it("an opaque payload degrades to the raw JSON preview", () => {
    renderPair(toolStart("node-repl-image-grid", { picture: 42 }), toolEnd("node-repl-image-grid"))
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
  })
})

describe("remaining fixtures — create-workflow", () => {
  it("renders the workflow name, step count and numbered step preview", () => {
    renderPair(
      toolStart("create-workflow", {
        name: "pr-review",
        description: "review the diff",
        steps: [{ ask: "diff review" }, { ask: "confirm" }, { ask: "gate tests" }],
      }),
      toolEnd("create-workflow", true, 30),
    )
    expect(screen.getByRole("button").textContent).toContain("pr-review")
    expect(rowValue("Name")).toBe("pr-review")
    expect(rowValue("Steps")).toBe("3")
    const code = screen.getByTestId("tool-code")
    expect(code).toHaveTextContent("1. ")
    expect(code).toHaveTextContent("3. ")
  })

  it("a name-less workflow still previews its steps", () => {
    renderPair(toolStart("create-workflow", { steps: ["a", "b"] }), toolEnd("create-workflow"))
    expect(rowValue("Steps")).toBe("2")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("1. a")
  })

  it("an opaque payload degrades to the raw JSON preview", () => {
    renderPair(toolStart("create-workflow", { opaque: 42 }), toolEnd("create-workflow"))
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
  })
})

describe("remaining fixtures — eval-workflow-snippet", () => {
  it("renders the snippet block with timeout and assertion rows", () => {
    renderPair(
      toolStart("eval-workflow-snippet", {
        code: "const files = await files.glob('*.ts')",
        timeoutMs: 5000,
        assertions: [{ ok: true }, { ok: true }],
      }),
      toolEnd("eval-workflow-snippet", true, 90),
    )
    expect(screen.getByTestId("tool-code")).toHaveTextContent("files.glob")
    expect(rowValue("Timeout")).toBe("5000")
    expect(rowValue("Assertions")).toBe("2")
  })

  it("an explicit assertion count renders without an array", () => {
    renderPair(
      toolStart("eval-workflow-snippet", { code: "ok", assertionCount: 7 }),
      toolEnd("eval-workflow-snippet"),
    )
    expect(rowValue("Assertions")).toBe("7")
  })

  it("a failed snippet run surfaces the diagnostics", () => {
    renderPair(
      toolStart("eval-workflow-snippet", { code: "syntax (" }),
      toolEnd("eval-workflow-snippet", false, 12, "TS1005: ')' expected"),
    )
    expect(screen.getByText("✗")).toBeInTheDocument()
    expect(screen.getByTestId("tool-error")).toHaveTextContent("TS1005")
  })
})

describe("remaining fixtures — workflow family event pairs", () => {
  it("get-workflow-run: run/workflow/status/phase rows from one event", () => {
    renderPair(
      toolStart("get-workflow-run", {
        runId: "run-77",
        workflowId: "pr-review",
        status: "running",
        phase: "gate",
      }),
      toolEnd("get-workflow-run", true, 25),
    )
    expect(screen.getByRole("button").textContent).toContain("run-77")
    expect(rowValue("Run")).toBe("run-77")
    expect(rowValue("Workflow")).toBe("pr-review")
    expect(rowValue("Status")).toBe("running")
    expect(rowValue("Phase")).toBe("gate")
  })

  it("list-workflow-runs: status/limit/count rows", () => {
    renderPair(
      toolStart("list-workflow-runs", {
        status: "running",
        limit: 50,
        runs: [{ runId: "a" }, { runId: "b" }, { runId: "c" }],
      }),
      toolEnd("list-workflow-runs"),
    )
    expect(rowValue("Status")).toBe("running")
    expect(rowValue("Limit")).toBe("50")
    expect(rowValue("Count")).toBe("3")
  })

  it("resolve-workflow-question: id/run/question/answer rows", () => {
    renderPair(
      toolStart("resolve-workflow-question", {
        questionId: "dwfq-12",
        runId: "run-80",
        question: "cap parallelism?",
        answer: "no, keep default",
      }),
      toolEnd("resolve-workflow-question"),
    )
    expect(rowValue("ID")).toBe("dwfq-12")
    expect(rowValue("Run")).toBe("run-80")
    expect(rowValue("Question")).toBe("cap parallelism?")
    expect(rowValue("Answer")).toBe("no, keep default")
  })

  it("resume-workflow-run and workflow-diagnostics render 3+ fields each", () => {
    const first = renderInput("resume-workflow-run", {
      runId: "run-91",
      workflowId: "bench",
      status: "pending",
    })
    expect(rowValue("Run")).toBe("run-91")
    expect(rowValue("Workflow")).toBe("bench")
    expect(rowValue("Status")).toBe("pending")
    first.unmount()
    renderInput("workflow-diagnostics", { runId: "run-92", phase: "report", status: "errored" })
    expect(rowValue("Run")).toBe("run-92")
    expect(rowValue("Phase")).toBe("report")
    expect(rowValue("Status")).toBe("errored")
  })
})

describe("remaining fixtures — localized new bodies (zh-CN)", () => {
  it("respond-to-coordinator chips and image grid render under zh-CN", () => {
    setLocale("zh-CN")
    render(
      <ToolCallBlock
        tool="respond-to-coordinator"
        input={{ to: "coordinator", responseType: "progress", message: "half" }}
        defaultOpen
      />,
    )
    expect(screen.getByTestId("tool-title")).toHaveTextContent("回复协调者")
    expect(screen.getByTestId("respond-target")).toHaveTextContent("coordinator")
    expect(screen.getByTestId("respond-type")).toHaveTextContent("progress")
  })

  it("new field labels exist in both locales", () => {
    const keys = [
      "toolRenderers.fields.assertions",
      "toolRenderers.fields.duration",
      "toolRenderers.fields.output",
      "toolRenderers.fields.responseType",
      "toolRenderers.fields.steps",
      "toolRenderers.fields.stops",
      "toolRenderers.fields.timezone",
      "toolRenderers.fields.window",
    ]
    for (const key of keys) {
      expect(enDomain[key as keyof typeof enDomain], key).toBeDefined()
      expect(zhDomain[key as keyof typeof zhDomain], key).toBeDefined()
    }
  })
})

// ── ai-elements mounts — the widgets are now consumed for real ──────────────

describe("ai-elements mounts", () => {
  it("bash: CommandBlock shows the exit-code badge when the payload carries one", () => {
    renderInput("bash", { command: "pnpm test", exitCode: 0 })
    const command = screen.getByLabelText("Executed command")
    expect(command).toHaveTextContent("pnpm test")
    expect(command).toHaveTextContent("exit 0")
  })

  it("bash: a non-zero exit code renders its own badge value", () => {
    renderInput("bash", { command: "false", exitCode: 3 })
    expect(screen.getByLabelText("Executed command")).toHaveTextContent("exit 3")
  })

  it("every measured call renders a LatencyMeter with a rated bar", () => {
    renderPair(toolStart("bash", { command: "pnpm build" }), toolEnd("bash", true, 6500))
    expect(screen.getByText("7s")).toBeInTheDocument()
    expect(screen.getByRole("meter")).toHaveAttribute("aria-label", "slow · 7s")
  })

  it("failed tool-ends render an ErrorBlock alert inside the error slot", () => {
    renderPair(toolStart("bash", { command: "exit 1" }), toolEnd("bash", false, 12, "boom"))
    expect(screen.getByRole("alert")).toHaveTextContent("boom")
    expect(screen.getByTestId("tool-error")).toHaveTextContent("boom")
  })

  it("task/agent show the spawn outcome as a StatusPill", () => {
    const done = renderPair(
      toolStart("task", { description: "d", prompt: "p" }),
      toolEnd("task", true, 5),
    )
    expect(screen.getByRole("status")).toHaveTextContent("Completed")
    done.unmount()
    renderPair(toolStart("agent", { name: "fixer" }), toolEnd("agent", false, 3, "nope"))
    expect(screen.getByRole("status")).toHaveTextContent("Failed")
  })

  it("spawn pills read as queued while the call is in flight", () => {
    renderInput("task", { description: "d" })
    expect(screen.getByRole("status")).toHaveTextContent("Pending")
  })

  it("submit-result mounts a TokenUsageBadge for usage payloads", () => {
    renderPair(
      toolStart("submit-result", {
        summary: "done",
        result: "r",
        usage: { inputTokens: 1200, outputTokens: 300 },
      }),
      toolEnd("submit-result", true, 30),
    )
    const badge = screen.getByTitle("Token usage (input/output/cache)")
    expect(badge).toHaveTextContent("1.5K")
    expect(badge).toHaveTextContent("in 1.2K")
    expect(badge).toHaveTextContent("out 300")
  })

  it("respond-to-coordinator mounts the badge too; absent usage renders none", () => {
    const withUsage = renderPair(
      toolStart("respond-to-coordinator", {
        summary: "s",
        message: "m",
        usage: { totalTokens: 42 },
      }),
      toolEnd("respond-to-coordinator"),
    )
    expect(screen.getByTitle("Token usage (input/output/cache)")).toHaveTextContent("42")
    withUsage.unmount()
    renderPair(
      toolStart("respond-to-coordinator", { summary: "s", message: "m" }),
      toolEnd("respond-to-coordinator"),
    )
    expect(screen.queryByTitle("Token usage (input/output/cache)")).toBeNull()
  })

  it("opaque payloads expand via JsonPeek's pretty-printed preview", () => {
    renderInput("get-workflow-run", { opaque: { deep: true } })
    const preview = screen.getByTestId("tool-json-preview")
    expect(preview).toHaveTextContent("JSON")
    expect(preview).toHaveTextContent('"deep": true')
  })

  it("webfetch summary card is a real outbound anchor", () => {
    renderInput("webfetch", { url: "https://example.com/a" })
    const anchor = screen.getByLabelText("Link preview")
    expect(anchor.tagName).toBe("A")
    expect(anchor).toHaveAttribute("href", "https://example.com/a")
  })

  it("search citations carry ordinals in result order", () => {
    renderInput("search", { query: "q", results: [{ title: "A" }, { title: "B" }] })
    const cites = screen.getByTestId("search-citations")
    expect(cites.textContent).toContain("[1]")
    expect(cites.textContent).toContain("[2]")
    expect(cites.textContent).toContain("A")
    expect(cites.textContent).toContain("B")
  })

  it("the mounted widgets localize under zh-CN", () => {
    setLocale("zh-CN")
    renderPair(toolStart("task", { description: "d" }), toolEnd("task", true, 5))
    expect(screen.getByRole("status")).toHaveTextContent("已完成")
  })

  it("model helpers behind the mounts: spawnStatus + usageOf", () => {
    expect(spawnStatus(undefined)).toBe("queued")
    expect(spawnStatus(true)).toBe("completed")
    expect(spawnStatus(false)).toBe("failed")
    expect(usageOf({ usage: { total: 5 } })).toEqual({ total: 5 })
    expect(usageOf({ tokens: { input: 1 } })).toEqual({ input: 1 })
    expect(usageOf({ token_usage: 99 })).toBe(99)
    expect(usageOf({ other: 1 })).toBeUndefined()
    expect(usageOf(null)).toBeUndefined()
    expect(usageOf("text")).toBeUndefined()
  })
})

// ── coverage completion round — the last batch (registry keys ≥ 60) ─────────

describe("registry full coverage — every entry is a dedicated renderer", () => {
  it("registry carries ≥60 keys and the aggregation agrees with the table", () => {
    expect(Object.keys(RENDERERS).length).toBeGreaterThanOrEqual(60)
    expect([...RENDERED_TOOLS].sort()).toEqual(Object.keys(RENDERERS).sort())
  })

  it("every entry has a non-fallback glyph AND a Body — known tools never hit DefaultBody", () => {
    for (const [tool, def] of Object.entries(RENDERERS)) {
      const d: ToolRendererDef = def
      expect(d.glyph, tool).not.toBe("·")
      expect(d.glyph.length, tool).toBeGreaterThan(0)
      expect(d.Body, tool).toBeDefined()
    }
  })

  it("every glyph is exclusive to one renderer", () => {
    const seen = new Map<string, string>()
    for (const [tool, def] of Object.entries(RENDERERS)) {
      const owner = seen.get(def.glyph)
      expect(owner, `glyph "${def.glyph}" shared by ${owner} and ${tool}`).toBeUndefined()
      seen.set(def.glyph, tool)
    }
  })

  it("only genuinely unknown tools resolve to the generic fallback", () => {
    const fallback = resolveToolRenderer("no-such-tool")
    expect(fallback.glyph).toBe("·")
    expect(fallback.Body).toBeUndefined()
    for (const tool of [...NEW_TOOLS, ...CORE_TOOLS]) {
      expect(resolveToolRenderer(tool).Body, tool).toBeDefined()
    }
  })

  it("every registry key owns a title key in both locales", () => {
    for (const tool of Object.keys(RENDERERS)) {
      const key = `toolRenderers.${tool}.title`
      expect(enDomain[key as keyof typeof enDomain], key).toBeDefined()
      expect(zhDomain[key as keyof typeof zhDomain], key).toBeDefined()
    }
  })

  it("every tool summarizes to a target — never raw JSON — when its real fields land", () => {
    // Groups re-render children recursively; their collapsed line stays the
    // raw envelope by design. Every other entry gets a real-field sample.
    const SAMPLES: Record<string, unknown> = {
      bash: { command: "ls" },
      read: { path: "p" },
      glob: { pattern: "**/*" },
      grep: { pattern: "x" },
      permission: { tool: "bash", target: "make" },
      lsp: { method: "documentSymbols" },
      edit: { path: "a.ts", oldString: "x", newString: "y" },
      write: { path: "a.ts", content: "c" },
      webfetch: { url: "https://example.com/a" },
      search: { query: "q" },
      mcp: { server: "srv", tool: "t" },
      agent: { name: "fixer" },
      "agent-prompt": { name: "fixer", prompt: "fix it" },
      task: { description: "audit" },
      "task-output": { taskId: "t-1" },
      "task-stop": { taskId: "t-1" },
      explore: { query: "renderer" },
      "plan-guidance": { goal: "stay minimal" },
      "enter-plan-mode": { mode: "plan" },
      "exit-plan-mode": { plan: "# Step 1" },
      "ask-question": { questions: [{ question: "go?" }] },
      goal: { goal: "ship" },
      escalate: { reason: "blocked" },
      todo: { todos: [{ content: "a", status: "pending" }] },
      "todo-read": { todos: [{ content: "a", status: "pending" }] },
      "todo-write": { todos: [{ content: "a", status: "pending" }] },
      skill: { skill: "pdf" },
      "send-message": { message: "hello" },
      "submit-result": { summary: "done" },
      "switch-mode": { from: "chat", mode: "plan" },
      "list-models": { provider: "glm" },
      "read-session-context": { sessionId: "s-1" },
      "respond-to-coordinator": { summary: "ok" },
      "cron-create": { schedule: "0 9 * * *" },
      "offpeak-create": { window: "01:00-05:00" },
      "node-repl": { code: "let x = 1" },
      "node-repl-image-grid": { images: ["data:image/png;base64,AA"] },
      "cua-action": { action: "click", target: "#submit" },
      "get-app-state": { app: "Terminal" },
      "list-apps": { apps: ["A"] },
      screenshot: { width: 100, height: 80 },
      "browser-navigate": { url: "https://example.com/x" },
      "browser-action": { action: "fill", selector: "#q" },
      "create-workflow": { name: "review" },
      "save-workflow": { name: "review" },
      "amend-workflow": { runId: "r-7" },
      "get-workflow-run": { runId: "r-1" },
      "list-saved-workflows": { scope: "project" },
      "list-workflow-runs": { status: "running" },
      "resume-workflow-run": { runId: "r-1" },
      "resolve-workflow-question": { questionId: "q-1" },
      "get-workflow-run-roster": { runId: "r-1" },
      "get-workflow-run-situation": { runId: "r-1" },
      "eval-workflow-snippet": { code: "x = 1" },
      "workflow-diagnostics": { runId: "r-1" },
      "get-workflow-run-card": { runId: "r-1", status: "running" },
      "list-workflow-runs-card": { status: "running", total: 3 },
      "resume-workflow-run-card": { runId: "r-1", status: "paused" },
      "get-workflow-run-roster-card": { runId: "r-1", actors: ["a"] },
    }
    const groups = new Set(["execute-group", "changes-group", "cua-group"])
    expect(Object.keys(SAMPLES).length).toBe(Object.keys(RENDERERS).length - groups.size)
    for (const [tool, sample] of Object.entries(SAMPLES)) {
      expect(resolveToolRenderer(tool).Body, tool).toBeDefined()
      const summarized = summarizeToolInput(tool, sample)
      expect(summarized, tool).not.toMatch(/^\{/)
      expect(summarized.length, tool).toBeGreaterThan(0)
    }
  })
})

describe("completion — model extensions", () => {
  it("workflow run card: info-dense headline, chips fields off the row list", () => {
    const vm = extractGetWorkflowRunCard({
      runId: "r-9",
      workflowId: "wf",
      status: "running",
      phase: "phase-2",
      durationMs: 4200,
    })
    expect(vm.isEmpty).toBe(false)
    expect(vm.headline).toBe("running · phase-2 · r-9")
    expect(vm.status).toBe("running")
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.workflow",
      "toolRenderers.fields.duration",
    ])
  })

  it("list runs card: count composes into the headline, absent arrays fall back to total", () => {
    expect(extractListWorkflowRunsCard({ status: "running", total: 7 }).headline).toBe(
      "running · ×7",
    )
    const listed = extractListWorkflowRunsCard({ runs: [{}, {}, {}], limit: 5 })
    expect(listed.headline).toBe("×3")
    expect(listed.rows.map((r) => r.labelKey)).toEqual(["toolRenderers.fields.limit"])
    expect(extractListWorkflowRunsCard({ limit: 5 }).isEmpty).toBe(false)
  })

  it("resume card keeps the reason row; roster card numbers the actor names", () => {
    const resume = extractResumeWorkflowRunCard({
      runId: "r-3",
      status: "paused",
      phase: "gate",
      reason: "amended",
    })
    expect(resume.headline).toBe("r-3 · paused · gate")
    expect(resume.rows.map((r) => r.labelKey)).toEqual(["toolRenderers.fields.reason"])
    const roster = extractGetWorkflowRunRosterCard({
      runId: "r-5",
      phase: "review",
      actors: [{ name: "reviewer" }, "fixer"],
    })
    expect(roster.headline).toBe("r-5 · review · ×2")
    expect(roster.count).toBe(2)
    expect(roster.code?.text).toBe("1. reviewer\n2. fixer")
  })

  it("amend-workflow: run/workflow/lines rows plus the revised script block", () => {
    const vm = extractAmendWorkflow({
      runId: "r-7",
      workflowId: "wf-amend",
      script: "phase one\nphase two",
      settings: { max_concurrency: 3 },
    })
    expect(vm.isEmpty).toBe(false)
    expect(vm.headline).toBe("r-7")
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.run",
      "toolRenderers.fields.workflow",
      "toolRenderers.fields.lines",
      "toolRenderers.fields.settings",
    ])
    expect(vm.code?.text).toContain("phase two")
  })

  it("agent prompt: heading field, model/lines rows, clamped prompt block", () => {
    const vm = extractAgentPrompt({ name: "fixer", model: "glm-5.3", prompt: "line1\nline2" })
    expect(vm.isEmpty).toBe(false)
    expect(vm.name).toBe("fixer")
    expect(vm.lineCount).toBe(2)
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.agent",
      "toolRenderers.fields.provider",
      "toolRenderers.fields.lines",
    ])
    expect(vm.code?.text).toBe("line1\nline2")
    expect(extractAgentPrompt({ model: "m" }).rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.provider",
    ])
  })

  it("plan mode: entry reads mode/target/reason, exit keeps the plan block + prompts", () => {
    const enter = extractEnterPlanMode({ mode: "plan", target: "auth", reason: "multi-file" })
    expect(enter.headline).toBe("plan")
    expect(enter.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.mode",
      "toolRenderers.fields.target",
      "toolRenderers.fields.reason",
    ])
    const exit = extractExitPlanMode({ plan: "# Step 1\nStep 2", allowedPrompts: ["a", "b"] })
    expect(exit.headline).toBe("# Step 1 Step 2")
    expect(exit.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.lines",
      "toolRenderers.fields.prompts",
    ])
    expect(exit.code?.text).toContain("Step 2")
  })

  it("cua-action reads the full verb surface; app-state counts elements", () => {
    const click = extractCuaAction({
      action: "click",
      target: "#submit",
      text: "go",
      key: "Enter",
      ms: 120,
    })
    expect(click.headline).toBe("click · #submit")
    expect(click.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.action",
      "toolRenderers.fields.selector",
      "toolRenderers.fields.text",
      "toolRenderers.fields.key",
      "toolRenderers.fields.duration",
    ])
    expect(extractCuaAction({ action: "wait", ms: 800 }).rows).toHaveLength(2)
    const state = extractGetAppState({
      app: "Terminal",
      window: "zsh",
      stateId: "st-1",
      elements: [{}, {}],
    })
    expect(state.stateId).toBe("st-1")
    expect(state.headline).toBe("Terminal")
    expect(state.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.app",
      "toolRenderers.fields.window",
      "toolRenderers.fields.state",
      "toolRenderers.fields.elements",
    ])
    // Filtered row list: app row first, elements row second.
    expect(extractGetAppState({ app: "X", count: 9 }).rows[1]?.value).toBe("9")
  })

  it("list-apps numbers the roster; screenshot classifies the image source", () => {
    const apps = extractListApps({ apps: ["A", { name: "B", pid: "12" }] })
    expect(apps.headline).toBe("×2")
    expect(apps.code?.text).toBe("1. A\n2. B (12)")
    expect(extractListApps({ apps: "nope" }).isEmpty).toBe(true)
    const shot = extractScreenshot({ image: "data:image/png;base64,AAAA", width: 100, height: 80 })
    expect(screenshotIsRenderable(shot)).toBe(true)
    expect(shot.headline).toBe("100×80")
    const pathed = extractScreenshot({ path: "/tmp/shot.png" })
    expect(screenshotIsRenderable(pathed)).toBe(false)
    expect(pathed.headline).toBe("/tmp/shot.png")
    expect(pathed.rows.map((r) => r.labelKey)).toEqual(["toolRenderers.fields.path"])
  })

  it("browser family: host derivation for navigate, verb · selector for actions", () => {
    const nav = extractBrowserNavigate({
      url: "https://example.com/x",
      title: "Example",
      sessionId: "s-1",
    })
    expect(nav.headline).toBe("example.com")
    expect(nav.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.url",
      "toolRenderers.fields.host",
      "toolRenderers.fields.title",
      "toolRenderers.fields.session",
    ])
    const act = extractBrowserAction({ action: "fill", selector: "#q", text: "query" })
    expect(act.headline).toBe("fill · #q")
    expect(act.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.method",
      "toolRenderers.fields.selector",
      "toolRenderers.fields.text",
    ])
  })
})

describe("completion fixtures — workflow compact cards", () => {
  it("run card: chips lead the expanded body, duration row follows", () => {
    renderPair(
      toolStart("get-workflow-run-card", {
        runId: "r-9",
        workflowId: "wf",
        status: "running",
        phase: "phase-2",
        durationMs: 4200,
      }),
      toolEnd("get-workflow-run-card"),
    )
    const chips = screen.getByTestId("card-chips")
    expect(within(chips).getByTestId("card-chip-status")).toHaveTextContent("running")
    expect(within(chips).getByTestId("card-chip-phase")).toHaveTextContent("phase-2")
    expect(within(chips).getByTestId("card-chip-run")).toHaveTextContent("r-9")
    expect(rowValue("Workflow")).toBe("wf")
    expect(rowValue("Duration")).toBe("4200")
  })

  it("runs card: count chip and the plain-rows variant", () => {
    const first = renderPair(
      toolStart("list-workflow-runs-card", { status: "running", total: 7 }),
      toolEnd("list-workflow-runs-card"),
    )
    expect(
      within(screen.getByTestId("card-chips")).getByTestId("card-chip-count"),
    ).toHaveTextContent("×7")
    expect(screen.getByTestId("tool-title")).toHaveTextContent("Workflow runs card")
    first.unmount()
    renderInput("list-workflow-runs-card", { limit: 5 })
    expect(screen.getByTestId("card-chips")).toBeEmptyDOMElement()
    expect(rowValue("Limit")).toBe("5")
  })

  it("resume card: paused run surfaces status/phase chips and the reason", () => {
    renderPair(
      toolStart("resume-workflow-run-card", {
        runId: "r-3",
        status: "paused",
        phase: "gate",
        reason: "amended",
      }),
      toolEnd("resume-workflow-run-card"),
    )
    expect(
      within(screen.getByTestId("card-chips")).getByTestId("card-chip-status"),
    ).toHaveTextContent("paused")
    expect(rowValue("Reason")).toBe("amended")
  })

  it("roster card: numbered actor block; empty inputs fall back to the JSON preview", () => {
    renderPair(
      toolStart("get-workflow-run-roster-card", {
        runId: "r-5",
        phase: "review",
        actors: [{ name: "reviewer" }, "fixer"],
      }),
      toolEnd("get-workflow-run-roster-card"),
    )
    expect(screen.getByTestId("card-actors")).toHaveTextContent("1. reviewer")
    expect(screen.getByTestId("card-actors")).toHaveTextContent("2. fixer")
    expect(rowLabels()).toEqual([])
  })

  it("opaque card payloads land in the generic JSON preview", () => {
    const first = renderInput("get-workflow-run-card", 42)
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
    first.unmount()
    renderInput("get-workflow-run-roster-card", { actors: "nope" })
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
  })
})

describe("completion fixtures — prompt display family", () => {
  it("agent-prompt: name heading, model/lines rows, prompt block", () => {
    renderPair(
      toolStart("agent-prompt", { name: "fixer", model: "glm-5.3", prompt: "line1\nline2" }),
      toolEnd("agent-prompt"),
    )
    expect(screen.getByTestId("agent-prompt-name")).toHaveTextContent("fixer")
    expect(rowValue("Model")).toBe("glm-5.3")
    expect(rowValue("Lines")).toBe("2")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("line1")
  })

  it("agent-prompt: a bare system prompt renders without a heading", () => {
    renderInput("agent-prompt", { system: "be terse" })
    expect(screen.queryByTestId("agent-prompt-name")).toBeNull()
    expect(screen.getByTestId("tool-code")).toHaveTextContent("be terse")
  })

  it("enter-plan-mode: mode/target/reason section", () => {
    renderPair(
      toolStart("enter-plan-mode", { mode: "plan", target: "auth refactor", reason: "multi-file" }),
      toolEnd("enter-plan-mode", true, 3),
    )
    expect(rowValue("Mode")).toBe("plan")
    expect(rowValue("Target")).toBe("auth refactor")
    expect(rowValue("Reason")).toBe("multi-file")
  })

  it("exit-plan-mode: the plan document is the approval surface", () => {
    renderPair(
      toolStart("exit-plan-mode", { plan: "# Step 1\nStep 2", allowedPrompts: ["run tests"] }),
      toolEnd("exit-plan-mode"),
    )
    expect(rowValue("Lines")).toBe("2")
    expect(rowValue("Prompts")).toBe("1 · run tests")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("Step 2")
  })

  it("opaque prompt payloads fall back to the JSON preview", () => {
    const first = renderInput("agent-prompt", null)
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
    first.unmount()
    renderInput("exit-plan-mode", "text")
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
  })
})

describe("completion fixtures — amend-workflow", () => {
  it("shows the targeted run and the revised script block", () => {
    renderPair(
      toolStart("amend-workflow", {
        runId: "r-7",
        workflowId: "wf-amend",
        script: "phase one\nphase two",
      }),
      toolEnd("amend-workflow", true, 88),
    )
    expect(rowValue("Run")).toBe("r-7")
    expect(rowValue("Workflow")).toBe("wf-amend")
    expect(rowValue("Lines")).toBe("2")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("phase two")
  })

  it("a settings-only amendment reports the settings count", () => {
    renderInput("amend-workflow", { runId: "r-7", settings: { max_concurrency: 3 } })
    expect(rowValue("Settings")).toBe("1")
    expect(screen.queryByTestId("tool-code")).toBeNull()
  })

  it("malformed payloads degrade to the JSON preview", () => {
    renderInput("amend-workflow", 42)
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
  })
})

describe("completion fixtures — computer use", () => {
  it("cua-action: click with selector and dwell rows", () => {
    renderPair(
      toolStart("cua-action", { action: "click", target: "#submit", ms: 120 }),
      toolEnd("cua-action", true, 130),
    )
    const row = screen.getByRole("button")
    expect(row.textContent).toContain("click · #submit")
    expect(rowValue("Action")).toBe("click")
    expect(rowValue("Selector")).toBe("#submit")
    expect(rowValue("Duration")).toBe("120")
  })

  it("cua-action: typed text and hotkeys land in their own rows", () => {
    renderInput("cua-action", { action: "type", target: "#q", text: "hello", key: "Enter" })
    expect(rowValue("Text")).toBe("hello")
    expect(rowValue("Key")).toBe("Enter")
  })

  it("cua-action: malformed payloads fall back to JSON", () => {
    renderInput("cua-action", [])
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
  })

  it("get-app-state: app/window/state/elements section", () => {
    renderPair(
      toolStart("get-app-state", {
        app: "Terminal",
        window: "zsh",
        stateId: "st-1",
        elements: [{}, {}],
      }),
      toolEnd("get-app-state"),
    )
    expect(rowValue("App")).toBe("Terminal")
    expect(rowValue("Window")).toBe("zsh")
    expect(rowValue("State")).toBe("st-1")
    expect(rowValue("Elements")).toBe("2")
  })

  it("get-app-state: a count-only payload still shows the element count", () => {
    renderInput("get-app-state", { app: "X", count: 9 })
    expect(rowValue("Elements")).toBe("9")
  })

  it("list-apps: numbered roster block with count row", () => {
    renderPair(
      toolStart("list-apps", { apps: ["A", { name: "B", pid: "12" }] }),
      toolEnd("list-apps"),
    )
    expect(rowValue("Count")).toBe("2")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("2. B (12)")
  })

  it("screenshot: a renderable payload draws the real <img>", () => {
    renderPair(
      toolStart("screenshot", {
        image: "data:image/png;base64,AAAA",
        width: 100,
        height: 80,
      }),
      toolEnd("screenshot", true, 210),
    )
    const img = screen.getByTestId("screenshot-image")
    expect(img).toHaveAttribute("src", "data:image/png;base64,AAAA")
    expect(rowValue("Preview")).toBe("100×80")
  })

  it("screenshot: a bare file path stays a text row", () => {
    renderInput("screenshot", { path: "/tmp/shot.png" })
    expect(screen.queryByTestId("screenshot-image")).toBeNull()
    expect(rowValue("Path")).toBe("/tmp/shot.png")
  })

  it("screenshot: malformed payloads fall back to JSON", () => {
    renderInput("screenshot", "text")
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
  })
})

describe("completion fixtures — browser family", () => {
  it("browser-navigate: link preview card plus host/title/session rows", () => {
    renderPair(
      toolStart("browser-navigate", {
        url: "https://example.com/x",
        title: "Example",
        sessionId: "s-1",
      }),
      toolEnd("browser-navigate", true, 340),
    )
    const anchor = screen.getByLabelText("Link preview")
    expect(anchor.tagName).toBe("A")
    expect(anchor).toHaveAttribute("href", "https://example.com/x")
    expect(rowValue("Host")).toBe("example.com")
    expect(rowValue("Title")).toBe("Example")
    expect(rowValue("Session")).toBe("s-1")
  })

  it("browser-action: verb · selector reads on the collapsed line", () => {
    renderPair(
      toolStart("browser-action", { action: "fill", selector: "#q", text: "query" }),
      toolEnd("browser-action"),
    )
    expect(screen.getByRole("button").textContent).toContain("fill · #q")
    expect(rowValue("Method")).toBe("fill")
    expect(rowValue("Text")).toBe("query")
  })

  it("both degrade to the JSON preview on malformed payloads", () => {
    const first = renderInput("browser-navigate", undefined)
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
    first.unmount()
    renderInput("browser-action", 42)
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
  })
})

describe("completion fixtures — todo read/write", () => {
  it("todo-write renders the checklist under its own title", () => {
    renderPair(
      toolStart("todo-write", {
        todos: [
          { content: "write the renderer", status: "completed" },
          { content: "test it", status: "in_progress" },
        ],
      }),
      toolEnd("todo-write"),
    )
    expect(screen.getByTestId("tool-title")).toHaveTextContent("Write todos")
    expect(screen.getAllByTestId("todo-item")).toHaveLength(2)
  })

  it("todo-read shares the checklist body under its own title", () => {
    renderPair(
      toolStart("todo-read", { todos: [{ content: "only reading", status: "pending" }] }),
      toolEnd("todo-read"),
    )
    expect(screen.getByTestId("tool-title")).toHaveTextContent("Read todos")
    expect(screen.getByTestId("todo-item")).toHaveTextContent("only reading")
  })

  it("an empty read falls back to JSON; the localized zh titles resolve", () => {
    renderInput("todo-read", {})
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
    setLocale("zh-CN")
    const zh = renderPair(
      toolStart("todo-write", { todos: [{ content: "写渲染器", status: "pending" }] }),
      toolEnd("todo-write"),
    )
    expect(screen.getByTestId("tool-title")).toHaveTextContent("写入待办")
    zh.unmount()
    setLocale("en-US")
    renderInput("cua-action", { action: "click", target: "#x" })
    expect(screen.getByTestId("tool-title")).toHaveTextContent("Computer action")
  })
})

// ── round-3 field audit — RENDERER_FIELD_AUDIT over all 62 registry keys ────

describe("renderer field audit — full verification matrix", () => {
  it("covers exactly the RENDERERS keys — no renderer unaudited, no stale entry", () => {
    expect(Object.keys(RENDERER_FIELD_AUDIT).sort()).toEqual(Object.keys(RENDERERS).sort())
    expect(Object.keys(RENDERER_FIELD_AUDIT)).toHaveLength(62)
  })

  it("every entry maps each field to a real repo source with a density verdict", () => {
    for (const [tool, entry] of Object.entries(RENDERER_FIELD_AUDIT)) {
      const fieldKeys = Object.keys(entry.fields)
      expect(fieldKeys.length, tool).toBeGreaterThan(0)
      for (const [field, source] of Object.entries(entry.fields)) {
        expect(field.length, `${tool}.${field}`).toBeGreaterThan(0)
        expect(source, `${tool}.${field}`).toMatch(/^packages\/[a-z-]+\/src/)
      }
      expect(entry.source, tool).toMatch(/^packages\//)
      expect(["full", "primary-plus-fallback", "schema-complete"], tool).toContain(entry.density)
    }
  })

  it("the six core tools cite their packages/tools/src input schemas", () => {
    const expected: Record<string, string> = {
      bash: "packages/tools/src/bash.ts",
      read: "packages/tools/src/read.ts",
      glob: "packages/tools/src/glob.ts",
      grep: "packages/tools/src/grep.ts",
      permission: "packages/tools/src/permission-service.ts",
      lsp: "packages/tools/src/lsp.ts",
    }
    for (const [tool, source] of Object.entries(expected)) {
      expect(RENDERER_FIELD_AUDIT[tool]?.source, tool).toBe(source)
      for (const source of Object.values(RENDERER_FIELD_AUDIT[tool]!.fields)) {
        expect(source, tool).toBe(source)
      }
    }
    // edit/write cite the file-change schemas too.
    expect(RENDERER_FIELD_AUDIT.edit?.fields.path).toBe("packages/tools/src/edit.ts")
    expect(RENDERER_FIELD_AUDIT.write?.fields.content).toBe("packages/tools/src/write.ts")
  })

  it("the workflow family cites the engine/evolution payload shapes", () => {
    for (const tool of [
      "create-workflow",
      "save-workflow",
      "amend-workflow",
      "get-workflow-run",
      "resume-workflow-run",
      "get-workflow-run-situation",
      "workflow-diagnostics",
      "get-workflow-run-roster-card",
    ]) {
      expect(RENDERER_FIELD_AUDIT[tool]?.source, tool).toContain("packages/workflow-engine")
    }
    expect(RENDERER_FIELD_AUDIT["get-workflow-run"]?.fields.runId).toContain("workflow-engine")
  })

  it("todo's audit cites the runtime enum (status includes cancelled)", () => {
    const todo = RENDERER_FIELD_AUDIT.todo
    expect(todo?.source).toContain("packages/core/src/types.ts")
    expect(todo?.fields.status).toContain("packages/core/src/types.ts")
  })

  it("marks exactly the sub-3-field bodies (primary + structured fallback)", () => {
    expect(LOW_DENSITY_RENDERERS.sort()).toEqual(
      [
        "edit", // inline diff is the payload; file/replaceAll rows ride beside it
        "list-apps", // count row + numbered roster block (no input fields exist)
      ].sort(),
    )
    for (const tool of LOW_DENSITY_RENDERERS) {
      expect(RENDERERS[tool]?.Body, tool).toBeDefined()
    }
  })

  it("the polish round lifted the former low-density bodies to full", () => {
    for (const tool of [
      "todo",
      "todo-read",
      "todo-write", // done/total tallies over the normalized checklist
      "skill", // skill · args key count · args preview
      "exit-plan-mode", // plan block + lines + prompts count/labels row
      "eval-workflow-snippet", // snippet block + timeout/assertions/path/lines
    ]) {
      expect(RENDERER_FIELD_AUDIT[tool]?.density, tool).toBe("full")
    }
  })
})

// ── round-3 fixes — mismatches found by the audit, each with fixtures ───────

describe("audit fixes — permission pattern field no longer dropped", () => {
  it("a pattern-only payload renders the always-rule row (PermissionRequestInput)", () => {
    const vm = extractPermission({ pattern: "rm -rf *" })
    expect(vm.isEmpty).toBe(false)
    expect(vm.rows.map((r) => r.labelKey)).toEqual(["toolRenderers.fields.pattern"])
    expect(vm.rows[0]?.value).toBe("rm -rf *")
  })

  it("renders the pattern beside the event-level ids", () => {
    renderPair(
      toolStart("permission", { requestId: "req-4", pattern: "git push*" }),
      toolEnd("permission"),
    )
    expect(rowValue("ID")).toBe("req-4")
    expect(rowValue("Pattern")).toBe("git push*")
  })
})

describe("audit fixes — bash explicit timeout-only payload", () => {
  it("an explicit timeout is a schema field and renders its row", () => {
    const vm = extractBash({ timeout: 5000 })
    expect(vm.isEmpty).toBe(false)
    expect(vm.rows.map((r) => r.labelKey)).toEqual(["toolRenderers.fields.timeout"])
    expect(vm.rows[0]?.value).toBe("5000")
    expect(extractBash({ workdir: "apps/dashboard" }).isEmpty).toBe(false)
    expect(extractBash({ unrelated: true }).isEmpty).toBe(true)
  })

  it("event fixture: timeout-only input still shows the row, default omitted", () => {
    renderPair(toolStart("bash", { timeout: 30_000 }), toolEnd("bash"))
    expect(rowValue("Timeout")).toBe("30000")
    expect(rowValue("Timeout (default)")).toBeUndefined()
  })
})

describe("audit fixes — todo cancelled status (runtime TodoItem enum)", () => {
  it("normalizes the fourth runtime status instead of mis-reading it as pending", () => {
    const vm = extractTodo({
      todos: [
        { content: "superseded step", status: "cancelled" },
        { content: "us spelling", status: "canceled" },
        { content: "open step", status: "pending" },
      ],
    })
    expect(vm.items.map((i) => i.status)).toEqual(["cancelled", "cancelled", "pending"])
  })

  it("renders the ✕ glyph with strikethrough and the localized label", () => {
    renderPair(
      toolStart("todo", {
        todos: [
          { content: "drop this", status: "cancelled" },
          { content: "keep this", status: "pending" },
        ],
      }),
      toolEnd("todo"),
    )
    const items = screen.getAllByTestId("todo-item")
    expect(items[0]?.textContent).toContain("✕")
    expect(items[0]?.querySelector("span[aria-label]")).toHaveAttribute("aria-label", "Cancelled")
    expect(items[0]?.querySelector("span.line-through")).not.toBeNull()
    expect(items[1]?.textContent).toContain("○")
  })

  it("localizes the cancelled label under zh-CN", () => {
    setLocale("zh-CN")
    renderPair(
      toolStart("todo", { todos: [{ content: "放弃", status: "cancelled" }] }),
      toolEnd("todo"),
    )
    expect(screen.getByTestId("todo-item").querySelector("span[aria-label]")).toHaveAttribute(
      "aria-label",
      "已取消",
    )
  })
})

describe("audit fixes — create-workflow carries script + declared args", () => {
  it("script-only payloads render the source block instead of the JSON fallback", () => {
    const vm = extractCreateWorkflow({ script: 'phase("build")\nreturn done' })
    expect(vm.isEmpty).toBe(false)
    expect(vm.rows.map((r) => r.labelKey)).toEqual(["toolRenderers.fields.lines"])
    expect(vm.rows[0]?.value).toBe("2")
    expect(vm.code?.text).toBe('phase("build")\nreturn done')
    // args count lands on its own row; opaque payloads stay empty.
    expect(
      extractCreateWorkflow({ args: { pr: { type: "number" }, tag: {} } }).rows.some(
        (r) => r.labelKey === "toolRenderers.fields.args",
      ),
    ).toBe(true)
    expect(extractCreateWorkflow({ args: {} }).isEmpty).toBe(true)
  })

  it("event fixture: name + steps + script + args compose one body", () => {
    renderPair(
      toolStart("create-workflow", {
        name: "pr-review",
        steps: [{ ask: "review" }],
        script: "const a = 1\nconst b = 2",
        args: { pr: { type: "number" } },
      }),
      toolEnd("create-workflow", true, 30),
    )
    expect(rowValue("Name")).toBe("pr-review")
    expect(rowValue("Steps")).toBe("1")
    expect(rowValue("Lines")).toBe("2")
    expect(rowValue("Args")).toBe("1")
    // The script (not the numbered steps) takes the primary block.
    expect(screen.getByTestId("tool-code")).toHaveTextContent("const b = 2")
  })

  it("event fixture: whenToUse feeds the description row", () => {
    renderPair(
      toolStart("create-workflow", { name: "bench", whenToUse: "nightly benches" }),
      toolEnd("create-workflow"),
    )
    expect(rowValue("Description")).toBe("nightly benches")
  })
})

describe("audit fixes — save-workflow carries script + declared args", () => {
  it("script and args extend the name/scope/description/force rows", () => {
    const vm = extractSaveWorkflow({
      name: "bench",
      scope: "global",
      script: 'log("hi")\nlog("bye")\nlog("end")',
      args: { suite: { type: "string" } },
    })
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.name",
      "toolRenderers.fields.scope",
      "toolRenderers.fields.lines",
      "toolRenderers.fields.args",
    ])
    expect(vm.code?.text).toBe('log("hi")\nlog("bye")\nlog("end")')
    expect(extractSaveWorkflow({ whenToUse: "reuse me" }).isEmpty).toBe(false)
  })

  it("event fixture: the saved script renders as the block with its line count", () => {
    renderPair(
      toolStart("save-workflow", { name: "nightly", script: "step one\nstep two\nstep three" }),
      toolEnd("save-workflow", true, 12),
    )
    expect(rowValue("Name")).toBe("nightly")
    expect(rowValue("Lines")).toBe("3")
    expect(screen.getByTestId("tool-code")).toHaveTextContent("step three")
    expect(screen.queryByTestId("tool-json-preview")).toBeNull()
  })
})

describe("audit fixes — eval-workflow-snippet accepts the path form", () => {
  it("a path-only snippet names its file instead of degrading to JSON", () => {
    const vm = extractEvalWorkflowSnippet({ path: ".zcode/workflows/pr.dwf.ts", timeoutMs: 60_000 })
    expect(vm.isEmpty).toBe(false)
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.timeout",
      "toolRenderers.fields.path",
    ])
    expect(vm.headline).toBe(".zcode/workflows/pr.dwf.ts")
    expect(vm.code).toBeUndefined()
    expect(
      extractEvalWorkflowSnippet({ snippetPath: "s.ts" }).rows.some((r) => r.value === "s.ts"),
    ).toBe(true)
  })

  it("event fixture: code+path exclusivity keeps the code block primary", () => {
    renderPair(
      toolStart("eval-workflow-snippet", { code: "const a = 1", timeoutMs: 1000 }),
      toolEnd("eval-workflow-snippet"),
    )
    expect(rowValue("Timeout")).toBe("1000")
    expect(rowValue("Path")).toBeUndefined()
    expect(screen.getByTestId("tool-code")).toHaveTextContent("const a = 1")
  })
})

// ── round-3 polish — outcome stats, inline errors, low-density top-ups ──────

describe("polish — group outcome stats (countOutcomes)", () => {
  it("tallies ok / failed / unknown and the total", () => {
    const stats = countOutcomes([
      { tool: "bash", input: {}, ok: true },
      { tool: "bash", input: {}, ok: false },
      { tool: "bash", input: {}, ok: true },
      { tool: "read", input: {} },
    ])
    expect(stats).toEqual({ total: 4, ok: 2, failed: 1, unknown: 1 })
  })

  it("an all-success group reports zero failures and zero unrecorded", () => {
    const stats = countOutcomes(
      Array.from({ length: 3 }, (_, i) => ({
        tool: "bash",
        input: { command: `c${i}` },
        ok: true,
      })),
    )
    expect(stats).toEqual({ total: 3, ok: 3, failed: 0, unknown: 0 })
  })

  it("an empty group tallies to all-zero", () => {
    expect(countOutcomes([])).toEqual({ total: 0, ok: 0, failed: 0, unknown: 0 })
  })

  it("envelope success aliases normalize into the ok tally", () => {
    const { children } = extractGroupChildren(
      { items: [{ success: true }, { success: false, tool: "edit" }, { tool: "read" }] },
      "execute",
    )
    expect(countOutcomes(children)).toEqual({ total: 3, ok: 1, failed: 1, unknown: 1 })
  })

  it("execute-group body renders the ok/failed badges; unrecorded only when present", () => {
    renderInput("execute-group", {
      items: [
        { tool: "bash", command: "ok-one", ok: true },
        { tool: "bash", command: "bad-one", ok: false, error: "exit 1" },
      ],
    })
    expect(screen.getByTestId("tool-group-outcomes")).toBeInTheDocument()
    expect(screen.getByTestId("tool-group-ok")).toHaveTextContent("1 ok")
    expect(screen.getByTestId("tool-group-failed")).toHaveTextContent("1 failed")
    expect(screen.queryByTestId("tool-group-unknown")).toBeNull()
  })

  it("children without outcome flags surface the unrecorded badge", () => {
    renderInput("cua-group", { items: [{ action: "click" }, { action: "type" }] })
    expect(screen.getByTestId("tool-group-unknown")).toHaveTextContent("2 unrecorded")
    expect(screen.getByTestId("tool-group-ok")).toHaveTextContent("0 ok")
  })

  it("changes-group keeps the count line beside the badges", () => {
    renderInput("changes-group", {
      items: [
        { oldString: "a", newString: "b", ok: true },
        { content: "x", ok: true },
        { oldString: "c", newString: "d", ok: false },
      ],
    })
    expect(screen.getByTestId("tool-group-count")).toHaveTextContent("3 sub-calls")
    expect(screen.getByTestId("tool-group-ok")).toHaveTextContent("2 ok")
    expect(screen.getByTestId("tool-group-failed")).toHaveTextContent("1 failed")
  })
})

describe("polish — ToolCallBlock collapsed inline error", () => {
  it("a collapsed failed call shows the error as one truncated red line with a full-text title", () => {
    const longError = `ECONNRESET while streaming: ${"x".repeat(300)}`
    render(<ToolCallBlock tool="bash" input={{ command: "deploy" }} ok={false} error={longError} />)
    const line = screen.getByTestId("tool-error-collapsed")
    expect(line).toHaveTextContent("ECONNRESET")
    expect(line.className).toContain("truncate")
    expect(line.className).toContain("text-destructive")
    expect(line.getAttribute("title")).toBe(longError)
  })

  it("the inline row is hidden while expanded (ErrorBlock owns the open state)", () => {
    render(
      <ToolCallBlock
        tool="bash"
        input={{ command: "deploy" }}
        ok={false}
        error="boom"
        defaultOpen
      />,
    )
    expect(screen.queryByTestId("tool-error-collapsed")).toBeNull()
    expect(screen.getByTestId("tool-error")).toHaveTextContent("boom")
  })

  it("successful or error-free collapsed calls render no inline error", () => {
    render(<ToolCallBlock tool="bash" input={{ command: "ls" }} ok />)
    expect(screen.queryByTestId("tool-error-collapsed")).toBeNull()
  })

  it("toggling from collapsed to open swaps the inline row for the ErrorBlock", () => {
    render(<ToolCallBlock tool="task" input={{ prompt: "p" }} ok={false} error="timed out" />)
    expect(screen.getByTestId("tool-error-collapsed")).toHaveTextContent("timed out")
    fireEvent.click(screen.getByRole("button"))
    expect(screen.queryByTestId("tool-error-collapsed")).toBeNull()
    expect(screen.getByTestId("tool-error")).toHaveTextContent("timed out")
  })
})

describe("polish — skill arg-key count", () => {
  it("object args land three structured rows (skill · arg keys · args preview)", () => {
    const vm = extractSkill({ skill: "pdf", args: { page: 1, dir: "asc" } })
    expect(vm.isEmpty).toBe(false)
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.skill",
      "toolRenderers.fields.argsKeys",
      "toolRenderers.fields.args",
    ])
    expect(vm.rows[1]?.value).toBe("2")
  })

  it("string args keep the preview row without a count; bare skill stays single-row", () => {
    const stringArgs = extractSkill({ skill: "pdf", args: "landscape" })
    expect(stringArgs.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.skill",
      "toolRenderers.fields.args",
    ])
    expect(extractSkill({ skill: "pdf" }).rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.skill",
    ])
  })

  it("event fixture: skill body shows the localized arg-key row", () => {
    renderPair(toolStart("skill", { skill: "xlsx", args: { sheet: "q3" } }), toolEnd("skill"))
    expect(rowValue("Arg keys")).toBe("1")
    expect(rowValue("Args")).toContain("sheet")
  })
})

describe("polish — todo status tallies", () => {
  it("counts each normalized status including alias spellings", () => {
    const vm = extractTodo({
      todos: [
        { content: "a", status: "done" },
        { content: "b", status: "in_progress" },
        { content: "c", status: "active" },
        { content: "d", status: "canceled" },
        { content: "e", status: "pending" },
      ],
    })
    expect(vm.statusCounts).toEqual({ pending: 1, in_progress: 2, completed: 1, cancelled: 1 })
  })

  it("empty and malformed payloads tally to zero", () => {
    expect(extractTodo({}).statusCounts).toEqual({
      pending: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    })
    expect(extractTodo(null).statusCounts.completed).toBe(0)
  })

  it("event fixture: the body leads with the done/total progress line", () => {
    renderPair(
      toolStart("todo", {
        todos: [
          { content: "a", status: "completed" },
          { content: "b", status: "completed" },
          { content: "c", status: "pending" },
        ],
      }),
      toolEnd("todo"),
    )
    expect(screen.getByTestId("todo-stats")).toHaveTextContent("2/3 done")
  })

  it("zh-CN renders the progress line localized", () => {
    setLocale("zh-CN")
    renderPair(
      toolStart("todo", { todos: [{ content: "a", status: "completed" }] }),
      toolEnd("todo"),
    )
    expect(screen.getByTestId("todo-stats")).toHaveTextContent("已完成 1/1")
  })
})

describe("polish — exit-plan-mode allow-list preview", () => {
  it("the prompts row carries the count plus the first allow-list labels", () => {
    const vm = extractExitPlanMode({
      plan: "# Step 1",
      allowedPrompts: ["bash(git:*)", "npm run test", { label: "docker build" }],
    })
    const prompts = vm.rows.find((r) => r.labelKey === "toolRenderers.fields.prompts")
    expect(prompts?.value).toBe("3 · bash(git:*), npm run test, docker build")
    expect(vm.code?.text).toBe("# Step 1")
  })

  it("non-string entries fall back to their label field or a JSON preview", () => {
    const vm = extractExitPlanMode({ allowedPrompts: [{ tool: "webfetch" }, 42] })
    const prompts = vm.rows.find((r) => r.labelKey === "toolRenderers.fields.prompts")
    expect(prompts?.value).toBe("2 · webfetch, 42")
  })

  it("an empty allow-list still reports the zero count", () => {
    const vm = extractExitPlanMode({ plan: "p", allowedPrompts: [] })
    const prompts = vm.rows.find((r) => r.labelKey === "toolRenderers.fields.prompts")
    expect(prompts?.value).toBe("0")
  })
})

describe("polish — eval-workflow-snippet line count", () => {
  it("a code snippet gains the derived lines row beside its block", () => {
    const vm = extractEvalWorkflowSnippet({ code: "const a = 1\nconst b = 2" })
    expect(vm.rows.map((r) => r.labelKey)).toEqual(["toolRenderers.fields.lines"])
    expect(vm.rows[0]?.value).toBe("2")
    expect(vm.code?.text).toContain("const b = 2")
  })

  it("the path-only form stays untouched (no invented line count)", () => {
    const vm = extractEvalWorkflowSnippet({ path: "s.dwf.ts", timeoutMs: 500 })
    expect(vm.rows.map((r) => r.labelKey)).toEqual([
      "toolRenderers.fields.timeout",
      "toolRenderers.fields.path",
    ])
  })
})

describe("polish — i18n keys for the new surfaces", () => {
  it("both locales carry the outcome/progress/argsKeys keys", () => {
    const keys = [
      "toolRenderers.group.ok",
      "toolRenderers.group.failed",
      "toolRenderers.group.unknown",
      "toolRenderers.todo.doneCount",
      "toolRenderers.fields.argsKeys",
    ]
    for (const key of keys) {
      expect(enDomain[key as keyof typeof enDomain], key).toBeDefined()
      expect(zhDomain[key as keyof typeof zhDomain], key).toBeDefined()
    }
    expect(zhDomain["toolRenderers.todo.doneCount" as keyof typeof zhDomain]).toContain("{done}")
  })
})
