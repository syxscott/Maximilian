// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Model layer for the ai-elements message-part library (ZCode ai-elements
 * borrowing). Every widget ships its extraction logic here as a pure,
 * defensively-coercing function: assistant message parts arrive as
 * passthrough JSON (fields may be missing, mis-typed or hostile), so the
 * components stay dumb renderers and the coercion rules stay testable.
 *
 * No React, no fetch, no locale — model functions return structured data;
 * the caller renders it through t() / formatters.
 */

// ── Shared defensive coercers ───────────────────────────────────────────────

/** Coerce an unknown value to a bounded string, or undefined. */
export function asString(v: unknown, max = 200): string | undefined {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined
}

/** Coerce an unknown value to a finite number, or undefined. */
export function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

// ── CodeBlock ───────────────────────────────────────────────────────────────

/** Lines above which a code block collapses by default. */
export const CODE_COLLAPSE_LINES = 24

export interface CodeBlockModel {
  code: string
  language?: string
}

/** Extract code + optional language tag from a passthrough message part. */
export function codeBlockModel(input: unknown): CodeBlockModel {
  if (typeof input === "string") return { code: input }
  if (input !== null && typeof input === "object") {
    const o = input as Record<string, unknown>
    const code = asString(o.code, 200_000) ?? asString(o.content, 200_000) ?? ""
    return { code, language: asString(o.language, 32) ?? asString(o.lang, 32) }
  }
  return { code: "" }
}

/** Number of lines a code string spans (empty string counts as one). */
export function codeLineCount(code: string): number {
  if (code === "") return 1
  return code.split("\n").length
}

/** Whether the block should render collapsed under the given threshold. */
export function codeShouldCollapse(code: string, threshold = CODE_COLLAPSE_LINES): boolean {
  return codeLineCount(code) > threshold
}

export interface VisibleCode {
  /** First `maxLines` lines, joined back with newlines. */
  text: string
  /** How many lines were hidden, 0 when nothing was truncated. */
  hiddenCount: number
}

/** Head-truncate code to `maxLines` lines for the collapsed view. */
export function visibleCodeLines(code: string, maxLines = CODE_COLLAPSE_LINES): VisibleCode {
  const lines = code.split("\n")
  if (lines.length <= maxLines) return { text: code, hiddenCount: 0 }
  return { text: lines.slice(0, maxLines).join("\n"), hiddenCount: lines.length - maxLines }
}

/** Clipboard availability — the copy button degrades to hidden without it. */
export function canUseClipboard(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard !== "undefined" &&
    typeof navigator.clipboard.writeText === "function"
  )
}

/**
 * Clipboard write — isolated in the model layer so components stay
 * testable; the component hides the button when the write is refused.
 */
export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

// ── ReasoningBlock ──────────────────────────────────────────────────────────

export interface ReasoningModel {
  text: string
  /** Non-whitespace character count ("字数"). */
  chars: number
  durationMs?: number
}

/** Extract thinking text + stats from a passthrough reasoning part. */
export function reasoningModel(input: unknown): ReasoningModel {
  let text = ""
  let durationMs: number | undefined
  if (typeof input === "string") {
    text = input
  } else if (input !== null && typeof input === "object") {
    const o = input as Record<string, unknown>
    text =
      asString(o.text, 100_000) ??
      asString(o.thinking, 100_000) ??
      asString(o.content, 100_000) ??
      ""
    durationMs = asNumber(o.durationMs) ?? asNumber(o.elapsedMs) ?? asNumber(o.duration)
  }
  const chars = text.replace(/\s/g, "").length
  return { text, chars, durationMs }
}

// ── AttachmentCard ──────────────────────────────────────────────────────────

export type AttachmentVariant =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "code"
  | "archive"
  | "spreadsheet"
  | "json"
  | "text"
  | "file"

export interface AttachmentModel {
  name: string
  sizeBytes?: number
  mime?: string
  variant: AttachmentVariant
}

const EXT_VARIANTS: Array<[RegExp, AttachmentVariant]> = [
  [/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i, "image"],
  [/\.(mp3|wav|ogg|flac|m4a)$/i, "audio"],
  [/\.(mp4|mov|webm|avi|mkv)$/i, "video"],
  [/\.pdf$/i, "pdf"],
  [
    /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|sh|bash|zsh|sql|html?|css|scss|vue|svelte|swift|php|lua|r|jl|ex|exs|dart|toml|yaml|yml)$/i,
    "code",
  ],
  [/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i, "archive"],
  [/\.(csv|tsv|xlsx?|ods)$/i, "spreadsheet"],
  [/\.json$/i, "json"],
  [/\.(txt|md|markdown|rst|log)$/i, "text"],
]

/**
 * Map a mime type (with filename fallback) to a display variant. Unknown
 * inputs degrade to "file" — the component picks the icon per variant.
 */
export function mimeToVariant(mime?: string, name?: string): AttachmentVariant {
  const m = asString(mime, 128)?.toLowerCase()
  if (m) {
    if (m.startsWith("image/")) return "image"
    if (m.startsWith("audio/")) return "audio"
    if (m.startsWith("video/")) return "video"
    if (m === "application/pdf") return "pdf"
    if (m === "application/json" || m.endsWith("+json")) return "json"
    if (
      /^(text\/x-|text\/(?:javascript|typescript)|application\/(?:x-)?(?:javascript|typescript|python|sh|bash))/.test(
        m,
      )
    )
      return "code"
    if (
      /^(application|x-font)\/(zip|gzip|x-tar|x-7z|x-rar|vnd\.rar)/.test(m) ||
      m === "application/gzip"
    )
      return "archive"
    if (
      /^(text\/csv|application\/vnd\.(ms-excel|openxmlformats-officedocument\.spreadsheet))/.test(
        m,
      ) ||
      m === "text/tab-separated-values"
    )
      return "spreadsheet"
    if (m.startsWith("text/")) return "text"
  }
  const n = asString(name, 256)
  if (n) {
    for (const [re, variant] of EXT_VARIANTS) {
      if (re.test(n)) return variant
    }
  }
  return "file"
}

