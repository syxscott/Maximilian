// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the TUI Memory panel (the evolution domain's memory
 * half): input is one AgentProfile record from GET /api/evolution/agents
 * (the same data source as the Agents panel), output is the typed view model
 * the ink component paints — the four memory buckets normalized into entry
 * lists, plus the per-bucket efficacy ledger with the gating inference.
 *
 * The gating thresholds are EXPORTED FROM HERE and must stay in lockstep with
 * packages/evolution `AgentMemoryStore.gatingDecisions` (eps=0.25,
 * minSamples=3): a bucket is gated OUT ("skip") iff it has at least
 * MIN_SAMPLES injected runs AND mean efficacy (deltaSum / injectedCount) is
 * strictly below −EPS. Exactly −0.25 is NOT a skip (the engine uses `<`),
 * and fewer than MIN_SAMPLES samples is never a skip — the engine injects
 * with an uncertainty bias so lessons can still earn evidence.
 *
 * The API validates with Zod upstream but the TUI deliberately skips a second
 * runtime check, so everything here is defensive (garbage in any field
 * degrades that field only) and unit-testable. No React, no ink, no i18n
 * imports — the panel translates the returned *keys*.
 */

// ── Thresholds (mirror packages/evolution/src/memory.ts gatingDecisions) ────

/** |mean| band of the gate: skip iff mean < −EPS with enough samples. */
export const MEMORY_GATING_EPS = 0.25
/** Minimum injected-run samples before the gate may skip a bucket. */
export const MEMORY_GATING_MIN_SAMPLES = 3
/** One-line preview length for an entry before it gets an ellipsis. */
export const MEMORY_PREVIEW_LENGTH = 80

// ── Bucket normalization (legacy string[] and MemoryEntry[] → typed views) ──

export type MemoryBucketKey = "userFeedback" | "reviewSuggestions" | "commonErrors" | "goodExamples"

export const MEMORY_BUCKETS: readonly MemoryBucketKey[] = [
  "userFeedback",
  "reviewSuggestions",
  "commonErrors",
  "goodExamples",
]

export interface MemoryEntryView {
  /** Stable list key — `${bucket}:${index}` in bucket order. */
  key: string
  bucket: MemoryBucketKey
  /** Declared mime (e.g. "text/plain", "application/json", "text/digest"). */
  mime: string
  /** Full defensive string content — what Enter expands to. */
  content: string
  /** Whitespace-collapsed one-line preview, ellipsis when cut. */
  preview: string
  isTruncated: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

/** Defensive stringify that never throws (circular structures included). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Normalize one raw bucket item into { mime, content }. Legacy profiles store
 * plain strings; current ones store { mime, content, metadata }. Numbers and
 * booleans coerce to strings, object content JSON-stringifies, and outright
 * garbage (null / arrays / functions / symbols) is dropped.
 */
export function normalizeMemoryEntry(value: unknown): { mime: string; content: string } | null {
  if (typeof value === "string") return { mime: "text/plain", content: value }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return { mime: "text/plain", content: String(value) }
  }
  if (!isRecord(value)) return null
  const rawMime = typeof value.mime === "string" && value.mime.length > 0 ? value.mime : ""
  const mime = rawMime.length > 0 ? rawMime : "text/plain"
  const rawContent = value.content
  let content: string
  if (typeof rawContent === "string") content = rawContent
  else if (
    typeof rawContent === "number" ||
    typeof rawContent === "boolean" ||
    typeof rawContent === "bigint"
  ) {
    content = String(rawContent)
  } else if (rawContent == null) content = safeStringify(value)
  else content = safeStringify(rawContent)
  return { mime, content }
}

/** Whitespace-collapsed one-line preview for list rendering. */
export function truncateEntryPreview(
  content: string,
  max: number = MEMORY_PREVIEW_LENGTH,
): { preview: string; isTruncated: boolean } {
  const flat = content.replace(/\s+/g, " ").trim()
  if (flat.length <= max) return { preview: flat, isTruncated: false }
  return { preview: `${flat.slice(0, max)}…`, isTruncated: true }
}

export interface MemoryBucketView {
  key: MemoryBucketKey
  /** i18n key under "tui.memory.bucket.*" — the panel translates it. */
  labelKey: string
  count: number
  entries: MemoryEntryView[]
}

/**
 * The four buckets of one role's memory, normalized. A non-array bucket
 * (legacy garbage) counts as empty; every entry keeps its full content so
 * Enter can expand it, plus a truncated one-line preview for the list.
 */
