// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the memory domain: defensive extraction of the
 * per-role memory buckets (userFeedback / reviewSuggestions /
 * commonErrors / goodExamples) out of the existing GET /api/evolution/agents
 * payload (facade.profiles). Read-only — nothing here writes.
 */

export const MEMORY_BUCKETS = [
  "userFeedback",
  "reviewSuggestions",
  "commonErrors",
  "goodExamples",
] as const

export type MemoryBucketName = (typeof MEMORY_BUCKETS)[number]

export interface MemoryBucketView {
  name: MemoryBucketName
  count: number
  /** Most recent entries first, as delivered by the profile store. */
  entries: string[]
}

export interface MemoryRoleView {
  role: string
  version: string
  buckets: MemoryBucketView[]
  totalEntries: number
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** One memory entry: plain string (legacy) or { content, ... } (current). */
function memoryEntryText(entry: unknown): string | null {
  if (typeof entry === "string") return entry
  if (entry != null && typeof entry === "object") {
    const content = (entry as { content?: unknown }).content
    if (typeof content === "string") return content
  }
  return null
}

function toBucketView(name: MemoryBucketName, raw: unknown): MemoryBucketView {
  const entries: string[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const text = memoryEntryText(item)
      if (text !== null) entries.push(text)
    }
  }
  return { name, count: entries.length, entries }
}

/** One profile row → role view with the four buckets in display order. */
export function toMemoryRoleView(row: unknown): MemoryRoleView | null {
  if (row == null || typeof row !== "object") return null
  const r = row as Record<string, unknown>
  const role = str(r.role, str(r.id))
  if (!role) return null
  const memory =
    r.memory != null && typeof r.memory === "object" ? (r.memory as Record<string, unknown>) : {}
  const buckets = MEMORY_BUCKETS.map((name) => toBucketView(name, memory[name]))
  return {
    role,
    version: str(r.currentVersion, "v1"),
    buckets,
    totalEntries: buckets.reduce((sum, b) => sum + b.count, 0),
  }
}

/** Defensive /evolution/agents response → role views (stable input order). */
export function toMemoryRoleViews(raw: unknown): MemoryRoleView[] {
  if (raw == null || typeof raw !== "object") return []
  const profiles = (raw as { profiles?: unknown }).profiles
  if (!Array.isArray(profiles)) return []
  const views: MemoryRoleView[] = []
  for (const row of profiles) {
    const view = toMemoryRoleView(row)
    if (view !== null) views.push(view)
  }
  return views
}

/**
 * Resolve the role the viewer should show: the explicit selection when it
 * still exists, otherwise the role with the most memory (most useful
 * default), otherwise the first role, otherwise null.
 */
export function pickRole(views: MemoryRoleView[], selected: string | null): MemoryRoleView | null {
  if (views.length === 0) return null
  if (selected !== null) {
    const hit = views.find((v) => v.role === selected)
    if (hit) return hit
  }
  let best = views[0]
  for (const v of views) {
    if (v.totalEntries > best.totalEntries) best = v
  }
  return best
}

/** Truncate an entry for the preview list. */
export function entryPreview(text: string, maxChars = 140): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

/** Previews for one bucket (first entries only). */
export function bucketPreviews(bucket: MemoryBucketView, max = 3): string[] {
  return bucket.entries.slice(0, max).map((e) => entryPreview(e))
}

/** Safe per-bucket count lookup for compact renderers. */
export function bucketCount(role: MemoryRoleView | null, name: MemoryBucketName): number {
  if (role === null) return 0
  const hit = role.buckets.find((b) => b.name === name)
  return num(hit?.count) ?? 0
}
