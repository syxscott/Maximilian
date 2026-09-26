// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the jobs domain: defensive normalization of the
 * /jobs payload into typed row views, materialization-outcome tracking
 * (newest-first time-sorted trail, per-row dispatch status, global
 * latest-materialized summary), sort/filter helpers, schedule
 * formatting and draft validation. The backend JSON is passthrough —
 * every field read here guards its shape (subagents-domain pattern).
 */

export interface JobEventView {
  at: string | null
  kind: string
  /** "materialized" entries: the real workspace the worker ran. */
  workspaceId: string | null
}

/** One materialization-relevant trail entry, defensively normalized. */
export interface DispatchOutcomeView {
  at: string | null
  kind: "materialized" | "dispatch-failed"
  /** Real workspace on success; null when the fire never materialized. */
  workspaceId: string | null
  /** True for a "dispatch-failed" entry or a "materialized" without a workspace. */
  failed: boolean
}

/** Row-leading materialization state (drives the status icon). */
export type DispatchStatus = "record-only" | "materialized" | "materialize-failed"

/** The single newest successful materialization across a jobs list. */
export interface LatestMaterialized {
  jobId: string
  workspaceId: string
}

export interface JobView {
  id: string
  name: string
  schedule: string
  scheduleKind: "cron" | "interval" | "unknown"
  intervalMs: number | null
  description: string | null
  hasPayload: boolean
  createdAt: string | null
  lastTriggeredAt: string | null
  nextRunAt: string | null
  triggerCount: number
  lastEvent: JobEventView | null
  /**
   * The workspace of the newest SUCCESSFUL materialization (time-based,
   * not trail position) — null when no fire produced one.
   */
  materializedWorkspaceId: string | null
  /** `at` of that newest successful materialization — null alongside. */
  materializedAt: string | null
  /**
   * Newest materialization outcome overall (success OR failure, by `at`) —
   * null when the trail has no materialization-relevant entry at all.
   */
  dispatchOutcome: DispatchOutcomeView | null
}

export type JobSortKey = "createdAt" | "name" | "nextRunAt"

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function dateOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/** Stable newest-first ordering by parsed `at`; undated entries sink last. */
function newestFirst<T extends { at: string | null }>(entries: T[]): T[] {
  const keyed = entries.map((e, index) => {
    const parsed = e.at === null ? Number.NaN : Date.parse(e.at)
    return { e, index, ms: Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed }
  })
  keyed.sort((a, b) => (b.ms !== a.ms ? b.ms - a.ms : a.index - b.index))
  return keyed.map((k) => k.e)
}

/**
 * Materialization-relevant slice of a raw event trail ("materialized" +
 * "dispatch-failed" entries), normalized and sorted newest-first by `at`
 * — NOT by trail position: concurrent backfills can append out of
 * chronological order. Garbage entries are dropped silently.
 */
export function dispatchTrail(events: unknown[]): DispatchOutcomeView[] {
  if (!Array.isArray(events)) return []
  const out: DispatchOutcomeView[] = []
  for (const e of events) {
    if (e == null || typeof e !== "object") continue
    const r = e as Record<string, unknown>
    const kind = str(r.kind)
    if (kind !== "materialized" && kind !== "dispatch-failed") continue
    const id = str(r.workspaceId)
    const workspaceId = id.trim().length > 0 ? id : null
    out.push({
      at: dateOrNull(r.at),
      kind,
      workspaceId,
      // A "materialized" entry without a workspace is the rejection shape
      // the API writes when the worker could not materialize the fire.
      failed: workspaceId === null,
    })
  }
  return newestFirst(out)
}

/**
 * Three-state row status from a job's newest materialization outcome:
 * "record-only" (no materialization-relevant entry at all), "materialized"
 * (newest outcome succeeded) or "materialize-failed" (newest outcome is a
 * failed backfill or a dispatch failure — even if an older fire succeeded).
 */
export function dispatchStatus(job: JobView): DispatchStatus {
  if (job.dispatchOutcome === null) return "record-only"
  return job.dispatchOutcome.failed ? "materialize-failed" : "materialized"
}

