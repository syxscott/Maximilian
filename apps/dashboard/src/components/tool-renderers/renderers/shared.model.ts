// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tool-renderer shared model layer — defensive extraction helpers for the
 * per-tool renderers under renderers/. Tool inputs are passthrough JSON of
 * unknown shape, so every accessor tolerates missing fields, wrong types
 * and outright malformed payloads (arrays, primitives, null). Field names
 * are read from ordered candidate-key lists ("name ?? id ?? title") and
 * when nothing lands the body falls back to a generic JSON preview.
 *
 * Pure functions only — presentation lives in common.tsx / <tool>.tsx.
 */

/** One labeled row in a tool body. `labelKey` is an i18n key string; the
 *  body resolves it through t() so the model layer stays locale-free. */
export interface RendererRow {
  labelKey: string
  value: string
  mono?: boolean
}

/** Monospace code block (node-repl, eval-workflow-snippet). */
export interface RendererCode {
  text: string
  /** Collapse beyond this many lines; overflow is noted by the body. */
  maxLines?: number
}

/** Typed view model every per-tool extractor returns. */
export interface ToolViewModel {
  /** One-line raw value for the collapsed row (registry summarize). */
  headline: string
  rows: RendererRow[]
  code?: RendererCode
  /** True when no domain field was found → body shows the JSON preview. */
  isEmpty: boolean
}

export const FIELDS = {
  agent: "toolRenderers.fields.agent",
  answer: "toolRenderers.fields.answer",
  args: "toolRenderers.fields.args",
  command: "toolRenderers.fields.command",
  count: "toolRenderers.fields.count",
  description: "toolRenderers.fields.description",
  file: "toolRenderers.fields.file",
  from: "toolRenderers.fields.from",
  goal: "toolRenderers.fields.goal",
  id: "toolRenderers.fields.id",
  images: "toolRenderers.fields.images",
  interval: "toolRenderers.fields.interval",
  limit: "toolRenderers.fields.limit",
  message: "toolRenderers.fields.message",
  mode: "toolRenderers.fields.mode",
  name: "toolRenderers.fields.name",
  options: "toolRenderers.fields.options",
  path: "toolRenderers.fields.path",
  phase: "toolRenderers.fields.phase",
  prompt: "toolRenderers.fields.prompt",
  provider: "toolRenderers.fields.provider",
  query: "toolRenderers.fields.query",
  question: "toolRenderers.fields.question",
  reason: "toolRenderers.fields.reason",
  result: "toolRenderers.fields.result",
  run: "toolRenderers.fields.run",
  schedule: "toolRenderers.fields.schedule",
  scope: "toolRenderers.fields.scope",
  server: "toolRenderers.fields.server",
  session: "toolRenderers.fields.session",
  skill: "toolRenderers.fields.skill",
  status: "toolRenderers.fields.status",
  strategy: "toolRenderers.fields.strategy",
  summary: "toolRenderers.fields.summary",
  target: "toolRenderers.fields.target",
  timeout: "toolRenderers.fields.timeout",
  title: "toolRenderers.fields.title",
  tool: "toolRenderers.fields.tool",
  url: "toolRenderers.fields.url",
  workflow: "toolRenderers.fields.workflow",
} as const

/** Narrow `unknown` to a plain object; anything else becomes {}. */
export function asRecord(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

/** First string value among candidate keys. */
export function pickStr(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === "string" && v.length > 0) return v
  }
  return undefined
}

/** First finite number among candidate keys. */
export function pickNum(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === "number" && Number.isFinite(v)) return v
  }
  return undefined
}

/** First boolean among candidate keys. */
export function pickBool(obj: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === "boolean") return v
  }
  return undefined
}

/** First array value among candidate keys. */
export function pickArray(obj: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const v = obj[key]
    if (Array.isArray(v)) return v
  }
  return undefined
}

/** Collapse whitespace and clamp to `max` chars (collapsed-line safety). */
export function oneLine(text: string, max = 120): string {
  const one = text.replace(/\s+/g, " ").trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

/** Stable, clamped JSON preview for the generic fallback body. */
export function jsonPreview(input: unknown, max = 400): string {
  let text: string
  if (typeof input === "string") {
    text = input
  } else {
    try {
      text = JSON.stringify(input) ?? String(input)
    } catch {
      text = String(input)
    }
  }
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Empty view model — nothing extractable, body shows the JSON fallback. */
export function emptyVm(): ToolViewModel {
  return { headline: "", rows: [], isEmpty: true }
}

/** Build a view model from rows; empty when no rows landed. */
export function vmFrom(rows: RendererRow[], headline?: string, code?: RendererCode): ToolViewModel {
  const vm: ToolViewModel = {
    headline: headline ?? "",
    rows,
    ...(code ? { code } : {}),
    isEmpty: rows.length === 0 && !code,
  }
  return vm
}

/** Clamp a code block to `max` lines, reporting the overflow count. */
export function truncateLines(
  text: string,
  max: number,
): { text: string; overflow: number; total: number } {
  const lines = text.split("\n")
  const total = lines.length
  if (total <= max) return { text, overflow: 0, total }
  return { text: lines.slice(0, max).join("\n"), overflow: total - max, total }
}

/** Optional row builder — skips undefined/empty values. */
export function row(
  labelKey: string,
  value: string | number | undefined,
  mono = false,
): RendererRow | undefined {
  if (value === undefined) return undefined
  const text = typeof value === "number" ? String(value) : value
  if (text.length === 0) return undefined
  return { labelKey, value: oneLine(text, 400), ...(mono ? { mono } : {}) }
}
