// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the memory domain: defensive extraction of the
 * per-role memory buckets (userFeedback / reviewSuggestions /
 * commonErrors / goodExamples) plus the per-bucket efficacy ledger out of
 * the existing GET /api/evolution/agents payload (facade.profiles).
 * Read-only — nothing here writes.
 */

export const MEMORY_BUCKETS = [
  "userFeedback",
  "reviewSuggestions",
  "commonErrors",
  "goodExamples",
] as const

export type MemoryBucketName = (typeof MEMORY_BUCKETS)[number]

/**
 * Gating inference constants — must mirror AgentMemoryStore.gatingDecisions
 * in @max/evolution (eps = 0.25, minSamples = 3): a bucket is skipped under
 * "enforce" when its efficacy mean is below −eps with at least minSamples
 * credit/blame samples.
 */
export const GATING_EPS = 0.25
export const GATING_MIN_SAMPLES = 3

/** One memory entry as the viewer renders it. */
export interface MemoryEntryView {
  content: string
  mime: string
  /** Best-effort recent time from entry metadata; null when absent. */
  at: string | null
}

export interface MemoryBucketView {
  name: MemoryBucketName
  count: number
  entries: MemoryEntryView[]
}

/** Per-bucket efficacy ledger (profile.memory.efficacy[bucket]). */
export interface EfficacyLedgerView {
  injectedCount: number
  deltaSum: number
  /** deltaSum / injectedCount; null when there are no samples yet. */
  mean: number | null
  /**
   * Inference of the @max/evolution gate: mean < −0.25 with ≥ 3 samples →
   * the bucket would be skipped if memory gating ran in "enforce" mode.
   */
  wouldSkipUnderEnforce: boolean
}

export interface MemoryRoleView {
  role: string
  version: string
  buckets: MemoryBucketView[]
  totalEntries: number
  /** Ledger rows for buckets that have entries, keyed by bucket name. */
  efficacy: Partial<Record<MemoryBucketName, EfficacyLedgerView>>
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * One memory entry: plain string (legacy) or { content, mime, metadata }
 * (current). Metadata is free-form; several plausible timestamp keys are
 * probed and the first string wins — honest null otherwise.
 */
function toEntryView(entry: unknown): MemoryEntryView | null {
  if (typeof entry === "string") {
    return { content: entry, mime: "text/plain", at: null }
  }
  if (entry != null && typeof entry === "object") {
    const obj = entry as Record<string, unknown>
    if (typeof obj.content !== "string") return null
    const meta =
      obj.metadata != null && typeof obj.metadata === "object"
        ? (obj.metadata as Record<string, unknown>)
        : {}
    let at: string | null = null
    for (const key of ["at", "timestamp", "createdAt", "addedAt", "recordedAt", "time"]) {
      const hit = meta[key]
      if (typeof hit === "string" && hit.length > 0) {
        at = hit
        break
      }
    }
    return {
      content: obj.content,
      mime: str(obj.mime, "text/plain"),
      at,
    }
  }
  return null
}

function toBucketView(name: MemoryBucketName, raw: unknown): MemoryBucketView {
  const entries: MemoryEntryView[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const view = toEntryView(item)
      if (view !== null) entries.push(view)
    }
  }
  return { name, count: entries.length, entries }
}

/**
 * Defensive efficacy ledger for one bucket. Mirrors the gate: only buckets
 * with entries participate (the backend's gatingDecisions skips empty
 * buckets), and the skip verdict needs ≥ GATING_MIN_SAMPLES samples with
 * mean < −GATING_EPS.
 */
export function toEfficacyLedgerView(raw: unknown): EfficacyLedgerView | null {
  if (raw == null || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const injectedCount = num(obj.injectedCount)
  const deltaSum = num(obj.deltaSum)
  if (injectedCount === null || deltaSum === null || injectedCount <= 0) return null
  const mean = deltaSum / injectedCount
  return {
    injectedCount,
    deltaSum,
    mean,
    wouldSkipUnderEnforce: injectedCount >= GATING_MIN_SAMPLES && mean < -GATING_EPS,
  }
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
  const rawEfficacy =
    memory.efficacy != null && typeof memory.efficacy === "object"
      ? (memory.efficacy as Record<string, unknown>)
      : {}
  const efficacy: Partial<Record<MemoryBucketName, EfficacyLedgerView>> = {}
  for (const bucket of buckets) {
    if (bucket.count === 0) continue
    const ledger = toEfficacyLedgerView(rawEfficacy[bucket.name])
    if (ledger !== null) efficacy[bucket.name] = ledger
  }
  return {
    role,
    version: str(r.currentVersion, "v1"),
    buckets,
    totalEntries: buckets.reduce((sum, b) => sum + b.count, 0),
    efficacy,
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

/** Truncate an entry for the collapsed preview line. */
export function entryPreview(text: string, maxChars = 140): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

/** Previews for one bucket (first entries only). */
export function bucketPreviews(bucket: MemoryBucketView, max = 3): string[] {
  return bucket.entries.slice(0, max).map((e) => entryPreview(e.content))
}

/** Safe per-bucket count lookup for compact renderers. */
export function bucketCount(role: MemoryRoleView | null, name: MemoryBucketName): number {
  if (role === null) return 0
  const hit = role.buckets.find((b) => b.name === name)
  return num(hit?.count) ?? 0
}

/**
 * Cross-bucket search for the active role: case-insensitive substring over
 * entry content. Empty / whitespace-only query keeps every bucket (the
 * efficacy ledger table renders all four); a non-empty query keeps only
 * buckets with at least one hit. Returns the per-bucket views plus the
 * total hit count so the UI can show "n matches".
 */
export function searchRoleEntries(
  role: MemoryRoleView,
  query: string,
): { buckets: MemoryBucketView[]; matches: number } {
  const needle = query.trim().toLowerCase()
  if (needle === "") {
    return { buckets: role.buckets, matches: role.totalEntries }
  }
  const buckets: MemoryBucketView[] = []
  let matches = 0
  for (const bucket of role.buckets) {
    const entries = bucket.entries.filter((e) => e.content.toLowerCase().includes(needle))
    if (entries.length === 0) continue
    matches += entries.length
    buckets.push({ ...bucket, entries })
  }
  return { buckets, matches }
}
