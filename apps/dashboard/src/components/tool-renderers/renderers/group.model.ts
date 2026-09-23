// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Group-renderer model layer: execute-group / changes-group / cua-group
 * receive their sub-calls as a passthrough array (input.items or
 * input.calls — defensive candidates) and re-render them recursively via
 * ToolCallBlock, clamped to GROUP_LIMIT with an overflow note.
 */

import { asRecord, jsonPreview, pickArray, pickBool, pickNum, pickStr } from "./shared.model"

export type GroupKind = "execute" | "changes" | "cua"

/** Sub-calls shown before the "还有 N 个" clamp. */
export const GROUP_LIMIT = 8

export interface GroupChild {
  tool: string
  input: unknown
  ok?: boolean
  durationMs?: number
  error?: string
}

export interface GroupViewModel {
  children: GroupChild[]
  total: number
  shown: number
  overflow: number
}

const EMPTY: GroupViewModel = { children: [], total: 0, shown: 0, overflow: 0 }

/** Fallback tool name for children that carry no explicit tool field. */
function fallbackTool(kind: GroupKind): string {
  if (kind === "changes") return "edit"
  if (kind === "cua") return "cua-action"
  return "bash"
}

/** Guess a child's tool from its shape when the envelope omits one. */
function guessTool(item: Record<string, unknown>, kind: GroupKind): string {
  if (pickStr(item, ["tool", "toolName", "name"]) !== undefined) return ""
  if (kind === "changes") {
    if (pickStr(item, ["newString"]) !== undefined) return "edit"
    if (pickStr(item, ["content"]) !== undefined) return "write"
  }
  if (kind === "execute" && pickStr(item, ["command", "cmd"]) !== undefined) return "bash"
  return fallbackTool(kind)
}

function normalizeChild(item: unknown, kind: GroupKind): GroupChild {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    // Primitive / array payload: wrap so the fallback body shows something.
    return { tool: fallbackTool(kind), input: { value: item } }
  }
  const obj = item as Record<string, unknown>
  const tool =
    pickStr(obj, ["tool", "toolName", "name"]) !== undefined
      ? (pickStr(obj, ["tool", "toolName", "name"]) as string)
      : guessTool(obj, kind)
  const rawError = obj["error"]
  const error =
    typeof rawError === "string"
      ? rawError
      : rawError !== undefined && rawError !== null
        ? jsonPreview(rawError, 200)
        : pickStr(obj, ["error_message", "errorMessage"])
  return {
    tool,
    input: item,
    ...(pickBool(obj, ["ok", "success"]) !== undefined
      ? { ok: pickBool(obj, ["ok", "success"]) }
      : {}),
    ...(pickNum(obj, ["durationMs", "duration_ms", "ms"]) !== undefined
      ? { durationMs: pickNum(obj, ["durationMs", "duration_ms", "ms"]) }
      : {}),
    ...(error !== undefined ? { error } : {}),
  }
}

/**
 * Pull the child-call array out of a group input. Candidate keys:
 * items → calls → children → subcalls. Absent or malformed arrays yield
 * an empty view model (the body then shows the JSON fallback).
 */
export function extractGroupChildren(input: unknown, kind: GroupKind): GroupViewModel {
  const obj = asRecord(input)
  const raw = pickArray(obj, ["items", "calls", "children", "subcalls"])
  if (!raw) return EMPTY
  const children = raw.map((item) => normalizeChild(item, kind))
  const overflow = Math.max(0, children.length - GROUP_LIMIT)
  return {
    children,
    total: children.length,
    shown: Math.min(children.length, GROUP_LIMIT),
    overflow,
  }
}