/**
 * The most recently materialized workspace across a jobs list — the
 * {jobId, workspaceId} of the newest successful backfill. Time-based
 * (undated successes count as oldest, list order breaks ties); failed
 * materializations never surface here. Null when nothing materialized.
 */
export function latestMaterialized(jobs: JobView[]): LatestMaterialized | null {
  let best: LatestMaterialized | null = null
  let bestMs = Number.NEGATIVE_INFINITY
  for (const j of jobs) {
    if (j.materializedWorkspaceId === null) continue
    const parsed = j.materializedAt === null ? Number.NaN : Date.parse(j.materializedAt)
    const ms = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
    if (best !== null && ms <= bestMs) continue
    best = { jobId: j.id, workspaceId: j.materializedWorkspaceId }
    bestMs = ms
  }
  return best
}

/** Defensive /jobs row (passthrough JSON) → typed view. */
export function toJobView(row: unknown): JobView | null {
  if (row == null || typeof row !== "object") return null
  const r = row as Record<string, unknown>
  const id = str(r.id)
  if (!id) return null
  const kind =
    r.scheduleKind === "cron" || r.scheduleKind === "interval" ? r.scheduleKind : "unknown"

  const events = Array.isArray(r.events) ? r.events : []
  const last = events.length > 0 ? events[events.length - 1] : undefined
  let lastEvent: JobEventView | null = null
  if (last != null && typeof last === "object") {
    const e = last as Record<string, unknown>
    lastEvent = {
      at: dateOrNull(e.at),
      kind: str(e.kind, "unknown"),
      workspaceId:
        typeof e.workspaceId === "string" && e.workspaceId.length > 0 ? e.workspaceId : null,
    }
  }

  const trail = dispatchTrail(events)
  const newestSuccess = trail.find((t) => t.workspaceId !== null) ?? null

  return {
    id,
    name: str(r.name, id),
    schedule: str(r.schedule, "—"),
    scheduleKind: kind,
    intervalMs: num(r.intervalMs),
    description: r.description == null ? null : str(r.description),
    hasPayload: r.payload !== undefined && r.payload !== null,
    createdAt: dateOrNull(r.createdAt),
    lastTriggeredAt: dateOrNull(r.lastTriggeredAt),
    nextRunAt: dateOrNull(r.nextRunAt),
    triggerCount: num(r.triggerCount) ?? 0,
    lastEvent,
    materializedWorkspaceId: newestSuccess?.workspaceId ?? null,
    materializedAt: newestSuccess?.at ?? null,
    dispatchOutcome: trail.length > 0 ? (trail[0] ?? null) : null,
  }
}

/** Defensive /jobs response → ordered views. */
export function toJobViews(raw: unknown): JobView[] {
  if (raw == null || typeof raw !== "object") return []
  const jobs = (raw as { jobs?: unknown }).jobs
  if (!Array.isArray(jobs)) return []
  const views: JobView[] = []
  for (const row of jobs) {
    const view = toJobView(row)
    if (view !== null) views.push(view)
  }
  return views
}

/** Stable sort; null dates sink to the end regardless of direction. */
export function sortJobs(jobs: JobView[], key: JobSortKey, dir: "asc" | "desc" = "asc"): JobView[] {
  const factor = dir === "asc" ? 1 : -1
  return [...jobs].sort((a, b) => {
    if (key === "name") return factor * a.name.localeCompare(b.name)
    const av = key === "createdAt" ? a.createdAt : a.nextRunAt
    const bv = key === "createdAt" ? b.createdAt : b.nextRunAt
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    const diff = Date.parse(av) - Date.parse(bv)
    if (Number.isNaN(diff)) return 0
    return factor * diff
  })
}

/** Case-insensitive name/schedule filter. */
export function filterJobs(jobs: JobView[], query: string): JobView[] {
  const q = query.trim().toLowerCase()
  if (!q) return jobs
  return jobs.filter(
    (j) => j.name.toLowerCase().includes(q) || j.schedule.toLowerCase().includes(q),
  )
}

