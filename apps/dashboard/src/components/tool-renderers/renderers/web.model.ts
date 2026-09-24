// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Web-surface tool model layer: webfetch, search, mcp. Inputs are the
 * passthrough `input` of the runtime tool-start event (tool-integration.ts
 * ToolCall.input) — every extractor is defensive and falls back to an empty
 * view model (→ generic JSON preview in the body). The candidate keys track
 * what the real events carry:
 *
 *   webfetch → { url, method?, selector?, prompt?, excerpt? } — the fetch
 *              target with its HTTP method, an optional extraction selector
 *              and a short result summary; the host is derived from the URL
 *              (useful when long URLs truncate on the collapsed line).
 *   search   → { query, allowedDomains?, blockedDomains?, results? } — the
 *              scoped domain lists plus the hit list, of which the body
 *              shows the count and the first three titles.
 *   mcp      → { server, tool, args }.
 */

import {
  FIELDS,
  asRecord,
  emptyVm,
  jsonPreview,
  oneLine,
  pickArray,
  pickNum,
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
  const prompt = pickStr(obj, ["prompt", "question", "query", "instruction"])
  const method = pickStr(obj, ["method", "httpMethod", "http_method"])
  const selector = pickStr(obj, [
    "selector",
    "extract",
    "extractSelector",
    "extract_selector",
    "cssSelector",
    "xpath",
  ])
  const excerpt = pickStr(obj, ["excerpt", "result", "summary", "snippet"])
  if (
    url === undefined &&
    prompt === undefined &&
    method === undefined &&
    selector === undefined &&
    excerpt === undefined
  ) {
    return emptyVm()
  }
  const host = url === undefined ? undefined : urlHost(url)
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.url, url, true),
    host === undefined ? undefined : row(FIELDS.host, host, true),
    row(FIELDS.method, method, true),
    row(FIELDS.selector, selector, true),
    row(FIELDS.prompt, prompt),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(url ?? prompt ?? ""),
    excerpt === undefined ? undefined : { text: oneLine(excerpt, 400), maxLines: 6 },
  )
}

/** One search hit normalized to a display title. */
export interface SearchResult {
  title: string
}

export interface SearchViewModel extends ToolViewModel {
  /** Hit count (explicit count field or results length). */
  resultCount?: number
  /** Titles of the first hits, in order. */
  topResults: SearchResult[]
}

const SEARCH_TOP_N = 3

function normalizeHit(raw: unknown): SearchResult | undefined {
  if (typeof raw === "string") return raw.length > 0 ? { title: raw } : undefined
  const item = asRecord(raw)
  const title = pickStr(item, ["title", "name", "headline", "url", "text", "snippet"])
  return title === undefined ? undefined : { title }
}

export function extractSearch(input: unknown): SearchViewModel {
  const obj = asRecord(input)
  const query = pickStr(obj, ["query", "pattern", "q", "search", "term"])
  const allowed = domainList(obj["allowedDomains"] ?? obj["allowed_domains"] ?? obj["domains"])
  const blocked = domainList(obj["blockedDomains"] ?? obj["blocked_domains"])
  const base = pickStr(obj, ["path", "base", "glob"])
  const hits = pickArray(obj, ["results", "hits", "items", "matches"])
  const explicitCount = pickNum(obj, ["resultCount", "result_count", "total", "numResults"])
  const topResults =
    hits === undefined
      ? []
      : hits
          .map(normalizeHit)
          .filter((h): h is SearchResult => h !== undefined)
          .slice(0, SEARCH_TOP_N)
  const resultCount = explicitCount ?? (hits === undefined ? undefined : hits.length)
  if (
    query === undefined &&
    allowed === undefined &&
    blocked === undefined &&
    base === undefined &&
    resultCount === undefined
  ) {
    return { ...emptyVm(), topResults: [] }
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.query, query, true),
    row(FIELDS.allowedDomains, allowed, true),
    row(FIELDS.blockedDomains, blocked, true),
    row(FIELDS.path, base, true),
    resultCount === undefined ? undefined : row(FIELDS.results, resultCount),
  ]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      oneLine(query ?? base ?? ""),
      topResults.length === 0
        ? undefined
        : {
            text: topResults.map((h, i) => `${i + 1}. ${oneLine(h.title, 120)}`).join("\n"),
            maxLines: SEARCH_TOP_N,
          },
    ),
    ...(resultCount === undefined ? {} : { resultCount }),
    topResults,
  }
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