/** Last path segment — attachments may carry a full path as their name. */
export function basenameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return idx === -1 ? path : path.slice(idx + 1)
}

/** Extract a displayable attachment from a passthrough payload. */
export function attachmentModel(input: unknown): AttachmentModel {
  const o = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const rawName =
    asString(o.name, 256) ??
    asString(o.filename, 256) ??
    asString(o.path, 256) ??
    asString(input, 256) ??
    ""
  const name = basenameOf(rawName) || "file"
  const mime =
    asString(o.mime, 128) ??
    asString(o.mimeType, 128) ??
    asString(o.type, 128) ??
    asString(o.contentType, 128)
  const sizeBytes = asNumber(o.sizeBytes) ?? asNumber(o.size) ?? asNumber(o.bytes)
  return { name, sizeBytes, mime: mime ?? undefined, variant: mimeToVariant(mime, name) }
}

// ── CitationBlock ───────────────────────────────────────────────────────────

export interface CitationModel {
  index: number
  title: string
  url?: string
}

/** Extract a citation (ordinal + source title + optional URL). */
export function citationModel(input: unknown): CitationModel {
  const o = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const index = asNumber(o.index) ?? asNumber(o.n) ?? asNumber(o.num) ?? 0
  const title = asString(o.title, 200) ?? asString(o.source, 200) ?? asString(o.url, 200) ?? ""
  let url = asString(o.url, 2048) ?? asString(o.href, 2048) ?? asString(o.link, 2048)
  // Only http(s) is a safe external link; anything else renders as plain text.
  if (url && !/^https?:\/\//i.test(url)) url = undefined
  return { index: Math.max(0, Math.floor(index)), title, url }
}

// ── KeyValueCard ────────────────────────────────────────────────────────────

export interface KeyValueEntry {
  key: string
  value: string
}

const VALUE_MAX = 160

const stringifyValue = (value: unknown): string => {
  if (value === null) return "null"
  if (typeof value === "string") return value.slice(0, VALUE_MAX)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value).slice(0, VALUE_MAX)
  } catch {
    return ""
  }
}

/** Flatten a passthrough metadata object into display entries. */
export function keyValueEntries(input: unknown): KeyValueEntry[] {
  if (input === null || typeof input !== "object") return []
  if (Array.isArray(input)) return input.flatMap((item) => keyValueEntries(item))
  const o = input as Record<string, unknown>
  // { key, value } shaped items map directly instead of being re-flattened.
  const key = asString(o.key, 120)
  if (key !== undefined && "value" in o) return [{ key, value: stringifyValue(o.value) }]
  return Object.entries(o).flatMap(([k, value]): KeyValueEntry[] => {
    if (value === undefined) return []
    return [{ key: k, value: stringifyValue(value) }]
  })
}

// ── ImagePreviewBlock ───────────────────────────────────────────────────────

export interface ImageSrcModel {
  src?: string
  isDataUrl: boolean
}

