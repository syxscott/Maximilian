// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Core-tool model layer — bash / read / glob / grep / permission / lsp,
 * with every extractor keyed to the REAL input schema of the matching
 * implementation in packages/tools/src (the schema is the source of truth):
 *
 *   bash  → packages/tools/src/bash.ts   { command, workdir?, timeout?, description? }
 *           timeout defaults to 120000 ms, capped at 600000 ms
 *   read  → packages/tools/src/read.ts   { path, offset?, limit? } — offset is
 *           0-based, limit defaults to "rest of file"
 *   glob  → packages/tools/src/glob.ts   { pattern, path?, limit? } — limit defaults to 100
 *   grep  → packages/tools/src/grep.ts   { pattern, path?, include?, limit? } — limit defaults to 100
 *   permission → packages/tools/src/permission-service.ts PermissionRequestInput
 *           { tool, target, requestId?, pattern?, timeoutMs? } — same shape the
 *           runtime's `permission-request` event carries (runtime.ts)
 *   lsp   → packages/tools/src/lsp.ts    LSPClient surface: method
 *           ("diagnostics" | "documentSymbols"), uri, languageId?, content?
 *
 * write/edit live in edit-inline-diff.model.ts (their body renders the real
 * oldString/newString pair through DiffPreview).
 *
 * Optional fields are shown with their schema default (timeout / limit use
 * dedicated "…(default)" row labels so the value itself stays locale-free);
 * absent optional fields without an interesting default are simply omitted.
 * Malformed payloads still degrade to the empty view model.
 */