export function memoryBuckets(memory: unknown): MemoryBucketView[] {
  const source = isRecord(memory) ? memory : {}
  return MEMORY_BUCKETS.map((key) => {
    const raw = source[key]
    const items = Array.isArray(raw) ? raw : []
    const entries: MemoryEntryView[] = []
    items.forEach((item, index) => {
      const normalized = normalizeMemoryEntry(item)
      if (normalized == null) return
      const { preview, isTruncated } = truncateEntryPreview(normalized.content)
      entries.push({
        key: `${key}:${index}`,
        bucket: key,
        mime: normalized.mime,
        content: normalized.content,
        preview,
        isTruncated,
      })
    })
    return { key, labelKey: `tui.memory.bucket.${key}`, count: entries.length, entries }
  })
}

// ── Efficacy ledger + gating inference (mirrors gatingDecisions) ────────────

export type GatingDecision = "inject" | "skip"
/** "insufficient" = fewer than MIN_SAMPLES runs: inject with uncertainty. */
export type GatingEvidence = "sufficient" | "insufficient"

export interface GatingInference {
  injectedCount: number
  deltaSum: number
  /** deltaSum / injectedCount, 0 when nothing was ever injected. */
  mean: number
  decision: GatingDecision
  evidence: GatingEvidence
  /** False when the profile carried no efficacy record for this bucket. */
  observed: boolean
}

/**
 * Infer the engine's gating decision for one bucket from its efficacy
 * record. `skip` iff at least MEMORY_GATING_MIN_SAMPLES samples AND
 * mean < −MEMORY_GATING_EPS (strict: exactly −0.25 stays injected, matching
 * the engine's `mean < -eps`). Anything else injects; sub-threshold samples
 * are flagged "insufficient" so the UI can show the uncertainty bias.
 */
export function inferGating(record: unknown): GatingInference {
  const observed = isRecord(record)
  const rawCount = observed && typeof record.injectedCount === "number" ? record.injectedCount : 0
  const rawSum = observed && typeof record.deltaSum === "number" ? record.deltaSum : 0
  const injectedCount = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 0
  const deltaSum = Number.isFinite(rawSum) ? rawSum : 0
  const mean = injectedCount > 0 ? deltaSum / injectedCount : 0
  const evidence: GatingEvidence =
    injectedCount >= MEMORY_GATING_MIN_SAMPLES ? "sufficient" : "insufficient"
  const decision: GatingDecision =
    injectedCount >= MEMORY_GATING_MIN_SAMPLES && mean < -MEMORY_GATING_EPS ? "skip" : "inject"
  return { injectedCount, deltaSum, mean, decision, evidence, observed }
}

export interface EfficacyRowView extends GatingInference {
  bucket: MemoryBucketKey
  /** i18n key under "tui.memory.bucket.*" — the panel translates it. */
  labelKey: string
}

// ── Efficacy ledger sort + bucket filter (deepened panel) ───────────────────

/**
 * Sort the efficacy ledger worst-first: mean ascending — the most negative
 * bucket (the one the engine gates out) heads the list, the healthy ones
 * sink. Mean ties break by evidence (more injected runs = more signal
 * first), then by MEMORY_BUCKETS order so the result is fully deterministic.
 *
 * Defensive: non-array input yields []; each row is re-coerced per-field
 * (garbage counts/sums degrade to 0, unknown decisions to "inject") and rows
 * without a valid bucket key are dropped — they cannot be labeled. The
 * input array is never mutated.
 */
export function sortEfficacy(rows: unknown): EfficacyRowView[] {
  const list = Array.isArray(rows) ? rows : []
  const numeric = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0
  const out: EfficacyRowView[] = []
  for (const raw of list) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue
    const record = raw as Record<string, unknown>
    const bucket = MEMORY_BUCKETS.find((key) => key === record.bucket)
    if (bucket == null) continue
    const injectedCount = numeric(record.injectedCount)
    out.push({
      bucket,
      labelKey: `tui.memory.bucket.${bucket}`,
      injectedCount: injectedCount > 0 ? injectedCount : 0,
      deltaSum: numeric(record.deltaSum),
      mean: numeric(record.mean),
      decision: record.decision === "skip" ? "skip" : "inject",
      evidence: record.evidence === "sufficient" ? "sufficient" : "insufficient",
      observed: record.observed === true,
    })
  }
  const order = new Map<MemoryBucketKey, number>(MEMORY_BUCKETS.map((key, i) => [key, i]))
  return out.sort((a, b) => {
    if (a.mean !== b.mean) return a.mean - b.mean
    if (b.injectedCount !== a.injectedCount) return b.injectedCount - a.injectedCount
    return (order.get(a.bucket) ?? 0) - (order.get(b.bucket) ?? 0)
  })
}

/** Bucket-filter mode cycled by the f key over the efficacy ledger. */
export type EfficacyFilter = "all" | "skip-only" | "inject-only"

/** The f-key cycle order: all → skip-only → inject-only → all. */
export const EFFICACY_FILTERS: readonly EfficacyFilter[] = ["all", "skip-only", "inject-only"]

/**
 * Next filter mode in the f-key cycle. Anything that is not a known mode
 * (including the initial undefined) reads as "all", so the first press
 * lands on "skip-only".
 */