/** Resolve a displayable image source — data URL or http(s) URL only. */
export function imageSrcModel(input: unknown): ImageSrcModel {
  const raw =
    typeof input === "string"
      ? input
      : input !== null && typeof input === "object"
        ? (asString((input as Record<string, unknown>).src, 2_000_000) ??
          asString((input as Record<string, unknown>).url, 2_000_000) ??
          asString((input as Record<string, unknown>).data, 2_000_000))
        : undefined
  const src = raw && (raw.startsWith("data:image/") || /^https?:\/\//i.test(raw)) ? raw : undefined
  return { src, isDataUrl: src?.startsWith("data:image/") ?? false }
}

// ── ErrorBlock ──────────────────────────────────────────────────────────────

export interface ErrorModel {
  name?: string
  message: string
  stack?: string
}

/** Normalize an Error instance / error-shaped object / string. */
export function errorModel(input: unknown): ErrorModel {
  if (input instanceof Error) {
    return { name: input.name, message: input.message, stack: input.stack }
  }
  if (typeof input === "string") return { message: input }
  const o = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {}
  return {
    name: asString(o.name, 120),
    message:
      asString(o.message, 2_000) ?? asString(o.error, 2_000) ?? asString(o.reason, 2_000) ?? "",
    stack: asString(o.stack, 20_000),
  }
}

// ── TokenUsageBadge ─────────────────────────────────────────────────────────

export interface TokenUsageModel {
  input: number
  output: number
  cacheRead: number
  total: number
  /** At least one of the fields was present and numeric. */
  known: boolean
}

/** Extract a token usage triple from a passthrough usage object. */
export function tokenUsageModel(input: unknown): TokenUsageModel {
  const o = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const input_ = asNumber(o.input) ?? asNumber(o.inputTokens) ?? asNumber(o.promptTokens) ?? 0
  const output = asNumber(o.output) ?? asNumber(o.outputTokens) ?? asNumber(o.completionTokens) ?? 0
  const cacheRead =
    asNumber(o.cacheRead) ??
    asNumber(o.cacheReadTokens) ??
    asNumber(o.cacheTokens) ??
    asNumber(o.cached) ??
    0
  const explicitTotal = asNumber(o.total) ?? asNumber(o.totalTokens)
  const known = [
    o.input,
    o.inputTokens,
    o.promptTokens,
    o.output,
    o.outputTokens,
    o.completionTokens,
    o.cacheRead,
    o.cacheReadTokens,
    o.cacheTokens,
    o.cached,
    o.total,
    o.totalTokens,
  ].some((v) => typeof v === "number" && Number.isFinite(v))
  return {
    input: input_,
    output,
    cacheRead,
    total: explicitTotal ?? input_ + output + cacheRead,
    known,
  }
}

// ── LatencyMeter ────────────────────────────────────────────────────────────

export type LatencyRating = "fast" | "moderate" | "slow"

/** ms → rating: green < 1s, yellow < 5s, red otherwise. */
export function latencyRating(ms: number): LatencyRating {
  if (!Number.isFinite(ms) || ms < 1_000) return "fast"
  if (ms < 5_000) return "moderate"
  return "slow"
}

/** Bar fill percentage, on a 0–10s scale capped at 100. */
export function latencyBarPercent(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.min(100, (ms / 10_000) * 100)
}

// ── StatusPill ──────────────────────────────────────────────────────────────

export type PillVariant = "pending" | "running" | "completed" | "failed" | "skipped"

const PILL_ALIASES: Record<string, PillVariant> = {
  pending: "pending",
  queued: "pending",
  waiting: "pending",
  planned: "pending",
  running: "running",
  in_progress: "running",
  inprogress: "running",
  active: "running",
  started: "running",
  completed: "completed",
  complete: "completed",
  done: "completed",
  success: "completed",
  succeeded: "completed",
  ok: "completed",
  failed: "failed",
  failure: "failed",
  error: "failed",
  skipped: "skipped",
  skip: "skipped",
  cancelled: "skipped",
  canceled: "skipped",
}

/** Canonicalize a passthrough status string to a pill variant. */
export function statusVariant(status: unknown): PillVariant {
  const s = asString(status, 40)?.toLowerCase().trim()
  if (!s) return "pending"
  return PILL_ALIASES[s] ?? "pending"
}

// ── DocumentPreviewBlock ────────────────────────────────────────────────────

export interface DocumentPreviewModel {
  text: string
  totalLines: number
  /** Lines hidden by truncation, 0 when the document fits. */
  hiddenLines: number
  truncated: boolean
}

/** Line-truncate a plain-text document for preview. */
export function documentPreviewModel(input: unknown, visibleLines = 40): DocumentPreviewModel {
  const text = typeof input === "string" ? input : (asString(input, 500_000) ?? "")
  const lines = text === "" ? [] : text.split("\n")
  if (lines.length <= visibleLines)
    return { text, totalLines: lines.length, hiddenLines: 0, truncated: false }
  return {
    text: lines.slice(0, visibleLines).join("\n"),
    totalLines: lines.length,
    hiddenLines: lines.length - visibleLines,
    truncated: true,
  }
}

// ── MarkdownProseBlock ──────────────────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

/**
 * Escape HTML-sensitive characters FIRST — every tag the renderer adds on
 * top is therefore trusted markup, and anything the input contained can
 * only appear as text (XSS-safe by construction).
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch)
}

/** Inline pass (runs on already-escaped text): code spans, then bold. */
function renderInline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
}

/**
 * Extremely small markdown → safe HTML renderer (no dependencies).
 * Supports: # headings, unordered / ordered lists (grouped), **bold**,
 * `code spans`, paragraphs. Everything else becomes a paragraph.
 * Returns an HTML string safe to inject via dangerouslySetInnerHTML
 * because the input is escaped before any tag is produced.
 */
export function markdownToSafeHtml(input: unknown): string {
  const raw = typeof input === "string" ? input : ""
  if (raw.trim() === "") return ""
  const lines = raw.replace(/\r\n?/g, "\n").split("\n")
  const out: string[] = []
  let listType: "ul" | "ol" | null = null
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
    }
  }
  for (const line of lines) {
    const text = escapeHtml(line)
    const heading = /^(#{1,6})\s+(.*)$/.exec(text)
    const ul = /^\s*[-*]\s+(.*)$/.exec(text)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(text)
    if (heading) {
      closeList()
      const level = Math.min(6, heading[1].length + 2)
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
    } else if (ul) {
      if (listType !== "ul") {
        closeList()
        out.push("<ul>")
        listType = "ul"
      }
      out.push(`<li>${renderInline(ul[1])}</li>`)
    } else if (ol) {
      if (listType !== "ol") {
        closeList()
        out.push("<ol>")
        listType = "ol"
      }
      out.push(`<li>${renderInline(ol[1])}</li>`)
    } else if (text.trim() === "") {
      closeList()
    } else {
      closeList()
      out.push(`<p>${renderInline(text)}</p>`)
    }
  }
  closeList()
  return out.join("")
}

// ── Shared private narrowers (batch 2) ──────────────────────────────────────

/** Narrow unknown to a plain-object record (arrays excluded), or {}. */
function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

/** Read an array field of a passthrough part (the input itself if it is one). */
function arrayOf(input: unknown, key: string): unknown[] {
  if (Array.isArray(input)) return input
  const v = asRecord(input)[key]
  return Array.isArray(v) ? v : []
}

/** Coerce an unknown array to bounded finite numbers. */
function coerceNumbers(values: unknown, max: number): number[] {
  return (Array.isArray(values) ? values : [])
    .slice(0, max)
    .map((v) => asNumber(v))
    .filter((v): v is number => v !== undefined)
}

