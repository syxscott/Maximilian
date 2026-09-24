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
 * Core tools (bash/read/glob/grep/permission/lsp) are asserted against the
 * input schemas of packages/tools/src — field names, optionality and
 * defaults (e.g. read's `path`/offset/limit, bash's 120000 ms default
 * timeout capped at 600000, glob/grep limit default 100).
 *
 * The domain dictionaries are registered here directly (the aggregator
 * in src/locales/index.ts is main-session-owned), which also lets us
 * assert zh/en key parity.
 */

import { describe, it, expect, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import zhDomain from "../src/locales/tool-renderers.zh-CN.json"
import enDomain from "../src/locales/tool-renderers.en-US.json"
import { ToolCallBlock, resolveToolRenderer } from "../src/components/tool-renderers/registry"
import { summarizeToolInput, toolInputRows } from "../src/components/tool-renderers/model"
import { RENDERED_TOOLS } from "../src/components/tool-renderers/renderers/index"
import {
  extractWebfetch,
  extractSearch,
  extractMcp,
  urlHost,
} from "../src/components/tool-renderers/renderers/web.model"
import { extractTask } from "../src/components/tool-renderers/renderers/task.model"
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
} from "../src/components/tool-renderers/renderers/workflow.model"
import { extractGroupChildren } from "../src/components/tool-renderers/renderers/group.model"
import { extractFileChange } from "../src/components/tool-renderers/renderers/edit-inline-diff.model"

// Register the domain dictionaries over the core ones (en-US is the test
// locale per test/setup.ts; zh-CN registered for the localized smoke).
const en = { ...(getDictionary("en-US") ?? {}), ...(enDomain as Record<string, string>) }
const zh = { ...(getDictionary("zh-CN") ?? {}), ...(zhDomain as Record<string, string>) }
registerLocale("en-US", en)
registerLocale("zh-CN", zh)
setLocale("en-US")

afterEach(() => {
  cleanup()
  setLocale("en-US")
})

/** The 38 non-core tools this renderer set registers. */
const NEW_TOOLS = [
  "webfetch",
  "search",
  "mcp",
  "agent",
  "task",
  "task-output",
  "task-stop",
  "explore",
  "plan-guidance",
  "ask-question",
  "goal",
  "escalate",
  "todo",
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
  "create-workflow",
  "save-workflow",
  "get-workflow-run",
  "list-saved-workflows",
  "list-workflow-runs",
  "resume-workflow-run",
  "resolve-workflow-question",
  "get-workflow-run-roster",
  "get-workflow-run-situation",
  "eval-workflow-snippet",
  "workflow-diagnostics",
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
    expect(NEW_TOOLS).toHaveLength(38)
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
    expect(vm.headline).toBe("execute")
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
    expect(screen.getByTestId("tool-code")).toHaveTextContent("pnpm vitest run")
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

  it("write: byte/line counts of the schema content plus the all-added diff", () => {
    renderPair(toolStart("write", { path: "notes.md", content: "one\ntwo" }), toolEnd("write"))
    expect(rowValue("Bytes")).toBe("7")
    expect(rowValue("Lines")).toBe("2")
    expect(screen.getByTestId("diff-preview")).toHaveTextContent("+one")
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

  it("switch-mode: mode/from rows", () => {
    renderPair(toolStart("switch-mode", { from: "plan", to: "execute" }), toolEnd("switch-mode"))
    expect(rowValue("Mode")).toBe("execute")
    expect(rowValue("From")).toBe("plan")
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

  it("goal: status and percent progress rows", () => {
    renderPair(
      toolStart("goal", { goal: "align renderers", status: "active", progress: 60 }),
      toolEnd("goal"),
    )
    expect(screen.getByRole("button").textContent).toContain("align renderers")
    expect(rowValue("Status")).toBe("active")
    expect(rowValue("Progress")).toBe("60%")
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
    expect(rowValue("Mode")).toBe("high")
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
    expect(
      within(screen.getByTestId("tool-body")).getByText("https://example.com/a"),
    ).toBeInTheDocument()
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

  it("falls back to the raw JSON preview when no domain field is found", () => {
    render(<ToolCallBlock tool="create-workflow" input={{ opaque: true }} defaultOpen />)
    expect(screen.getByTestId("tool-json-preview")).toBeInTheDocument()
    expect(screen.getByText("Raw input")).toBeInTheDocument()
    const preview = screen.getByTestId("tool-json-preview")
    expect(preview.textContent).toContain('"opaque":true')
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