export interface Windowed<T> {
  items: T[]
  shown: number
  total: number
  hidden: number
}

/** Cap a list for render; the footer reports how many rows fold away. */
export function windowList<T>(items: T[], max: number): Windowed<T> {
  const total = items.length
  const capped = items.slice(0, Math.max(0, max))
  return { items: capped, shown: capped.length, total, hidden: Math.max(0, total - max) }
}

/**
 * Interval schedule → compact human form ("45s", "5m", "2.5h"). Units are
 * fixed symbols, not locale text. Returns null for non-interval rows.
 */
export function formatIntervalMs(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null
  if (ms < 60_000) {
    const s = ms / 1000
    return `${Number.isInteger(s) ? s : s.toFixed(1)}s`
  }
  if (ms < 3_600_000) {
    const m = ms / 60_000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}m`
  }
  const h = ms / 3_600_000
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}

/**
 * Dispatch kind of a create-form draft: "none" keeps the record-only
 * executor, "workspace" makes every fire enqueue a real BullMQ workspace
 * job carrying `message`.
 */
export type JobDraftKind = "none" | "workspace"

export interface JobDraft {
  name: string
  schedule: string
  description: string
  kind: JobDraftKind
  /** Required when kind = "workspace" — the instruction each fire carries. */
  message: string
  payloadJson: string
}

export const EMPTY_JOB_DRAFT: JobDraft = {
  name: "",
  schedule: "",
  description: "",
  kind: "none",
  message: "",
  payloadJson: "",
}

export type JobDraftError = {
  field: "name" | "schedule" | "message" | "payloadJson"
  key: string
} | null

/**
 * Client-side pre-validation mirroring the API contract. Schedule
 * semantics (cron/interval parse) stay server-side; the client checks
 * presence + payload JSON syntax + the kind=workspace message rule only.
 */
export function validateJobDraft(draft: JobDraft): JobDraftError {
  if (draft.name.trim().length === 0) return { field: "name", key: "jobs.errors.nameRequired" }
  if (draft.schedule.trim().length === 0) {
    return { field: "schedule", key: "jobs.errors.scheduleRequired" }
  }
  if (draft.kind === "workspace" && draft.message.trim().length === 0) {
    return { field: "message", key: "jobs.errors.messageRequired" }
  }
  if (draft.payloadJson.trim().length > 0) {
    if (parsePayloadJson(draft.payloadJson).ok === false) {
      return { field: "payloadJson", key: "jobs.errors.payloadInvalidJson" }
    }
  }
  return null
}

export type PayloadParseResult = { ok: true; value: unknown } | { ok: false; error: string }

/** Optional payload textarea → value for POST /jobs (empty = undefined). */
export function parsePayloadJson(text: string): PayloadParseResult {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Build the POST /jobs payload from a validated draft:
 *   kind "workspace" → { kind, message } (real BullMQ workspace dispatch);
 *   kind "none"      → the legacy free-form JSON textarea value, if any
 *                      (record-only, backward compatible).
 */
export function buildJobPayload(draft: JobDraft): PayloadParseResult {
  if (draft.kind === "workspace") {
    return { ok: true, value: { kind: "workspace", message: draft.message.trim() } }
  }
  return parsePayloadJson(draft.payloadJson)
}

export type SlotBadgeKind = "idle" | "pending" | "unknown"

/** Defensive /jobs/{id}/slots response → badge state. */
export function toSlotBadge(raw: unknown): SlotBadgeKind {
  if (raw == null || typeof raw !== "object") return "unknown"
  const hasPending = (raw as { hasPendingSlot?: unknown }).hasPendingSlot
  if (hasPending === true) return "pending"
  if (hasPending === false) return "idle"
  return "unknown"
}

/** ISO date → locale display, or "—" when missing/unparseable. */
export function formatTimestamp(iso: string | null): string {
  if (iso === null) return "—"
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return "—"
  return new Date(ms).toLocaleString()
}