/** http(s) URL or undefined — never returns javascript:/data: link targets. */
function httpUrl(v: unknown): string | undefined {
  const s = asString(v, 2048)
  return s && /^https?:\/\//i.test(s) ? s : undefined
}

/** Hostname of a URL with a regex fallback (URL throws on hostile input). */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? ""
  }
}

// ── ToolResultBlock ─────────────────────────────────────────────────────────

export interface ToolResultModel {
  tool: string
  ok: boolean
  status: PillVariant
  durationMs?: number
  content: string
}

/**
 * Extract a tool execution result: tool name, success flag, canonical
 * status, duration and output text. `ok` wins over `status`; an `error`
 * string implies failure; nothing known defaults to a completed result.
 */
export function toolResultModel(input: unknown): ToolResultModel {
  if (typeof input === "string") {
    return { tool: "", ok: true, status: "completed", durationMs: undefined, content: input }
  }
  const o = asRecord(input)
  const flag = o.ok ?? o.success ?? o.successful
  const hasFlag = typeof flag === "boolean"
  const status = statusVariant(o.status)
  const hasStatus = o.status !== undefined
  const errorText = asString(o.error, 2_000)
  const ok = hasFlag ? flag : errorText !== undefined ? false : !hasStatus || status !== "failed"
  return {
    tool: asString(o.tool, 120) ?? asString(o.name, 120) ?? "",
    ok,
    status: ok ? (hasStatus && status !== "failed" ? status : "completed") : "failed",
    durationMs: asNumber(o.durationMs) ?? asNumber(o.duration) ?? asNumber(o.elapsedMs),
    content:
      asString(o.content, 100_000) ??
      asString(o.output, 100_000) ??
      asString(o.result, 100_000) ??
      errorText ??
      "",
  }
}

// ── PlanStepList ────────────────────────────────────────────────────────────

export interface PlanStep {
  title: string
  status: PillVariant
  /** Dependency nesting level (0 = root) used as the row indent. */
  depth: number
}

interface PlanStepInput {
  title: string
  status: PillVariant
  deps: string[]
}

/** "a" / ["a", "b"] / undefined → normalized dependency id list. */
function depsOf(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : v === undefined ? [] : [v]
  return raw.flatMap((item) => {
    const s = asString(item, 120)?.trim()
    return s ? [s] : []
  })
}

/**
 * Extract plan steps and resolve each step's indent depth from its
 * `dependsOn` chain. Dependency cycles degrade to depth 0 instead of
 * hanging the renderer.
 */
export function planStepListModel(input: unknown, maxSteps = 50): PlanStep[] {
  const rawSteps = arrayOf(input, "steps").slice(0, maxSteps)
  const steps: PlanStepInput[] = rawSteps.map((item, i) => {
    const o = asRecord(item)
    return {
      title:
        asString(o.title, 200) ??
        asString(o.label, 200) ??
        asString(o.text, 200) ??
        asString(item, 200) ??
        `#${i + 1}`,
      status: statusVariant(o.status),
      deps: depsOf(o.dependsOn ?? o.deps ?? o.dependencies),
    }
  })
  // Steps without an explicit id are addressable as "#n" (1-based).
  const indexOfId = new Map(
    rawSteps.map((item, i) => [asString(asRecord(item).id, 120) ?? `#${i + 1}`, i]),
  )

  const depths = new Array<number>(steps.length).fill(-1)
  const visiting = new Set<number>()
  const walk = (i: number): number => {
    const cached = depths[i]
    if (cached >= 0) return cached
    if (visiting.has(i)) return -1
    visiting.add(i)
    let depth = 0
    for (const dep of steps[i]?.deps ?? []) {
      const j = indexOfId.get(dep)
      if (j !== undefined && j !== i) depth = Math.max(depth, walk(j) + 1)
    }
    visiting.delete(i)
    depths[i] = Math.max(0, depth)
    return depths[i] as number
  }
  return steps.map((s, i) => ({ title: s.title, status: s.status, depth: walk(i) }))
}

// ── TodoListBlock ───────────────────────────────────────────────────────────

export type TodoPriority = "high" | "medium" | "low"

export interface TodoItem {
  text: string
  completed: boolean
  priority: TodoPriority
}

function todoPriority(v: unknown): TodoPriority {
  const s = asString(v, 24)?.toLowerCase().trim()
  if (s) {
    if (/^(p[01]|high|urgent)/.test(s)) return "high"
    if (/^(p[3-9]|low)/.test(s)) return "low"
    if (/^(p2|medium|mid|normal)/.test(s)) return "medium"
  }
  const n = asNumber(v)
  if (n !== undefined) return n <= 1 ? "high" : n === 2 ? "medium" : "low"
  return "medium"
}

/** Extract todo items with checkbox state and normalized priority. */
export function todoListModel(input: unknown, maxItems = 100): TodoItem[] {
  const raw = arrayOf(input, "todos").length > 0 ? arrayOf(input, "todos") : arrayOf(input, "items")
  return raw.slice(0, maxItems).map((item) => {
    const o = asRecord(item)
    const done = o.completed ?? o.done ?? o.checked ?? o.isCompleted
    return {
      text:
        asString(o.text, 300) ??
        asString(o.content, 300) ??
        asString(o.title, 300) ??
        asString(item, 300) ??
        "",
      completed: typeof done === "boolean" ? done : statusVariant(o.status) === "completed",
      priority: todoPriority(o.priority),
    }
  })
}

// ── FileChangeCard ──────────────────────────────────────────────────────────

