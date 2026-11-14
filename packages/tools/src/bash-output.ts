// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// (borrowing) Mini-Agent mini_agent/tools/bash_tool.py BashOutputTool /
// BashKillTool — incremental, cursor-based output retrieval and
// termination for shells started by the `bash` tool with
// run_in_background=true. Both tools are pure views over the
// BackgroundShellRegistry (see bash-background.ts).

import { makeTool, type ToolContent, ToolKind } from "@max/llm"
import { getBackgroundShellRegistry } from "./bash-background.js"

export interface BashOutputInput {
  /** The bash_id returned by the background `bash` call. */
  bashId: string
  /** Caller cursor: first line index NOT yet read. Omit or 0 for a fresh read. */
  last_read_index?: number
  /** Optional regex; only matching lines are returned (cursor still advances past all scanned lines). */
  filter?: string
}

export interface BashOutputResult {
  bashId: string
  status: string
  exitCode: number | null
  /** New lines since last_read_index (after optional filtering). */
  lines: string[]
  output: string
  /** New cursor — pass as last_read_index on the next call. */
  nextIndex: number
  warnings: string[]
  /** True when the bash_id is unknown (bad id, or evicted). */
  notFound: boolean
}

export const bashOutputTool = makeTool<BashOutputInput, BashOutputResult>({
  name: "bash_output",
  description:
    "Retrieve new output from a background shell started with bash(run_in_background=true). " +
    "Pass the bash_id and the last_read_index cursor from your previous call to get exactly the " +
    "new lines since then (no overlap, no loss). An optional filter regex returns only matching " +
    "lines — note non-matching lines are consumed and will not be offered again. Status values: " +
    "running | completed | failed | terminated | error.",
  kind: ToolKind.Execute,
  inputSchema: {
    type: "object",
    properties: {
      bashId: {
        type: "string",
        description:
          "The ID of the background shell (returned by bash with run_in_background=true)",
      },
      last_read_index: {
        type: "number",
        description:
          "Cursor from the previous bash_output call's nextIndex (0 or omitted = read from the start)",
      },
      filter: {
        type: "string",
        description:
          "Optional regex to filter returned lines. Only matching lines are returned; " +
          "the cursor still advances past every scanned line.",
      },
    },
    required: ["bashId"],
  },
  outputSchema: {
    type: "object",
    properties: {
      bashId: { type: "string" },
      status: { type: "string" },
      exitCode: { type: ["number", "null"] },
      lines: { type: "array", items: { type: "string" } },
      output: { type: "string" },
      nextIndex: { type: "number" },
      warnings: { type: "array", items: { type: "string" } },
      notFound: { type: "boolean" },
    },
    required: ["bashId", "status", "lines", "output", "nextIndex", "warnings", "notFound"],
  },
  async execute(input) {
    const registry = getBackgroundShellRegistry()
    const read = registry.read(input.bashId, {
      lastReadIndex: input.last_read_index,
      filter: input.filter,
    })
    if (!read.ok) {
      return {
        bashId: input.bashId,
        status: "error",
        exitCode: null,
        lines: [],
        output: read.error,
        nextIndex: input.last_read_index ?? 0,
        warnings: [read.error],
        notFound: true,
      }
    }
    return {
      ...read,
      notFound: false,
      output: read.lines.length > 0 ? read.lines.join("\n") : "(no new output)",
    }
  },
  toModelOutput(output): ToolContent[] {
    const lines: string[] = []
    if (output.notFound) {
      return [{ type: "text", text: output.output }]
    }
    lines.push(`Status: ${output.status}`)
    if (output.exitCode !== null) lines.push(`Exit code: ${output.exitCode}`)
    if (output.warnings.length > 0) lines.push(`Warnings: ${output.warnings.join("; ")}`)
    lines.push(`Next cursor (last_read_index): ${output.nextIndex}`)
    lines.push(output.output)
    return [{ type: "text", text: lines.join("\n") }]
  },
})

export interface BashKillInput {
  /** The bash_id of the shell to terminate. */
  bashId: string
}

export interface BashKillResult {
  bashId: string
  ok: boolean
  status: string
  exitCode: number | null
  error?: string
}

export const bashKillTool = makeTool<BashKillInput, BashKillResult>({
  name: "bash_kill",
  description:
    "Terminate a background shell started with bash(run_in_background=true). Sends SIGTERM " +
    "first and escalates to SIGKILL after a 5s grace period. Reports the final status " +
    "(terminated) and exit code. The shell record is retained so remaining output stays " +
    "readable via bash_output until the registry GC evicts it.",
  kind: ToolKind.Process,
  inputSchema: {
    type: "object",
    properties: {
      bashId: {
        type: "string",
        description: "The ID of the background shell to terminate",
      },
    },
    required: ["bashId"],
  },
  outputSchema: {
    type: "object",
    properties: {
      bashId: { type: "string" },
      ok: { type: "boolean" },
      status: { type: "string" },
      exitCode: { type: ["number", "null"] },
      error: { type: "string" },
    },
    required: ["bashId", "ok", "status", "exitCode"],
  },
  async execute(input) {
    const registry = getBackgroundShellRegistry()
    const result = await registry.kill(input.bashId)
    if (!result.ok) {
      return {
        bashId: input.bashId,
        ok: false,
        status: "error",
        exitCode: null,
        error: result.error,
      }
    }
    return {
      bashId: result.bashId,
      ok: true,
      status: result.status,
      exitCode: result.exitCode,
    }
  },
  toModelOutput(output): ToolContent[] {
    if (!output.ok) {
      return [{ type: "text", text: output.error ?? `bash_kill failed for ${output.bashId}` }]
    }
    const lines = [`Status: ${output.status}`]
    if (output.exitCode !== null) lines.push(`Exit code: ${output.exitCode}`)
    return [{ type: "text", text: lines.join("\n") }]
  },
})
