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