export interface FileChangeModel {
  path: string
  kind: "edit" | "write"
  added: number
  removed: number
  /** NUL byte seen in either side — skip the textual diff preview. */
  binary: boolean
  oldText: string
  newText: string
}

/** +/- line counts for an (old, new) text pair via common-affix trimming. */
function pairDiffStat(oldText: string, newText: string): { added: number; removed: number } {
  const oldLines = oldText === "" ? [] : oldText.split("\n")
  const newLines = newText === "" ? [] : newText.split("\n")
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start])
    start += 1
  let endOld = oldLines.length
  let endNew = newLines.length
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld -= 1
    endNew -= 1
  }
  return { added: endNew - start, removed: endOld - start }
}

/** Extract a file change card: path, +/- line stats and the raw pair. */
export function fileChangeModel(input: unknown): FileChangeModel {
  if (typeof input === "string") {
    return {
      path: asString(input, 1024) ?? "",
      kind: "write",
      added: 0,
      removed: 0,
      binary: false,
      oldText: "",
      newText: "",
    }
  }
  const o = asRecord(input)
  const oldText = asString(o.oldString, 500_000) ?? asString(o.oldText, 500_000) ?? ""
  const newText =
    asString(o.newString, 500_000) ??
    asString(o.newText, 500_000) ??
    asString(o.content, 500_000) ??
    ""
  const { added, removed } = pairDiffStat(oldText, newText)
  return {
    path:
      asString(o.path, 1024) ??
      asString(o.filePath, 1024) ??
      asString(o.file, 1024) ??
      asString(o.filename, 1024) ??
      "",
    kind: (o.oldString ?? o.oldText) !== undefined ? "edit" : "write",
    added,
    removed,
    binary: oldText.includes("\u0000") || newText.includes("\u0000"),
    oldText,
    newText,
  }
}

// ── TerminalOutputBlock ─────────────────────────────────────────────────────

export type TerminalTone = "plain" | "success" | "error" | "warn"

export interface TerminalLine {
  text: string
  tone: TerminalTone
}

const ANSI_CSI = /\u001B\[[0-9;]*[A-Za-z]/g

/** Strip ANSI CSI escape sequences (colors, cursor moves) from output. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_CSI, "")
}

function terminalTone(line: string): TerminalTone {
  const plain = stripAnsi(line)
  if (/\u001B\[3[12]m/.test(line)) return /\u001B\[32m/.test(line) ? "success" : "error"
  if (/\b(error|failed|failure|fatal)\b/i.test(plain) || /[✗✘×]/.test(plain)) return "error"
  if (/\b(warn|warning)\b/i.test(plain) || plain.includes("⚠")) return "warn"
  if (/\b(ok|success|succeeded|done|passed)\b/i.test(plain) || /[✓✔]/.test(plain)) return "success"
  return "plain"
}

/**
 * Split terminal output into tone-classified lines. ANSI colors (31 red /
 * 32 green) win over keyword sniffing; output is newline-normalized and
 * capped at `maxLines` rows.
 */
export function terminalLinesModel(input: unknown, maxLines = 200): TerminalLine[] {
  const o = asRecord(input)
  const text =
    typeof input === "string"
      ? input
      : (asString(o.output, 100_000) ??
        asString(o.text, 100_000) ??
        asString(o.content, 100_000) ??
        asString(o.stdout, 100_000) ??
        "")
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .slice(0, maxLines)
    .map((line) => ({ text: stripAnsi(line), tone: terminalTone(line) }))
}

// ── WebSearchBlock / LinkPreviewCard ────────────────────────────────────────

export interface WebSearchResult {
  title: string
  url?: string
  domain: string
  snippet?: string
}

export interface WebSearchModel {
  query: string
  results: WebSearchResult[]
  truncated: boolean
}

/** Extract a search result card: query, http(s)-only results, domains. */
export function webSearchModel(input: unknown, maxResults = 8): WebSearchModel {
  const o = asRecord(input)
  const raw = arrayOf(input, "results")
  return {
    query: asString(o.query, 300) ?? "",
    results: raw.slice(0, maxResults).map((item) => {
      const r = asRecord(item)
      const url = httpUrl(r.url) ?? httpUrl(r.link) ?? httpUrl(r.href)
      return {
        title: asString(r.title, 200) ?? asString(r.name, 200) ?? "",
        url,
        domain: url !== undefined ? hostnameOf(url) : (asString(r.domain, 120) ?? ""),
        snippet: asString(r.snippet, 400) ?? asString(r.description, 400),
      }
    }),
    truncated: raw.length > maxResults,
  }
}

export interface LinkPreviewModel {
  url?: string
  title: string
  description?: string
  domain: string
}

/** Extract a link preview card (favicon placeholder / title / URL). */
export function linkPreviewModel(input: unknown): LinkPreviewModel {
  const o = asRecord(input)
  const url = httpUrl(o.url) ?? httpUrl(o.href) ?? httpUrl(o.link) ?? httpUrl(input)
  return {
    url,
    title:
      asString(o.title, 200) ??
      (typeof input === "string" ? asString(input, 200) : undefined) ??
      "",
    description: asString(o.description, 500) ?? asString(o.desc, 500) ?? asString(o.snippet, 500),
    domain: url !== undefined ? hostnameOf(url) : "",
  }
}

// ── CommandBlock ────────────────────────────────────────────────────────────

export interface CommandBlockModel {
  command: string
  exitCode?: number
  /** undefined when no exit code is known (command still running). */
  ok?: boolean
}

/** Extract a command line card: command text + exit code verdict. */
export function commandBlockModel(input: unknown): CommandBlockModel {
  const o = asRecord(input)
  const exitCode =
    asNumber(o.exitCode) ?? asNumber(o.exit_code) ?? asNumber(o.code) ?? asNumber(o.status)
  return {
    command:
      asString(o.command, 2_000) ??
      asString(o.cmd, 2_000) ??
      asString(o.line, 2_000) ??
      (typeof input === "string" ? asString(input, 2_000) : undefined) ??
      "",
    exitCode,
    ok: exitCode === undefined ? undefined : exitCode === 0,
  }
}

// ── TableBlock ──────────────────────────────────────────────────────────────

export interface TableBlockModel {
  columns: string[]
  rows: string[][]
  totalRows: number
  truncated: boolean
}

/**
 * Normalize a passthrough table: object rows (columns derived from the
 * first row's keys), array rows plus an optional header list, or scalar
 * rows. Cells are stringified and bounded; rows capped at `maxRows`.
 */
export function tableBlockModel(input: unknown, maxRows = 10, maxColumns = 8): TableBlockModel {
  const o = asRecord(input)
  const raw = arrayOf(input, "rows").length > 0 ? arrayOf(input, "rows") : arrayOf(input, "data")
  const first = raw[0]
  const header = Array.isArray(o.columns) ? o.columns : Array.isArray(o.headers) ? o.headers : []
  let columns: string[]
  if (first !== null && typeof first === "object" && !Array.isArray(first)) {
    columns = Object.keys(first as Record<string, unknown>).slice(0, maxColumns)
  } else if (header.length > 0) {
    columns = header.slice(0, maxColumns).map((c, i) => asString(c, 80) ?? `col-${i + 1}`)
  } else {
    columns = []
  }
  const rows = raw.slice(0, maxRows).map((item): string[] => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const r = item as Record<string, unknown>
      return columns.map((c) => stringifyValue(r[c]))
    }
    if (Array.isArray(item)) return item.slice(0, maxColumns).map(stringifyValue)
    return [stringifyValue(item)]
  })
  if (columns.length === 0 && rows.length > 0) {
    columns = rows[0]?.map((_, i) => `col-${i + 1}`) ?? []
  }
  return { columns, rows, totalRows: raw.length, truncated: raw.length > maxRows }
}

