// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * RENDERER_FIELD_AUDIT — the full verification matrix for the RENDERERS
 * table (round-3 "real event field" completion pass + the polish round
 * that closed the remaining low-density bodies). One entry per
 * registry key (kept 1:1 with RENDERERS — a test fails if the two drift):
 *
 *   fields  → the canonical payload fields the extractor reads, each
 *             mapped to the real source its spelling was verified against;
 *   source  → the primary real source for the payload shape;
 *   density → how the verified fields land in the Body:
 *               "full"                    ≥3 payload dimensions (rows,
 *                                         chips, blocks combined);
 *               "primary-plus-fallback"   the primary payload renders as a
 *                                         structured block (diff / roster)
 *                                         with typed rows beside it — the
 *                                         deliberate remainder (edit,
 *                                         list-apps);
 *               "schema-complete"         the real payload only carries ≤2
 *                                         fields — inventing rows would
 *                                         misreport the event (unused
 *                                         since the polish round);
 *   note    → default-value checks and deliberate omissions.
 *
 * Real sources, three classes:
 *   ① packages/tools/src — the input schemas of the core tools
 *     (bash/read/write/edit/glob/grep + permission-service + lsp client);
 *   ② packages/core/src/tool-integration.ts + runtime.ts — the runtime
 *     forwards ToolCall.input VERBATIM on tool-start ("input: call.input"),
 *     so every passthrough tool's field set is whatever the producing
 *     harness sent; defensive aliases stay keyed to that surface;
 *   ③ packages/workflow-engine/src/index.ts (+ packages/evolution/
 *     variant-runner.ts) — the workflow tool family's payload shapes
 *     (runId/scriptHash/steps/phase/attempt, phaseProgress).
 */

/** ① — packages/tools/src input schemas (core tools). */
const S_TOOLS = {
  bash: "packages/tools/src/bash.ts",
  read: "packages/tools/src/read.ts",
  glob: "packages/tools/src/glob.ts",
  grep: "packages/tools/src/grep.ts",
  edit: "packages/tools/src/edit.ts",
  write: "packages/tools/src/write.ts",
  permission: "packages/tools/src/permission-service.ts",
  lsp: "packages/tools/src/lsp.ts",
} as const

/** ② — the runtime event passthrough (ToolCall.input forwarded verbatim). */
const S_PASSTHROUGH =
  "packages/core/src/tool-integration.ts (ToolCall.input) → runtime.ts tool-start"

/** ② — the runtime todo item enum (status includes "cancelled"). */
const S_TODO = "packages/core/src/types.ts (TodoItem) via runtime.ts tool-start"

/** ③ — the workflow engine's journal/run payload shapes. */
const S_WORKFLOW =
  "packages/workflow-engine/src/index.ts + packages/evolution/src/variant-runner.ts"

/** ② — the workflow tool family as offered to the model (facade shapes). */
const S_WORKFLOW_FACADE = "packages/core/src/tool-integration.ts passthrough (workflow tool family)"

export type RendererDensity = "full" | "primary-plus-fallback" | "schema-complete"

export interface RendererFieldAuditEntry {
  /** Canonical extracted field (schema spelling) → the source defining it. */
  fields: Readonly<Record<string, string>>
  /** Primary real source of the payload shape. */
  source: string
  /** Body density after the audit (see module doc). */
  density: RendererDensity
  /** Default-value checks and deliberate omissions. */
  note?: string
}

