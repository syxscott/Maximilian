// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tool-renderers tests — the completed renderer set. Covers, per
 * CONVENTIONS: model-layer extraction (typical / missing / malformed
 * inputs), glyph resolution for every new renderer (non-fallback), and
 * render smokes through ToolCallBlock with @testing-library/react.
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
import { summarizeToolInput } from "../src/components/tool-renderers/model"
import { RENDERED_TOOLS } from "../src/components/tool-renderers/renderers/index"
import {
  extractWebfetch,
  extractSearch,
  extractMcp,
} from "../src/components/tool-renderers/renderers/web.model"
import {
  extractAgent,
  extractTask,
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

/** The 38 tools this change adds to the registry. */
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

const ALL_EXTRACTORS = [
  extractWebfetch,
  extractSearch,
  extractMcp,
  extractAgent,
  extractTask,
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

  it("keeps legacy glyph-only entries and the fallback intact", () => {
    expect(resolveToolRenderer("bash").glyph).toBe("$")
    expect(resolveToolRenderer("read").glyph).toBe("›")
    expect(resolveToolRenderer("edit").glyph).toBe("±")
    expect(resolveToolRenderer("write").glyph).toBe("+")
    expect(resolveToolRenderer("totally-unknown-tool").glyph).toBe("·")
    expect(resolveToolRenderer("totally-unknown-tool").Body).toBeUndefined()
  })

  it("exposes every rendered tool through the aggregation", () => {
    for (const tool of [
      ...NEW_TOOLS,
      "bash",
      "read",
      "edit",
      "write",
      "glob",
      "grep",
      "permission",
      "lsp",
    ]) {
      expect(RENDERED_TOOLS, tool).toContain(tool)
    }
  })
})

describe("i18n dictionaries", () => {
  it("zh and en key sets are identical", () => {
    expect(Object.keys(zhDomain).sort()).toEqual(Object.keys(enDomain).sort())
  })

  it("every rendered tool has a title key in both locales", () => {
    for (const tool of NEW_TOOLS) {
      const key = `toolRenderers.${tool}.title`
      expect(enDomain[key as keyof typeof enDomain], key).toBeDefined()
      expect(zhDomain[key as keyof typeof zhDomain], key).toBeDefined()
    }
  })
})

