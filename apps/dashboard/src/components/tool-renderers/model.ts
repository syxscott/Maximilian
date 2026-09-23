// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tool-call model layer — pure extractors that turn a passthrough tool
 * event payload into typed view models. Presentation (see registry.tsx)
 * never touches the raw `unknown` input; each renderer declares a
 * `summarize` (one-line) and a `detail` (structured rows) extraction.
 * Mirrors the DisciplineFiles model/presentation split of ZCode's
 * ToolCallBlocks.
 */

export interface ToolInputRows {
  /** Ordered (label, value) rows for the detail view. */
  rows: Array<{ label: string; value: string; mono?: boolean }>
  /** Primary target (file path / command head) for the collapsed line. */
  title: string
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)

function head(text: string, max = 120): string {
  const one = text.replace(/\s+/g, " ").trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

function rowsFrom(
  obj: Record<string, unknown>,
  spec: Array<[string, string, boolean?]>,
): ToolInputRows {
  const rows: ToolInputRows["rows"] = []
  for (const [key, label, mono] of spec) {
    const raw = obj[key]
    if (raw === undefined) continue
    const value = typeof raw === "string" ? raw : JSON.stringify(raw)
    rows.push({ label, value, mono })
  }
  return { rows, title: "" }
}

export function summarizeToolInput(tool: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>
  switch (tool) {
    case "bash":
      return head(str(obj.command) ?? "")
    case "read":
      return head(str(obj.file_path) ?? "")
    case "write":
      return head(str(obj.file_path) ?? "")
    case "edit":
      return head(str(obj.file_path) ?? "")
    case "glob":
      return head(str(obj.pattern) ?? "")
    case "grep":
      return head(str(obj.pattern) ?? "")
    case "permission":
      return head(str(obj.tool) ?? "")
    case "lsp":
      return head(str(obj.method) ?? "")
    default:
      return head(Object.keys(obj).length > 0 ? JSON.stringify(obj) : tool)
  }
}

export function toolInputRows(tool: string, input: unknown): ToolInputRows {
  const obj = (input ?? {}) as Record<string, unknown>
  switch (tool) {
    case "bash": {
      const r = rowsFrom(obj, [
        ["command", "command", true],
        ["timeout", "timeout (ms)"],
      ])
      r.title = head(str(obj.command) ?? "")
      return r
    }
    case "read": {
      const r = rowsFrom(obj, [
        ["file_path", "file", true],
        ["offset", "offset"],
        ["limit", "limit"],
      ])
      r.title = head(str(obj.file_path) ?? "")
      return r
    }
    case "write": {
      const r = rowsFrom(obj, [
        ["file_path", "file", true],
        ["content", "content", true],
      ])
      r.title = head(str(obj.file_path) ?? "")
      const content = str(obj.content)
      if (content) {
        r.rows.push({ label: "bytes", value: String(new TextEncoder().encode(content).length) })
      }
      return r
    }
    case "edit": {
      const r = rowsFrom(obj, [
        ["file_path", "file", true],
        ["oldString", "old", true],
        ["newString", "new", true],
      ])
      r.title = head(str(obj.file_path) ?? "")
      return r
    }
    case "glob": {
      const r = rowsFrom(obj, [
        ["pattern", "pattern", true],
        ["path", "base", true],
      ])
      r.title = head(str(obj.pattern) ?? "")
      return r
    }
    case "grep": {
      const r = rowsFrom(obj, [
        ["pattern", "pattern", true],
        ["path", "base", true],
      ])
      r.title = head(str(obj.pattern) ?? "")
      return r
    }
    default: {
      const keys = Object.keys(obj)
      const rows = keys.slice(0, 8).map((k) => ({
        label: k,
        value: head(typeof obj[k] === "string" ? (obj[k] as string) : JSON.stringify(obj[k])),
        mono: true,
      }))
      return { rows, title: head(keys.length > 0 ? JSON.stringify(obj) : tool, 80) }
    }
  }
}

/** Byte length of a string in UTF-8 (write renderer detail). */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

export function lineCount(text: string): number {
  return text.split("\n").length
}

export { num, str }
