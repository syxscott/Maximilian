// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Web-surface tool model layer: webfetch, search, mcp. Inputs are the
 * passthrough `input` of the runtime tool-start event — every extractor is
 * defensive and falls back to an empty view model (→ generic JSON preview
 * in the body). webfetch additionally derives the URL host (useful when
 * long URLs truncate on the collapsed line); search shows the scoped
 * domain allow/deny lists the real WebSearch call carries.
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

/** Host of a URL-ish string ("https://a.b/c" → "a.b"), undefined if none. */
export function urlHost(url: string): string | undefined {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]+)/i.exec(url.trim())
  return m?.[1]
}

function domainList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const domains = value.filter((d): d is string => typeof d === "string" && d.length > 0)
  return domains.length === 0 ? undefined : domains.join(", ")
}

export function extractWebfetch(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const url = pickStr(obj, ["url", "href", "uri", "target"])
  const prompt = pickStr(obj, ["prompt", "question", "query"])
  if (url === undefined && prompt === undefined) return emptyVm()
  const host = url === undefined ? undefined : urlHost(url)
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.url, url, true),
    host === undefined ? undefined : row(FIELDS.host, host, true),
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
  const allowed = domainList(obj["allowedDomains"] ?? obj["allowed_domains"] ?? obj["domains"])
  const blocked = domainList(obj["blockedDomains"] ?? obj["blocked_domains"])
  const base = pickStr(obj, ["path", "base", "glob"])
  if (query === undefined && allowed === undefined && blocked === undefined && base === undefined) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.query, query, true),
    row(FIELDS.allowedDomains, allowed, true),
    row(FIELDS.blockedDomains, blocked, true),
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
  if (server === undefined && tool === undefined && args === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.server, server, true),
    row(FIELDS.tool, tool, true),
    args === undefined ? undefined : row(FIELDS.args, jsonPreview(args, 240), true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(server !== undefined ? `${server} ${tool ?? ""}` : (tool ?? "")),
  )
}
