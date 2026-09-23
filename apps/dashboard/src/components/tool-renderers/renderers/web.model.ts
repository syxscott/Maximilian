// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Web-surface tool model layer: webfetch, search, mcp. Inputs are
 * passthrough JSON — every extractor is defensive and falls back to an
 * empty view model (→ generic JSON preview in the body).
 */

import {
  FIELDS,
  asRecord,
  emptyVm,
  jsonPreview,
  oneLine,
  pickStr,
  row,
  vmFrom,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"

export function extractWebfetch(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const url = pickStr(obj, ["url", "href", "uri", "target"])
  const prompt = pickStr(obj, ["prompt", "question", "query"])
  if (!url && !prompt) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.url, url, true),
    row(FIELDS.prompt, prompt),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(url ?? prompt ?? ""),
  )
}

export function extractSearch(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const query = pickStr(obj, ["query", "pattern", "q", "search", "term"])
  const base = pickStr(obj, ["path", "base", "allowedDomains", "domain", "glob"])
  if (!query && !base) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.query, query, true),
    row(FIELDS.path, base, true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(query ?? base ?? ""),
  )
}

export function extractMcp(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const server = pickStr(obj, ["server", "serverId", "mcpServer", "provider"])
  const tool = pickStr(obj, ["tool", "toolName", "method", "action"])
  const args = obj["args"] ?? obj["arguments"] ?? obj["params"]
  if (!server && !tool && args === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.server, server, true),
    row(FIELDS.tool, tool, true),
    args === undefined ? undefined : row(FIELDS.args, jsonPreview(args, 240), true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(server ? `${server} ${tool ?? ""}` : (tool ?? "")),
  )
}