import {
  FIELDS,
  asRecord,
  emptyVm,
  oneLine,
  pickBool,
  pickNum,
  pickStr,
  row,
  utf8Length,
  vmFrom,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"

/** packages/tools/src/bash.ts — DEFAULT_TIMEOUT_MS. */
export const BASH_DEFAULT_TIMEOUT_MS = 120_000
/** packages/tools/src/bash.ts — MAX_TIMEOUT_MS (execute() clamps via Math.min). */
export const BASH_MAX_TIMEOUT_MS = 600_000
/** packages/tools/src/glob.ts + grep.ts — limit default. */
export const SEARCH_LIMIT_DEFAULT = 100

function rowsOf(rows: Array<RendererRow | undefined>): RendererRow[] {
  return rows.filter((r) => r !== undefined)
}

// ── bash ─────────────────────────────────────────────────────────────────────

export function extractBash(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const command = pickStr(obj, ["command", "cmd", "script"])
  const description = pickStr(obj, ["description", "desc", "purpose"])
  const workdir = pickStr(obj, ["workdir", "cwd", "workingDir", "working_dir"])
  const rawTimeout = pickNum(obj, ["timeout", "timeoutMs", "timeout_ms"])
  // Schema default when absent; clamped to the schema max when present.
  const timeout =
    rawTimeout === undefined ? BASH_DEFAULT_TIMEOUT_MS : Math.min(rawTimeout, BASH_MAX_TIMEOUT_MS)
  if (command === undefined && description === undefined && workdir === undefined) return emptyVm()
  const rows = rowsOf([
    row(FIELDS.description, description),
    row(FIELDS.workdir, workdir, true),
    rawTimeout === undefined ? row(FIELDS.timeoutDefault, timeout) : row(FIELDS.timeout, timeout),
  ])
  return vmFrom(
    rows,
    oneLine(command ?? description ?? ""),
    command === undefined ? undefined : { text: command, maxLines: 12 },
  )
}

// ── read ─────────────────────────────────────────────────────────────────────

export function extractRead(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const path = pickStr(obj, ["path", "file_path", "filePath", "file"])
  const offset = pickNum(obj, ["offset", "from", "startLine", "start_line"])
  const limit = pickNum(obj, ["limit", "maxLines", "max_lines", "lines"])
  if (path === undefined && offset === undefined && limit === undefined) return emptyVm()
  const rows = rowsOf([
    row(FIELDS.path, path, true),
    offset === undefined ? undefined : row(FIELDS.offset, offset),
    limit === undefined ? undefined : row(FIELDS.limit, limit),
  ])
  // Effective 1-based window the tool will actually read (read.ts slices
  // lines.slice(offset, offset + limit) and reports startLine = offset + 1).
  if (path !== undefined && (offset !== undefined || limit !== undefined)) {
    const start = (offset ?? 0) + 1
    const range = limit === undefined ? `${start}-` : `${start}-${start + limit - 1}`
    rows.push(row(FIELDS.range, range, true)!)
  }
  return vmFrom(rows, oneLine(path ?? ""))
}

// ── glob ─────────────────────────────────────────────────────────────────────

export function extractGlob(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const pattern = pickStr(obj, ["pattern", "glob"])
  const path = pickStr(obj, ["path", "dir", "cwd", "base"])
  const rawLimit = pickNum(obj, ["limit", "max", "maxResults"])
  if (pattern === undefined && path === undefined && rawLimit === undefined) return emptyVm()
  const rows = rowsOf([
    row(FIELDS.pattern, pattern, true),
    row(FIELDS.path, path, true),
    rawLimit === undefined
      ? pattern === undefined
        ? undefined
        : row(FIELDS.limitDefault, SEARCH_LIMIT_DEFAULT)
      : row(FIELDS.limit, rawLimit),
  ])
  return vmFrom(rows, oneLine(pattern ?? path ?? ""))
}

// ── grep ─────────────────────────────────────────────────────────────────────

export function extractGrep(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const pattern = pickStr(obj, ["pattern", "regex", "query"])
  const path = pickStr(obj, ["path", "dir", "cwd", "base"])
  const include = pickStr(obj, ["include", "glob", "filter", "filePattern"])
  const rawLimit = pickNum(obj, ["limit", "max", "maxResults"])
  if (
    pattern === undefined &&
    path === undefined &&
    include === undefined &&
    rawLimit === undefined
  ) {
    return emptyVm()
  }
  const rows = rowsOf([
    row(FIELDS.pattern, pattern, true),
    row(FIELDS.path, path, true),
    row(FIELDS.include, include, true),
    rawLimit === undefined
      ? pattern === undefined
        ? undefined
        : row(FIELDS.limitDefault, SEARCH_LIMIT_DEFAULT)
      : row(FIELDS.limit, rawLimit),
  ])
  return vmFrom(rows, oneLine(pattern ?? path ?? ""))
}

// ── permission ───────────────────────────────────────────────────────────────

export function extractPermission(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const tool = pickStr(obj, ["tool", "toolName"])
  const target = pickStr(obj, ["target", "path", "command"])
  const requestId = pickStr(obj, ["requestId", "request_id", "id"])
  // PermissionRequestInput.pattern — the explicit "always" rule pattern.
  const alwaysPattern = pickStr(obj, ["pattern"])
  const timeoutMs = pickNum(obj, ["timeoutMs", "timeout_ms", "timeout"])
  if (
    tool === undefined &&
    target === undefined &&
    requestId === undefined &&
    timeoutMs === undefined
  ) {
    return emptyVm()
  }
  const rows = rowsOf([
    row(FIELDS.tool, tool, true),
    row(FIELDS.target, target, true),
    row(FIELDS.id, requestId, true),
    row(FIELDS.pattern, alwaysPattern, true),
    timeoutMs === undefined ? undefined : row(FIELDS.timeout, timeoutMs),
  ])
  return vmFrom(rows, oneLine(tool === undefined ? (target ?? "") : `${tool} ${target ?? ""}`))
}

// ── lsp ──────────────────────────────────────────────────────────────────────

export function extractLsp(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const method = pickStr(obj, ["method", "op", "operation", "action"])
  const uri = pickStr(obj, ["uri", "fileUri", "file_uri", "path", "file"])
  const languageId = pickStr(obj, ["languageId", "language_id", "language", "lang"])
  const content = pickStr(obj, ["content", "text", "source"])
  if (method === undefined && uri === undefined && languageId === undefined) return emptyVm()
  const rows = rowsOf([
    row(FIELDS.mode, method, true),
    row(FIELDS.uri, uri, true),
    row(FIELDS.language, languageId, true),
    content === undefined ? undefined : row(FIELDS.bytes, utf8Length(content)),
  ])
  return vmFrom(
    rows,
    oneLine(method ?? uri ?? ""),
    content === undefined ? undefined : { text: content, maxLines: 8 },
  )
}

// ── registry summarization ───────────────────────────────────────────────────

/**
 * Collapsed-line headline for the core tools (registry summarize). Mirrors
 * the schema: bash leads with the command, read/write/edit with the path,
 * glob/grep with the pattern, permission with "tool target", lsp with the
 * method. Returns undefined when the tool is not core.
 */
export function coreHeadline(tool: string, input: unknown): string | undefined {
  const vm = ((): ToolViewModel | undefined => {
    switch (tool) {
      case "bash":
        return extractBash(input)
      case "read":
        return extractRead(input)
      case "glob":
        return extractGlob(input)
      case "grep":
        return extractGrep(input)
      case "permission":
        return extractPermission(input)
      case "lsp":
        return extractLsp(input)
      default:
        return undefined
    }
  })()
  if (vm === undefined || vm.isEmpty) return undefined
  return vm.headline
}

/** Generic key/value rows for the core tools (registry DefaultBody path). */
export function coreInputRows(
  tool: string,
  input: unknown,
): Array<{ label: string; value: string; mono?: boolean }> {
  const vm = ((): ToolViewModel | undefined => {
    switch (tool) {
      case "bash":
        return extractBash(input)
      case "read":
        return extractRead(input)
      case "glob":
        return extractGlob(input)
      case "grep":
        return extractGrep(input)
      case "permission":
        return extractPermission(input)
      case "lsp":
        return extractLsp(input)
      default:
        return undefined
    }
  })()
  if (vm === undefined) return []
  return vm.rows.map((r) => ({
    label: r.labelKey.replace("toolRenderers.fields.", ""),
    value: r.value,
    mono: r.mono,
  }))
}

/** Whether `tool` is one of the six core tools with a dedicated body. */
export function isCoreTool(tool: string): boolean {
  return ["bash", "read", "glob", "grep", "permission", "lsp"].includes(tool)
}

/** replaceAll visibility helper shared with the edit renderer. */
export function showReplaceAll(input: unknown): boolean | undefined {
  return pickBool(asRecord(input), ["replaceAll", "replace_all", "all"])
}