// ── ProgressBlock / DonutStat / GaugeArc ────────────────────────────────────

export interface ProgressModel {
  /** Clamped 0–100. */
  value: number
  label?: string
}

/**
 * Coerce a passthrough progress to 0–100. `percent`/`pct` fields are taken
 * as-is; `value`/`progress` in 0..1 is treated as a fraction; everything is
 * clamped. Accepts a bare number or numeric string too.
 */
export function progressModel(input: unknown): ProgressModel {
  const o = asRecord(input)
  const raw =
    asNumber(o.percent) ??
    asNumber(o.pct) ??
    asNumber(o.value) ??
    asNumber(o.progress) ??
    (o.value === undefined && o.progress === undefined ? asNumber(input) : undefined)
  const isPercentField = o.percent !== undefined || o.pct !== undefined
  let value = 0
  if (raw !== undefined) {
    value = !isPercentField && raw >= 0 && raw <= 1 ? raw * 100 : Math.min(100, Math.max(0, raw))
  }
  return { value, label: asString(o.label, 120) ?? asString(o.text, 120) }
}

export interface DonutModel {
  ratio: number
  circumference: number
  /** stroke-dasharray for the value circle ("filled gap"). */
  dash: string
}

/** 0–1 ratio + stroke-dasharray pair for an SVG donut. */
export function donutModel(value: unknown, radius = 8): DonutModel {
  const ratio = progressModel(value).value / 100
  const circumference = 2 * Math.PI * radius
  const filled = ratio * circumference
  return {
    ratio,
    circumference,
    dash: `${filled.toFixed(2)} ${(circumference - filled).toFixed(2)}`,
  }
}

export interface GaugeModel {
  ratio: number
  /** Full 180° track arc (SVG path d). */
  trackPath: string
  /** Value arc from the left end; "" when the ratio is 0. */
  valuePath: string
}

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const a = polar(cx, cy, r, fromDeg)
  const b = polar(cx, cy, r, toDeg)
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

/** 0–1 gauge as a semicircular SVG arc pair (180° → 360°). */
export function gaugeArcModel(value: unknown, radius = 12): GaugeModel {
  const ratio = progressModel(value).value / 100
  const c = radius + 2
  return {
    ratio,
    trackPath: arcPath(c, c, radius, 180, 360),
    valuePath: ratio <= 0 ? "" : arcPath(c, c, radius, 180, 180 + 180 * ratio),
  }
}

// ── AlertBanner / QuoteBlock / DiffStat / Collapse ──────────────────────────

export type AlertVariant = "info" | "warn" | "error" | "success"

/** Canonicalize a passthrough alert level ("warning"→warn, "danger"→error…). */
export function alertVariant(input: unknown): AlertVariant {
  const s = asString(input, 40)?.toLowerCase().trim()
  if (!s) return "info"
  if (/^(warn|warning|caution|attention)/.test(s)) return "warn"
  if (/^(error|danger|critical|failure|failed)/.test(s)) return "error"
  if (/^(success|ok|done|completed)/.test(s)) return "success"
  return "info"
}

export interface QuoteModel {
  text: string
  source?: string
}