export function cycleEfficacyFilter(current: unknown): EfficacyFilter {
  const index = EFFICACY_FILTERS.findIndex((mode) => mode === current)
  return EFFICACY_FILTERS[(index + 1) % EFFICACY_FILTERS.length] ?? "all"
}

/**
 * Filter the efficacy ledger's bucket rows by the f-key mode: "all" keeps
 * every row, "skip-only" only the gated ones ("worst buckets"), "inject-only"
 * only the injecting ones. Rows pass through untouched (compose with
 * sortEfficacy for the worst-first order); non-object rows are dropped —
 * they cannot render. A garbage mode reads as "all"; input never mutates.
 */
export function filterBuckets(rows: unknown, mode: unknown): EfficacyRowView[] {
  const filter: EfficacyFilter = mode === "skip-only" || mode === "inject-only" ? mode : "all"
  const list = Array.isArray(rows) ? rows : []
  return list.filter((raw): raw is EfficacyRowView => {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return false
    if (filter === "all") return true
    const decision = (raw as { decision?: unknown }).decision
    return filter === "skip-only" ? decision === "skip" : decision === "inject"
  })
}

/**
 * The per-bucket efficacy ledger, in MEMORY_BUCKETS order. A row appears for
 * every bucket that either holds entries or has an efficacy record — the
 * engine's gatingDecisions likewise skips buckets with nothing to gate.
 */
export function efficacyLedger(memory: unknown): EfficacyRowView[] {
  const source = isRecord(memory) ? memory : {}
  const efficacy = isRecord(source.efficacy) ? source.efficacy : {}
  const rows: EfficacyRowView[] = []
  for (const key of MEMORY_BUCKETS) {
    const hasEntries = Array.isArray(source[key]) && source[key].length > 0
    const record = efficacy[key]
    const inference = inferGating(record)
    if (!hasEntries && !inference.observed) continue
    rows.push({ bucket: key, labelKey: `tui.memory.bucket.${key}`, ...inference })
  }
  return rows
}

// ── Panel view model (one role's whole memory screen) ───────────────────────

export interface MemoryPanelView {
  role: string
  buckets: MemoryBucketView[]
  /** Declared totalEntries when finite, else the counted sum. */
  totalEntries: number
  /** Flat entry list across buckets (bucket order) — the panel's cursor maps here. */
  flatEntries: MemoryEntryView[]
  efficacy: EfficacyRowView[]
}

/** Read one profile's memory view — garbage profiles degrade to an empty view. */
export function memoryPanelView(profile: unknown): MemoryPanelView {
  const source = isRecord(profile) ? profile : {}
  const role = typeof source.role === "string" ? source.role : ""
  const buckets = memoryBuckets(source.memory)
  const declared = isRecord(source.memory) ? source.memory.totalEntries : undefined
  const counted = buckets.reduce((acc, b) => acc + b.count, 0)
  return {
    role,
    buckets,
    totalEntries: typeof declared === "number" && Number.isFinite(declared) ? declared : counted,
    flatEntries: buckets.flatMap((b) => b.entries),
    efficacy: efficacyLedger(source.memory),
  }
}

// ── Export (e key) ──────────────────────────────────────────────────────────

export interface MemoryExportDoc {
  role: string
  exportedAt: string
  totalEntries: number
  buckets: Array<{
    key: MemoryBucketKey
    count: number
    entries: Array<{ mime: string; content: string }>
  }>
  efficacy: Array<{
    bucket: MemoryBucketKey
    injectedCount: number
    deltaSum: number
    mean: number
    decision: GatingDecision
  }>
}

/** Build the clipboard-ready export document for one role's memory. */
export function buildMemoryExport(
  role: string,
  profile: unknown,
  now: Date = new Date(),
): MemoryExportDoc {
  const view = memoryPanelView(profile)
  return {
    role: role.length > 0 ? role : view.role,
    exportedAt: new Date(Number.isFinite(now.getTime()) ? now.getTime() : Date.now()).toISOString(),
    totalEntries: view.totalEntries,
    buckets: view.buckets.map((b) => ({
      key: b.key,
      count: b.count,
      entries: b.entries.map((e) => ({ mime: e.mime, content: e.content })),
    })),
    efficacy: view.efficacy.map((r) => ({
      bucket: r.bucket,
      injectedCount: r.injectedCount,
      deltaSum: r.deltaSum,
      mean: r.mean,
      decision: r.decision,
    })),
  }
}

/** Pretty-print the export doc — deterministic JSON for the clipboard. */
export function memoryExportJson(doc: MemoryExportDoc): string {
  return JSON.stringify(doc, null, 2)
}

/** "+0.42" / "-1.30" / "+0.00" — signed fixed formatting for ledger cells. */
export function formatSigned(value: unknown): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`
}
