// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the jobs domain: defensive normalization of the
 * /jobs payload into typed row views, sort/filter helpers, schedule
 * formatting and draft validation. The backend JSON is passthrough —
 * every field read here guards its shape (subagents-domain pattern).
 */

export interface JobEventView {
  at: string | null
  kind: string
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
    lastEvent = { at: dateOrNull(e.at), kind: str(e.kind, "unknown") }
  }

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

export interface JobDraft {
  name: string
  schedule: string
  description: string
  payloadJson: string
}

export const EMPTY_JOB_DRAFT: JobDraft = {
  name: "",
  schedule: "",
  description: "",
  payloadJson: "",
}

export type JobDraftError = { field: "name" | "schedule" | "payloadJson"; key: string } | null

/**
 * Client-side pre-validation mirroring the API contract. Schedule
 * semantics (cron/interval parse) stay server-side; the client checks
 * presence + payload JSON syntax only.
 */
export function validateJobDraft(draft: JobDraft): JobDraftError {
  if (draft.name.trim().length === 0) return { field: "name", key: "jobs.errors.nameRequired" }
  if (draft.schedule.trim().length === 0) {
    return { field: "schedule", key: "jobs.errors.scheduleRequired" }
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