/** Extract a quotation with optional attribution. */
export function quoteModel(input: unknown): QuoteModel {
  if (typeof input === "string") return { text: input }
  const o = asRecord(input)
  return {
    text: asString(o.text, 4_000) ?? asString(o.quote, 4_000) ?? asString(o.content, 4_000) ?? "",
    source:
      asString(o.source, 200) ??
      asString(o.author, 200) ??
      asString(o.from, 200) ??
      asString(o.cite, 200),
  }
}

export interface DiffStat {
  added: number
  removed: number
  files: number
}

/** Count +/- lines and files in a unified diff text. */
export function diffStatFromUnified(diff: unknown): DiffStat {
  if (typeof diff !== "string") return { added: 0, removed: 0, files: 0 }
  let added = 0
  let removed = 0
  let files = 0
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git") || line.startsWith("Index: ")) files += 1
    else if (line.startsWith("+") && !line.startsWith("+++")) added += 1
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1
  }
  return { added, removed, files }
}

export interface CollapseModel {
  /** True when an `open` prop was passed (component skips local state). */
  isControlled: boolean
  /** Effective initial state for the uncontrolled variant. */
  initialOpen: boolean
}

/** Resolve controlled vs uncontrolled open state for a collapse container. */
export function collapseModel(open: unknown, defaultOpen: unknown): CollapseModel {
  const isControlled = typeof open === "boolean"
  return { isControlled, initialOpen: isControlled ? open : defaultOpen === true }
}

// ── Sparkline / BarMini / HeatRow ───────────────────────────────────────────

export interface SparklineModel {
  points: Array<{ x: number; y: number }>
  /** "x,y x,y …" polyline points string ("" when empty). */
  polyline: string
  min: number
  max: number
}

/**
 * Map a numeric series to an SVG polyline of `width`×`height` with a 3px
 * vertical pad. Non-numeric entries are dropped; the series is capped at
 * 240 samples.
 */
export function sparklineModel(values: unknown, width = 96, height = 24): SparklineModel {
  const nums = coerceNumbers(values, 240)
  if (nums.length === 0) return { points: [], polyline: "", min: 0, max: 0 }
  let min = nums[0] as number
  let max = nums[0] as number
  for (const n of nums) {
    if (n < min) min = n
    if (n > max) max = n
  }
  const span = max - min || 1
  const padY = 3
  const stepX = nums.length === 1 ? width : width / (nums.length - 1)
  const points = nums.map((n, i) => ({
    x: i * stepX,
    y: padY + (1 - (n - min) / span) * (height - padY * 2),
  }))
  return {
    points,
    polyline: points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" "),
    min,
    max,
  }
}

export interface BarMiniBar {
  x: number
  y: number
  width: number
  height: number
  value: number
}

export interface BarMiniModel {
  bars: BarMiniBar[]
  max: number
}

/** Map a numeric series to baseline-zero SVG bars (negatives clamp to 0). */
export function barMiniModel(values: unknown, width = 96, height = 24, gap = 1): BarMiniModel {
  const nums = coerceNumbers(values, 60)
  if (nums.length === 0) return { bars: [], max: 0 }
  let max = 0
  for (const n of nums) max = Math.max(max, n)
  const slot = width / nums.length
  const barWidth = Math.max(1, slot - gap)
  const bars = nums.map((n, i) => {
    // Round to 2 decimals: fraction math (1/3 * 30) leaves 9.999…-style
    // floats that would leak into the rendered geometry.
    const raw_h = max > 0 && n > 0 ? Math.max(1, (Math.min(n, max) / max) * height) : 0
    const h = Math.round(raw_h * 100) / 100
    return { x: i * slot, y: height - h, width: barWidth, height: h, value: n }
  })
  return { bars, max }
}

export interface HeatCell {
  value?: number
  /** 0 = empty, 1–4 = intensity ramp. */
  tier: 0 | 1 | 2 | 3 | 4
}

/**
 * Classify a row of values into 0–4 color tiers. Tiers are relative to the
 * row's own min/max; missing values map to tier 0 (empty cell).
 */
export function heatRowModel(values: unknown): HeatCell[] {
  const cells = (Array.isArray(values) ? values : [])
    .slice(0, 64)
    .map((v) => (v === null || v === undefined || v === "" ? undefined : asNumber(v)))
  const known = cells.filter((n): n is number => n !== undefined)
  if (known.length === 0) return cells.map(() => ({ tier: 0 as const, value: undefined }))
  let min = known[0] as number
  let max = known[0] as number
  for (const n of known) {
    min = Math.min(min, n)
    max = Math.max(max, n)
  }
  const span = max - min || 1
  return cells.map((n) => {
    if (n === undefined) return { tier: 0 as const, value: undefined }
    const tier = 1 + Math.min(3, Math.floor(((n - min) / span) * 4))
    return { tier: tier as 1 | 2 | 3 | 4, value: n }
  })
}

// ── TimelineMini / StatCard / DeltaBadge / CountUp ──────────────────────────

export type TimelineTone = "muted" | "accent" | "danger"

export interface TimelineItem {
  label: string
  time?: string
  tone: TimelineTone
}

/** Extract mini-timeline entries; status drives the dot tone. */
export function timelineMiniModel(input: unknown, maxItems = 20): TimelineItem[] {
  const raw =
    arrayOf(input, "items").length > 0 ? arrayOf(input, "items") : arrayOf(input, "events")
  return raw.slice(0, maxItems).map((item) => {
    const o = asRecord(item)
    const status = statusVariant(o.status)
    return {
      label:
        asString(o.label, 200) ??
        asString(o.title, 200) ??
        asString(o.text, 200) ??
        asString(item, 200) ??
        "",
      time: asString(o.time, 40) ?? asString(o.at, 40),
      tone: status === "completed" ? "accent" : status === "failed" ? "danger" : "muted",
    }
  })
}