export const RENDERER_FIELD_AUDIT: Record<string, RendererFieldAuditEntry> = {
  // ── core tools (① input schemas) ────────────────────────────────────────────
  bash: {
    fields: {
      command: S_TOOLS.bash,
      workdir: S_TOOLS.bash,
      timeout: S_TOOLS.bash,
      description: S_TOOLS.bash,
    },
    source: S_TOOLS.bash,
    density: "full",
    note: "timeout defaults to 120000 ms (BASH_DEFAULT_TIMEOUT_MS), capped at 600000 (execute clamps via Math.min); explicit timeout-only payloads render the row.",
  },
  read: {
    fields: { path: S_TOOLS.read, offset: S_TOOLS.read, limit: S_TOOLS.read },
    source: S_TOOLS.read,
    density: "full",
    note: "offset is 0-based; the derived range row mirrors read.ts (lines.slice(offset, offset+limit), startLine = offset+1).",
  },
  glob: {
    fields: { pattern: S_TOOLS.glob, path: S_TOOLS.glob, limit: S_TOOLS.glob },
    source: S_TOOLS.glob,
    density: "full",
    note: "limit defaults to 100 (glob.ts input.limit ?? 100).",
  },
  grep: {
    fields: {
      pattern: S_TOOLS.grep,
      path: S_TOOLS.grep,
      include: S_TOOLS.grep,
      limit: S_TOOLS.grep,
    },
    source: S_TOOLS.grep,
    density: "full",
    note: "include is the file filter; limit defaults to 100 (grep.ts input.limit ?? 100).",
  },
  permission: {
    fields: {
      tool: S_TOOLS.permission,
      target: S_TOOLS.permission,
      requestId: S_TOOLS.permission,
      pattern: S_TOOLS.permission,
      timeoutMs: S_TOOLS.permission,
    },
    source: S_TOOLS.permission,
    density: "full",
    note: "Mirrors PermissionRequestInput; the runtime's permission-request event carries the same ids at event level (runtime.ts).",
  },
  lsp: {
    fields: {
      method: S_TOOLS.lsp,
      uri: S_TOOLS.lsp,
      languageId: S_TOOLS.lsp,
      content: S_TOOLS.lsp,
    },
    source: S_TOOLS.lsp,
    density: "full",
    note: "LSPClient surface: method diagnostics|documentSymbols over (uri, content); languageId comes from the server spec.",
  },

  // ── file changes (① input schemas) ─────────────────────────────────────────
  edit: {
    fields: {
      path: S_TOOLS.edit,
      oldString: S_TOOLS.edit,
      newString: S_TOOLS.edit,
      replaceAll: S_TOOLS.edit,
    },
    source: S_TOOLS.edit,
    density: "primary-plus-fallback",
    note: "Body = the real oldString/newString inline diff (DiffPreview) plus file/replaceAll rows; the diff is the payload.",
  },
  write: {
    fields: { path: S_TOOLS.write, content: S_TOOLS.write },
    source: S_TOOLS.write,
    density: "full",
    note: "Byte/line counts derive from the schema content; body mounts DocumentPreviewBlock.",
  },

  // ── web surface (② passthrough) ─────────────────────────────────────────────
  webfetch: {
    fields: {
      url: S_PASSTHROUGH,
      prompt: S_PASSTHROUGH,
      method: S_PASSTHROUGH,
      selector: S_PASSTHROUGH,
      excerpt: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "host derives from url (web.model urlHost); excerpt renders as the LinkPreviewCard summary.",
  },
  search: {
    fields: {
      query: S_PASSTHROUGH,
      allowedDomains: S_PASSTHROUGH,
      blockedDomains: S_PASSTHROUGH,
      results: S_PASSTHROUGH,
      resultCount: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "Top three hit titles render as citation ordinals; explicit resultCount wins over the array length.",
  },
  mcp: {
    fields: { server: S_PASSTHROUGH, tool: S_PASSTHROUGH, args: S_PASSTHROUGH },
    source: S_PASSTHROUGH,
    density: "full",
  },

  // ── agents & tasks (② passthrough) ─────────────────────────────────────────
  agent: {
    fields: {
      name: S_PASSTHROUGH,
      system: S_PASSTHROUGH,
      model: S_PASSTHROUGH,
      prompt: S_PASSTHROUGH,
      agentRole: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "StatusPill spawn status comes from the tool-end (task.model spawnStatus).",
  },
  "agent-prompt": {
    fields: { name: S_PASSTHROUGH, model: S_PASSTHROUGH, prompt: S_PASSTHROUGH },
    source: S_PASSTHROUGH,
    density: "full",
  },
  task: {
    fields: {
      prompt: S_PASSTHROUGH,
      description: S_PASSTHROUGH,
      subagent_type: S_PASSTHROUGH,
      model: S_PASSTHROUGH,
      run_in_background: S_PASSTHROUGH,
      ownedFiles: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "ownedFiles aliases the runtime's ownedFiles gate (tool-integration.ts FILE_WRITE_TOOLS).",
  },
  "task-output": {
    fields: {
      taskId: S_PASSTHROUGH,
      block: S_PASSTHROUGH,
      timeoutMs: S_PASSTHROUGH,
      output: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
  },
  "task-stop": {
    fields: {
      taskId: S_PASSTHROUGH,
      reason: S_PASSTHROUGH,
      force: S_PASSTHROUGH,
      stops: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "stops entries normalize to ids ({taskId|id|shellId|jobId} records or strings).",
  },
  explore: {
    fields: {
      query: S_PASSTHROUGH,
      paths: S_PASSTHROUGH,
      path: S_PASSTHROUGH,
      strategy: S_PASSTHROUGH,
      depth: S_PASSTHROUGH,
      breadth: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "depth/breadth collapse into one scope row.",
  },
  "plan-guidance": {
    fields: {
      goal: S_PASSTHROUGH,
      phase: S_PASSTHROUGH,
      steps: S_PASSTHROUGH,
      revision: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
  },

  // ── plan mode (② passthrough) ───────────────────────────────────────────────
  "enter-plan-mode": {
    fields: { mode: S_PASSTHROUGH, reason: S_PASSTHROUGH, scope: S_PASSTHROUGH },
    source: S_PASSTHROUGH,
    density: "full",
    note: "The real call usually carries no input — the mode row simply stays absent then.",
  },
  "exit-plan-mode": {
    fields: { plan: S_PASSTHROUGH, allowedPrompts: S_PASSTHROUGH },
    source: S_PASSTHROUGH,
    density: "full",
    note: "Real payload = { plan, allowedPrompts }; the plan document renders as the clamped block, the prompts row carries the count plus the first allow-list labels.",
  },

  // ── coordination (② passthrough, todo enum from core types) ────────────────
  "ask-question": {
    fields: {
      questions: S_PASSTHROUGH,
      header: S_PASSTHROUGH,
      question: S_PASSTHROUGH,
      multiSelect: S_PASSTHROUGH,
      options: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
  },
  goal: {
    fields: { goal: S_PASSTHROUGH, status: S_PASSTHROUGH, progress: S_PASSTHROUGH },
    source: S_PASSTHROUGH,
    density: "full",
    note: "progress normalizes to 0-100 (string percents parse).",
  },
  escalate: {
    fields: {
      reason: S_PASSTHROUGH,
      target: S_PASSTHROUGH,
      severity: S_PASSTHROUGH,
      context: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
  },
  todo: {
    fields: {
      todos: S_TODO,
      content: S_TODO,
      status: S_TODO,
      priority: S_TODO,
    },
    source: S_TODO,
    density: "full",
    note: "Runtime TodoItem status enum is pending|in_progress|completed|cancelled — all four normalize; the done/total stats line is tallied from the normalized statuses above the checklist body.",
  },
  "todo-read": {
    fields: { todos: S_TODO },
    source: S_TODO,
    density: "full",
    note: "Same payload, status tallies and checklist body as todo.",
  },
  "todo-write": {
    fields: { todos: S_TODO },
    source: S_TODO,
    density: "full",
    note: "Same payload, status tallies and checklist body as todo.",
  },
  skill: {
    fields: { skill: S_PASSTHROUGH, args: S_PASSTHROUGH },
    source: S_PASSTHROUGH,
    density: "full",
    note: "The real surface is exactly { skill, args }; object args land three dimensions (skill · derived args key count · args preview row), string/array args the preview row only.",
  },
  "send-message": {
    fields: { to: S_PASSTHROUGH, summary: S_PASSTHROUGH, message: S_PASSTHROUGH },
    source: S_PASSTHROUGH,
    density: "full",
    note: "Preview row clamps to 80 chars; the full message renders as the block.",
  },
  "submit-result": {
    fields: {
      summary: S_PASSTHROUGH,
      result: S_PASSTHROUGH,
      task: S_PASSTHROUGH,
      metadata: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "metadata reports its key count; usage-bearing payloads mount TokenUsageBadge.",
  },
  "switch-mode": {
    fields: { mode: S_PASSTHROUGH, from: S_PASSTHROUGH, reason: S_PASSTHROUGH },
    source: S_PASSTHROUGH,
    density: "full",
    note: "to/modeTo aliases fold into `mode`; both ends known → the from → to arrow.",
  },
  "list-models": {
    fields: {
      provider: S_PASSTHROUGH,
      reasoningLevel: S_PASSTHROUGH,
      models: S_PASSTHROUGH,
      limit: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "No-arg discovery calls render the localized note (listModels.noFilters).",
  },
  "read-session-context": {
    fields: {
      sessionId: S_PASSTHROUGH,
      query: S_PASSTHROUGH,
      strategy: S_PASSTHROUGH,
      maxTokens: S_PASSTHROUGH,
      result: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
  },
  "respond-to-coordinator": {
    fields: {
      to: S_PASSTHROUGH,
      responseType: S_PASSTHROUGH,
      summary: S_PASSTHROUGH,
      message: S_PASSTHROUGH,
      task: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
  },

  // ── scheduled work (② passthrough) ─────────────────────────────────────────
  "cron-create": {
    fields: {
      schedule: S_PASSTHROUGH,
      command: S_PASSTHROUGH,
      name: S_PASSTHROUGH,
      description: S_PASSTHROUGH,
      timezone: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
  },
  "offpeak-create": {
    fields: {
      interval: S_PASSTHROUGH,
      intervalMinutes: S_PASSTHROUGH,
      durationMinutes: S_PASSTHROUGH,
      start: S_PASSTHROUGH,
      end: S_PASSTHROUGH,
      command: S_PASSTHROUGH,
      label: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "start+end compose the window row; intervalMinutes/durationMinutes render with an m suffix.",
  },

  // ── node REPL (② passthrough) ───────────────────────────────────────────────
  "node-repl": {
    fields: { code: S_PASSTHROUGH, title: S_PASSTHROUGH, timeoutMs: S_PASSTHROUGH },
    source: S_PASSTHROUGH,
    density: "full",
  },
  "node-repl-image-grid": {
    fields: { title: S_PASSTHROUGH, images: S_PASSTHROUGH, image: S_PASSTHROUGH },
    source: S_PASSTHROUGH,
    density: "full",
    note: "Images classify into renderable sources (data URI / http(s)) vs bare paths.",
  },

  // ── computer use (② passthrough) ────────────────────────────────────────────
  "cua-action": {
    fields: {
      action: S_PASSTHROUGH,
      target: S_PASSTHROUGH,
      text: S_PASSTHROUGH,
      key: S_PASSTHROUGH,
      ms: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
  },
  "get-app-state": {
    fields: {
      app: S_PASSTHROUGH,
      window: S_PASSTHROUGH,
      stateId: S_PASSTHROUGH,
      elements: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "elements falls back to an explicit count field.",
  },
  "list-apps": {
    fields: { apps: S_PASSTHROUGH },
    source: S_PASSTHROUGH,
    density: "primary-plus-fallback",
    note: "The call takes no input fields; the payload is the returned roster — count row + numbered roster block.",
  },
  screenshot: {
    fields: {
      image: S_PASSTHROUGH,
      path: S_PASSTHROUGH,
      width: S_PASSTHROUGH,
      height: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "Renderable sources draw the real <img>; width×height compose the preview row.",
  },

  // ── browser automation (② passthrough) ─────────────────────────────────────
  "browser-navigate": {
    fields: {
      url: S_PASSTHROUGH,
      title: S_PASSTHROUGH,
      sessionId: S_PASSTHROUGH,
      status: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "host derives from url; the URL doubles as the LinkPreviewCard anchor.",
  },
  "browser-action": {
    fields: {
      action: S_PASSTHROUGH,
      selector: S_PASSTHROUGH,
      text: S_PASSTHROUGH,
      sessionId: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
  },

  // ── dynamic workflows (③ engine payload shapes) ────────────────────────────
  "create-workflow": {
    fields: {
      name: S_WORKFLOW_FACADE,
      description: S_WORKFLOW_FACADE,
      script: S_WORKFLOW_FACADE,
      steps: S_WORKFLOW,
      phases: S_WORKFLOW,
      args: S_WORKFLOW_FACADE,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "script (the byte-identical source the engine journals its scriptHash over) renders as the primary block; declared args report their key count; whenToUse aliases description; distinct WorkflowStep.phase markers report the phase count.",
  },
  "save-workflow": {
    fields: {
      name: S_WORKFLOW_FACADE,
      scope: S_WORKFLOW_FACADE,
      description: S_WORKFLOW_FACADE,
      force: S_WORKFLOW_FACADE,
      script: S_WORKFLOW_FACADE,
      args: S_WORKFLOW_FACADE,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "force aliases overwrite; whenToUse aliases description; the saved script renders as the block with its line count. No steps field: the facade saves {name, description, whenToUse, script, args, scope} — steps come from the script.",
  },
  "amend-workflow": {
    fields: {
      runId: S_WORKFLOW,
      workflowId: S_WORKFLOW,
      script: S_WORKFLOW,
      preserve: S_WORKFLOW,
      maxConcurrency: S_WORKFLOW_FACADE,
      subagentModel: S_WORKFLOW_FACADE,
      settings: S_WORKFLOW_FACADE,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "script candidates include path/scriptPath (resume requires a byte-identical script — engine WorkflowScriptChangedError); the facade's maxConcurrency/subagentModel are read flat beside the nested settings record.",
  },
  "get-workflow-run": {
    fields: {
      runId: S_WORKFLOW,
      workflowId: S_WORKFLOW,
      status: S_WORKFLOW,
      phase: S_WORKFLOW,
      scriptHash: S_WORKFLOW,
      completed: S_WORKFLOW,
      phaseProgress: S_WORKFLOW,
      skippedFromJournal: S_WORKFLOW,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "Reads the full WorkflowRunReport: runId/scriptHash identify the run, completed[]/phaseProgress compose the progress row (completed/total when the payload states a total), skippedFromJournal the journal short-circuit count; status/phase are the runtime's live labels.",
  },
  "list-saved-workflows": {
    fields: {
      scope: S_WORKFLOW_FACADE,
      query: S_WORKFLOW_FACADE,
      workflows: S_WORKFLOW_FACADE,
      limit: S_WORKFLOW_FACADE,
    },
    source: S_WORKFLOW,
    density: "full",
  },
  "list-workflow-runs": {
    fields: {
      status: S_WORKFLOW,
      limit: S_WORKFLOW_FACADE,
      workflowId: S_WORKFLOW,
      runs: S_WORKFLOW,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "count belongs to the limit family here; bare `total` lands in the count row.",
  },
  "resume-workflow-run": {
    fields: {
      runId: S_WORKFLOW,
      workflowId: S_WORKFLOW,
      status: S_WORKFLOW,
      phase: S_WORKFLOW,
      scriptHash: S_WORKFLOW,
      phaseProgress: S_WORKFLOW,
      skippedFromJournal: S_WORKFLOW,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "Resume replays journaled steps: the report carries the same WorkflowRunReport shapes — skippedFromJournal is the resume-specific count, scriptHash the byte-identity gate (WorkflowScriptChangedError).",
  },
  "resolve-workflow-question": {
    fields: {
      questionId: S_WORKFLOW_FACADE,
      answer: S_WORKFLOW_FACADE,
      runId: S_WORKFLOW,
      question: S_WORKFLOW_FACADE,
    },
    source: S_WORKFLOW,
    density: "full",
  },
  "get-workflow-run-roster": {
    fields: {
      runId: S_WORKFLOW,
      workflowId: S_WORKFLOW,
      phase: S_WORKFLOW,
      actors: S_WORKFLOW,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "phase falls back to status; actors normalize to a count.",
  },
  "get-workflow-run-situation": {
    fields: {
      runId: S_WORKFLOW,
      workflowId: S_WORKFLOW,
      status: S_WORKFLOW,
      phase: S_WORKFLOW,
      phaseProgress: S_WORKFLOW,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "phaseProgress sums into the progress row — a situation report without it would not say how far the run got.",
  },
  "eval-workflow-snippet": {
    fields: {
      code: S_WORKFLOW_FACADE,
      path: S_WORKFLOW_FACADE,
      timeoutMs: S_WORKFLOW_FACADE,
      assertions: S_WORKFLOW_FACADE,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "code|path are exclusive; the snippet itself is the primary block, timeout/assertion/path rows and the derived snippet line count ride beside it. timeoutMs defaults to 60000 ms and is capped at 600000 (facade clamp).",
  },
  "workflow-diagnostics": {
    fields: {
      runId: S_WORKFLOW,
      workflowId: S_WORKFLOW,
      phase: S_WORKFLOW,
      status: S_WORKFLOW,
      scriptHash: S_WORKFLOW,
      phaseProgress: S_WORKFLOW,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "Diagnostics ground on the run report: scriptHash (a mismatch is the engine's WorkflowScriptChangedError) and the phaseProgress sum say where the run stands.",
  },

  // ── workflow compact cards (same events, chips carry the dimensions) ───────
  "get-workflow-run-card": {
    fields: {
      runId: S_WORKFLOW,
      workflowId: S_WORKFLOW,
      status: S_WORKFLOW,
      phase: S_WORKFLOW,
      durationMs: S_WORKFLOW,
      phaseProgress: S_WORKFLOW,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "Chips carry status·phase·run + the completed/total progress chip, tone-mapped via phaseTone; rows keep workflow + duration.",
  },
  "list-workflow-runs-card": {
    fields: {
      status: S_WORKFLOW,
      workflowId: S_WORKFLOW,
      runs: S_WORKFLOW,
      total: S_WORKFLOW,
      limit: S_WORKFLOW_FACADE,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "Chips carry status·count (tone-mapped); rows keep workflow/limit/duration.",
  },
  "resume-workflow-run-card": {
    fields: {
      runId: S_WORKFLOW,
      workflowId: S_WORKFLOW,
      status: S_WORKFLOW,
      phase: S_WORKFLOW,
      reason: S_WORKFLOW,
      phaseProgress: S_WORKFLOW,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "Chips carry run·status·phase + the progress chip; rows keep workflow + reason.",
  },
  "get-workflow-run-roster-card": {
    fields: {
      runId: S_WORKFLOW,
      workflowId: S_WORKFLOW,
      phase: S_WORKFLOW,
      actors: S_WORKFLOW,
    },
    source: S_WORKFLOW,
    density: "full",
    note: "Chips carry run·phase·×count; the numbered actor block renders the roster names.",
  },

  // ── group renderers (② passthrough envelope) ────────────────────────────────
  "execute-group": {
    fields: {
      items: S_PASSTHROUGH,
      toolName: S_PASSTHROUGH,
      ok: S_PASSTHROUGH,
      durationMs: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "Sub-call envelopes normalize to the ToolCallBlock props; children re-render recursively (GROUP_LIMIT 8) under the countOutcomes ok/failed summary badges with avgDuration beside them (mean child durationMs, untimed children skipped).",
  },
  "changes-group": {
    fields: {
      items: S_PASSTHROUGH,
      toolName: S_PASSTHROUGH,
      ok: S_PASSTHROUGH,
      durationMs: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "Children without a tool field guess edit/write from their shape (newString/content); the summary row tallies ok/failed via countOutcomes beside the avgDuration mean.",
  },
  "cua-group": {
    fields: {
      items: S_PASSTHROUGH,
      toolName: S_PASSTHROUGH,
      ok: S_PASSTHROUGH,
      durationMs: S_PASSTHROUGH,
    },
    source: S_PASSTHROUGH,
    density: "full",
    note: "Children without a tool field fall back to cua-action; the summary row tallies ok/failed via countOutcomes beside the avgDuration mean.",
  },
}

/** Registry keys whose audit marks a sub-3-field Body (density ≠ "full"). */
export const LOW_DENSITY_RENDERERS: string[] = Object.entries(RENDERER_FIELD_AUDIT)
  .filter(([, entry]) => entry.density !== "full")
  .map(([tool]) => tool)
