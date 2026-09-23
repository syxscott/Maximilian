// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the subagents domain: defensive normalization of
 * /evolution/agents profile rows into per-role card view models, including
 * memory-bucket counts + previews. Backend data is already scrubbed
 * (secret-scrub.ts); this layer only guards shape.
 */

export interface MemoryBucketView {
  name: string
  entries: string[]
}

export interface SubagentProfileView {
  role: string
  version: string
  avgScore: number | null
  successRate: number | null
  executionCount: number
  recentFeedbackCount: number
  memoryBuckets: MemoryBucketView[]
}

/** Buckets rendered on the expanded card, in display order. */
export const MEMORY_BUCKET_NAMES = [
  "userFeedback",
  "reviewSuggestions",
  "commonErrors",
  "goodExamples",
] as const

const MAX_BUCKET_PREVIEW = 3
const PREVIEW_MAX_CHARS = 160

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * One memory entry can be a plain string (legacy profile JSON) or a
 * MemoryEntry object `{ content, mime, ... }` (current schema).
 */
function memoryEntryText(entry: unknown): string | null {
  if (typeof entry === "string") return entry
  if (entry != null && typeof entry === "object") {
    const content = (entry as { content?: unknown }).content
    if (typeof content === "string") return content
  }
  return null
}

function toMemoryBucketView(name: string, raw: unknown): MemoryBucketView {
  const entries: string[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const text = memoryEntryText(item)
      if (text !== null) entries.push(text)
    }
  }
  return { name, entries }
}

/** Defensive /evolution/agents response → card view models. */
export function toSubagentProfileViews(raw: unknown): SubagentProfileView[] {
  if (raw == null || typeof raw !== "object") return []
  const profiles = (raw as { profiles?: unknown }).profiles
  if (!Array.isArray(profiles)) return []

  const views: SubagentProfileView[] = []
  for (const item of profiles) {
    if (item == null || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const role = str(row.role, str(row.id))
    if (!role) continue

    const memory =
      row.memory != null && typeof row.memory === "object"
        ? (row.memory as Record<string, unknown>)
        : undefined

    const buckets: MemoryBucketView[] = MEMORY_BUCKET_NAMES.map((name) =>
      toMemoryBucketView(name, memory?.[name]),
    )
    if (memory && memory.archived != null && typeof memory.archived === "object") {
      // Curator quarantine: a record of bucket → retired entries. Flattened
      // into one "archived" bucket for the card.
      const archived: unknown[] = []
      for (const value of Object.values(memory.archived as Record<string, unknown>)) {
        if (Array.isArray(value)) archived.push(...value)
      }
      buckets.push(toMemoryBucketView("archived", archived))
    }

    const feedbackBucket = buckets.find((b) => b.name === "userFeedback")
    const score = num(row.avgScore)

    views.push({
      role,
      version: str(row.currentVersion, "v1"),
      avgScore: score,
      successRate: num(row.successRate),
      executionCount: num(row.totalTasks) ?? 0,
      recentFeedbackCount: feedbackBucket?.entries.length ?? 0,
      memoryBuckets: buckets,
    })
  }
  return views
}

/** Case-insensitive role filter for long profile lists. */
export function filterProfiles(
  profiles: SubagentProfileView[],
  query: string,
): SubagentProfileView[] {
  const q = query.trim().toLowerCase()
  if (!q) return profiles
  return profiles.filter((p) => p.role.toLowerCase().includes(q))
}

export interface Windowed<T> {
  items: T[]
  shown: number
  total: number
  hidden: number
}

/** Cap a list for render; the footer reports how many cards are folded away. */
export function windowList<T>(items: T[], max: number): Windowed<T> {
  const total = items.length
  const capped = items.slice(0, Math.max(0, max))
  return { items: capped, shown: capped.length, total, hidden: Math.max(0, total - max) }
}

/** Preview slice for one bucket (first entries, length-capped text). */
export function bucketPreview(bucket: MemoryBucketView): string[] {
  return bucket.entries
    .slice(0, MAX_BUCKET_PREVIEW)
    .map((e) => (e.length > PREVIEW_MAX_CHARS ? `${e.slice(0, PREVIEW_MAX_CHARS)}…` : e))
}