export type TrendDirection = "up" | "down" | "flat"

export interface StatCardModel {
  label: string
  value: string
  direction: TrendDirection
  delta?: number
}

/** Extract a statistic card: label, display value and trend direction. */
export function statCardModel(input: unknown): StatCardModel {
  const o = asRecord(input)
  const label = asString(o.label, 120) ?? asString(o.name, 120) ?? asString(o.title, 120) ?? ""
  const numeric = asNumber(o.value)
  const value = asString(o.value, 60) ?? (numeric !== undefined ? String(numeric) : "")
  const delta = asNumber(o.delta) ?? asNumber(o.change) ?? asNumber(o.diff)
  const dir = asString(o.trend ?? o.direction, 20)
    ?.toLowerCase()
    .trim()
  let direction: TrendDirection
  if (dir !== undefined) {
    direction = /up|increase|rising/.test(dir)
      ? "up"
      : /down|decrease|falling/.test(dir)
        ? "down"
        : "flat"
  } else {
    direction = delta === undefined ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat"
  }
  return { label, value, direction, delta }
}

export interface DeltaBadgeModel {
  value: number
  direction: TrendDirection
  /** "+12" / "-3" / "0" — ready to render. */
  text: string
}

/** Normalize a delta to a signed badge value (non-numeric → 0). */
export function deltaBadgeModel(delta: unknown): DeltaBadgeModel {
  const value = asNumber(delta) ?? 0
  const direction: TrendDirection = value > 0 ? "up" : value < 0 ? "down" : "flat"
  const magnitude = Number.isInteger(value)
    ? String(Math.abs(value))
    : String(Math.round(Math.abs(value) * 100) / 100)
  return {
    value,
    direction,
    text: direction === "up" ? `+${magnitude}` : direction === "down" ? `-${magnitude}` : "0",
  }
}

/** easeOutCubic easing — input clamped to 0..1. */
export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return 1 - (1 - x) ** 3
}

/** Interpolate a count-up frame; non-finite time or zero duration lands on `to`. */
export function countUpValue(
  from: number,
  to: number,
  elapsedMs: number,
  durationMs: number,
): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(durationMs) || durationMs <= 0) return to
  return from + (to - from) * easeOutCubic(elapsedMs / durationMs)
}

/** prefers-reduced-motion probe — true also when matchMedia is unavailable. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

// ── SkeletonBlock / EmptyHint / CopyField / JsonPeek ────────────────────────

export type SkeletonVariant = "text" | "rect" | "circle"

export interface SkeletonModel {
  variant: SkeletonVariant
  /** 1–8 shimmer lines (rect/circle ignore it). */
  lines: number
}

function skeletonVariant(v: unknown): SkeletonVariant {
  const s = asString(v, 20)?.toLowerCase().trim()
  return s === "rect" || s === "circle" ? s : "text"
}

/** Normalize skeleton shape input (number = line count, string = variant). */
export function skeletonModel(input: unknown): SkeletonModel {
  if (typeof input === "number" && Number.isFinite(input)) {
    return { variant: "text", lines: Math.min(8, Math.max(1, Math.round(input))) }
  }
  if (typeof input === "string") return { variant: skeletonVariant(input), lines: 3 }
  const o = asRecord(input)
  const lines = asNumber(o.lines)
  return {
    variant: skeletonVariant(o.variant),
    lines: lines === undefined ? 3 : Math.min(8, Math.max(1, Math.round(lines))),
  }
}

export interface EmptyHintModel {
  title: string
  hint?: string
  actionLabel?: string
}

/** Extract an empty-state hint: title, optional hint and action label. */
export function emptyHintModel(input: unknown): EmptyHintModel {
  const o = asRecord(input)
  return {
    title:
      asString(o.title, 200) ??
      asString(o.text, 200) ??
      (typeof input === "string" ? asString(input, 200) : undefined) ??
      "",
    hint: asString(o.hint, 300) ?? asString(o.description, 300) ?? asString(o.detail, 300),
    actionLabel: asString(o.action, 60) ?? asString(o.actionLabel, 60) ?? asString(o.button, 60),
  }
}

export interface CopyFieldModel {
  value: string
  label?: string
}

/** Extract a copyable field's value and optional label. */
export function copyFieldModel(input: unknown): CopyFieldModel {
  if (typeof input === "string") return { value: input }
  const o = asRecord(input)
  return {
    value: asString(o.value, 2_000) ?? asString(o.text, 2_000) ?? "",
    label: asString(o.label, 120),
  }
}

export interface JsonPeekModel {
  /** Bounded preview text (pretty-printed when the input parses as JSON). */
  preview: string
  /** Full text shown after expansion. */
  full: string
  truncated: boolean
  /** False for plain strings / undefined — the renderer shows it raw. */
  isJson: boolean
}

/** Pretty-print and bound JSON for peeking; strings must parse to count. */
export function jsonPeekModel(input: unknown, maxChars = 400): JsonPeekModel {
  let full = ""
  let isJson = false
  if (typeof input === "string") {
    try {
      full = JSON.stringify(JSON.parse(input), null, 2)
      isJson = true
    } catch {
      full = input
    }
  } else {
    try {
      full = JSON.stringify(input, null, 2) ?? ""
      isJson = input !== undefined
    } catch {
      full = ""
    }
  }
  const truncated = full.length > maxChars
  return { preview: truncated ? full.slice(0, maxChars) : full, full, truncated, isJson }
}