describe("web family model", () => {
  it("extractWebfetch reads url + prompt", () => {
    const vm = extractWebfetch({ url: "https://example.com", prompt: "sum it" })
    expect(vm.isEmpty).toBe(false)
    expect(vm.headline).toBe("https://example.com")
    expect(vm.rows.map((r) => r.labelKey)).toContain("toolRenderers.fields.url")
  })

  it("extractSearch reads query with path fallbacks", () => {
    const vm = extractSearch({ query: "hook config", path: "docs/" })
    expect(vm.headline).toBe("hook config")
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

describe("agent family model", () => {
  it("extractAgent reads role/prompt/name defensively", () => {
    expect(extractAgent({ agentRole: "explorer", prompt: "find X" }).headline).toBe("@explorer")
    expect(extractAgent({ role: "reviewer" }).rows[0]?.value).toBe("reviewer")
    expect(extractAgent({}).isEmpty).toBe(true)
  })

  it("extractTask reads taskId (snake_case alias) + status", () => {
    expect(extractTask({ taskId: "t1", status: "running" }).headline).toBe("t1")
    expect(extractTask({ task_id: "t2" }).headline).toBe("t2")
    expect(extractTask({ status: "done" }).rows[0]?.labelKey).toBe("toolRenderers.fields.status")
  })

  it("extractTaskOutput reads taskId + timeout", () => {
    const vm = extractTaskOutput({ taskId: "t1", timeoutMs: 3000 })
    expect(vm.headline).toBe("t1")
    expect(vm.rows.map((r) => r.value)).toContain("3000")
  })

  it("extractTaskStop reads taskId + reason", () => {
    expect(extractTaskStop({ taskId: "t1", reason: "superseded" }).headline).toBe("t1")
    expect(extractTaskStop({ reason: "done" }).headline).toBe("done")
  })

  it("extractExplore reads query + paths", () => {
    const vm = extractExplore({ query: "auth flow", paths: ["src/a", "src/b"] })
    expect(vm.headline).toBe("auth flow")
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.target")).toBe(true)
  })

  it("extractPlanGuidance reads goal + phase", () => {
    expect(extractPlanGuidance({ goal: "ship", phase: "verify" }).headline).toBe("ship")
    expect(extractPlanGuidance({ phase: "verify" }).headline).toBe("verify")
  })
})

describe("coordination family model", () => {
  it("extractAskQuestion reads question + options", () => {
    const vm = extractAskQuestion({ question: "Go?", options: ["yes", "no"] })
    expect(vm.headline).toBe("Go?")
    expect(vm.rows.some((r) => r.value === "yes | no")).toBe(true)
  })

  it("extractGoal reads goal + status", () => {
    expect(extractGoal({ goal: "G", status: "active" }).headline).toBe("G")
    expect(extractGoal({ status: "active" }).headline).toBe("active")
  })

  it("extractEscalate reads reason/target/severity", () => {
    const vm = extractEscalate({ reason: "blocked", to: "coordinator", severity: "high" })
    expect(vm.headline).toBe("blocked")
    expect(vm.rows.length).toBe(3)
  })

  it("extractTodo counts todos (locale-neutral headline)", () => {
    const vm = extractTodo({ todos: [{}, {}, {}] })
    expect(vm.headline).toBe("×3")
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.count")).toBe(true)
  })

  it("extractSkill reads skill + args preview", () => {
    const vm = extractSkill({ skill: "pdf", args: { page: 1 } })
    expect(vm.headline).toBe("pdf")
    expect(vm.rows.some((r) => r.labelKey === "toolRenderers.fields.args")).toBe(true)
  })

  it("extractSendMessage reads target + message", () => {
    expect(extractSendMessage({ to: "coord", message: "hi" }).headline).toBe("hi")
    expect(extractSendMessage({ message: "hi" }).headline).toBe("hi")
  })

  it("extractRespondToCoordinator prefers summary over message", () => {
    expect(extractRespondToCoordinator({ summary: "done", message: "all green" }).headline).toBe(
      "done",
    )
    expect(extractRespondToCoordinator({ message: "all green" }).headline).toBe("all green")
  })

  it("extractSubmitResult reads summary/result", () => {
    const vm = extractSubmitResult({ result: "42" })
    expect(vm.headline).toBe("42")
    expect(vm.rows[0]?.mono).toBe(true)
  })

  it("extractSwitchMode reads to/from aliases", () => {
    const vm = extractSwitchMode({ from: "plan", to: "execute" })
    expect(vm.headline).toBe("execute")
    expect(vm.rows.map((r) => r.value)).toEqual(["execute", "plan"])
  })

  it("extractListModels reads provider or counts models", () => {
    expect(extractListModels({ provider: "zai" }).headline).toBe("zai")
    const counted = extractListModels({ models: ["a", "b"] })
    expect(counted.isEmpty).toBe(false)
    expect(counted.rows.some((r) => r.value === "2")).toBe(true)
    expect(extractListModels({}).isEmpty).toBe(true)
  })

  it("extractReadSessionContext reads session/query/strategy", () => {
    const vm = extractReadSessionContext({
      sessionId: "sess_1",
      query: "find X",
      strategy: "handoff",
    })
    expect(vm.headline).toBe("sess_1")
    expect(vm.rows.length).toBe(3)
  })
})

describe("schedule family model", () => {
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
})

describe("repl family model", () => {
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
})

describe("workflow family model", () => {
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

describe("edit-inline-diff model", () => {
  it("accepts edit pairs and write content (camelCase, like extractChange)", () => {
    expect(
      extractFileChange("edit", { file_path: "a.ts", oldString: "x", newString: "y" }).hasDiff,
    ).toBe(true)
    expect(extractFileChange("write", { content: "hello" }).hasDiff).toBe(true)
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
      extractWebfetch({ url: "https://x", prompt: "y" }),
      extractAgent({ agentRole: "a", prompt: "p" }),
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

describe("summarize (collapsed line) for new tools", () => {
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

  it("edit: inline diff via DiffPreview with +/- gutters", () => {
    render(
      <ToolCallBlock
        tool="edit"
        input={{ file_path: "a.ts", oldString: "x\ny", newString: "x\nz" }}
        defaultOpen
      />,
    )
    expect(screen.getByTestId("diff-preview")).toBeInTheDocument()
    expect(screen.getByTestId("tool-body").textContent).toContain("Edit file")
  })

  it("toggles open/closed from the collapsed row", () => {
    render(<ToolCallBlock tool="agent" input={{ agentRole: "explorer" }} />)
    expect(screen.queryByTestId("tool-body")).toBeNull()
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByTestId("tool-body")).toBeInTheDocument()
  })

  it("surfaces tool errors in the body area", () => {
    render(
      <ToolCallBlock tool="task" input={{ taskId: "t1" }} ok={false} error="boom" defaultOpen />,
    )
    expect(screen.getByTestId("tool-error")).toHaveTextContent("boom")
  })

  it("renders localized titles under zh-CN", () => {
    setLocale("zh-CN")
    render(<ToolCallBlock tool="webfetch" input={{ url: "https://example.com" }} defaultOpen />)
    expect(screen.getByText("网络抓取")).toBeInTheDocument()
  })
})
