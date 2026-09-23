// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Prompt-editor model layer — attachment bookkeeping and slash-command
 * matching. Pure functions over passthrough inputs (FileList blobs,
 * free-typed text) producing typed view models, per CONVENTIONS.
 */

import { COMMANDS, type CommandDef } from "@/lib/commands"

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export interface Attachment {
  id: string
  name: string
  /** Bytes; unknown sizes read as 0. */
  size: number
}

/** Hard cap on attachments per draft (honest local-only staging). */
export const MAX_ATTACHMENTS = 5

/** Defensive extraction of {name,size} rows from a FileList/array-ish blob. */
export function filesToAttachments(source: unknown): Attachment[] {
  if (source === null || typeof source !== "object") return []
  const list = Array.isArray(source) ? source : Array.from(source as ArrayLike<unknown>)
  return list.map(rowToAttachment).filter((a): a is Attachment => a !== null)
}

function rowToAttachment(row: unknown): Attachment | null {
  if (row === null || typeof row !== "object") return null
  const rec = row as Record<string, unknown>
  if (typeof rec.name !== "string" || rec.name.length === 0) return null
  return {
    id: `${rec.name}:${typeof rec.size === "number" ? rec.size : 0}`,
    name: rec.name,
    size: typeof rec.size === "number" && Number.isFinite(rec.size) ? rec.size : 0,
  }
}

export interface AddAttachmentsResult {
  attachments: Attachment[]
  /** Rows dropped for breaching MAX_ATTACHMENTS. */
  rejected: number
}

/**
 * Append new attachments, deduplicating by id and enforcing the hard
 * cap. Never throws — over-cap rows are reported via `rejected`.
 */
export function addAttachments(
  current: Attachment[],
  incoming: Attachment[],
  max: number = MAX_ATTACHMENTS,
): AddAttachmentsResult {
  const seen = new Set(current.map((a) => a.id))
  const out = [...current]
  let rejected = 0
  for (const att of incoming) {
    if (out.length >= max) {
      rejected += 1
      continue
    }
    if (seen.has(att.id)) continue
    seen.add(att.id)
    out.push(att)
  }
  return { attachments: out, rejected }
}

/** "1.2 KB" / "3 B" / "0 B" — display-only byte formatting. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1)
  return `${rounded} ${units[unit]}`
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

export type SlashCommandKind = "navigate" | "action"

export interface SlashCommandView {
  id: string
  title: string
  description?: string
  kind: SlashCommandKind
  /** Formatted default keybind, when the command declares one. */
  keybind?: string
  command: CommandDef
}

/**
 * The active slash query: text up to the caret must be "/" plus a token
 * with no whitespace yet ("/nav" → "nav"; "/nav foo" → null).
 */
export function parseSlashQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret)
  const match = /^\/(\S*)$/.exec(before)
  return match ? (match[1] ?? "") : null
}

/**
 * Match COMMANDS against the query: registry substring filter over id /
 * titleKey, plus fuzzy matching against the TRANSLATED title so localized
 * input works. Registry order is preserved (it is the authoritative
 * ordering). Disabled commands never match.
 */
export function matchSlashCommands(
  query: string,
  translate: (key: string, fallback?: string) => string,
): SlashCommandView[] {
  const q = query.trim()
  const pool = COMMANDS.filter((c) => c.enabled !== false)
  const views = pool.map((command) => toSlashView(command, translate))
  if (!q) return views
  const lower = q.toLowerCase()
  return views.filter((v) => {
    if (v.id.toLowerCase().includes(lower)) return true
    if (v.title.toLowerCase().includes(lower)) return true
    return v.title
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(lower))
  })
}

function toSlashView(
  command: CommandDef,
  translate: (key: string, fallback?: string) => string,
): SlashCommandView {
  return {
    id: command.id,
    title: translate(command.titleKey, command.titleKey),
    description: command.descriptionKey
      ? translate(command.descriptionKey, command.descriptionKey)
      : undefined,
    kind: command.navigateTo ? "navigate" : "action",
    command,
  }
}
