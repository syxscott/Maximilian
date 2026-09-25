// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the TUI Jobs dialog (mirrors the dashboard's
 * model/presentation discipline): input is a passthrough Job payload from
 * GET /api/jobs (fields may be missing or garbage — the API validates with
 * Zod but the TUI deliberately skips a second runtime check), output is a
 * typed view model the ink component just paints.
 *
 * Everything here is defensive and unit-testable; no React, no ink, no i18n
 * imports (the dialog translates the returned *keys*).
 */

import type { Job, JobEvent } from "../api"

// ── Relative time ────────────────────────────────────────────────────────────

/**
 * Compact relative time for `lastTriggeredAt`-style ISO instants.
 * Returns one of: "now" marker key ("just now"), "<n>s", "<n>m", "<n>n",
 * "<n>d" (the dialog renders them through t("tui.relative.ago")), or a
 * plain calendar date for anything older than 30 days. A null/undefined/
 * unparseable input yields null → the dialog shows t("tui.jobs.never").
 *
 * The unit suffix is a stable identifier (s/m/h/d), not prose — tests pin it
 * and the locale layer wraps it.
 */
export type RelativeTime =
  | { key: "now" }
  | { key: "ago"; value: number; unit: "s" | "m" | "h" | "d" }
  | { key: "date"; date: string }

export function relativeTime(iso: string | null | undefined, nowMs: number): RelativeTime | null {
  if (typeof iso !== "string" || iso.length === 0) return null
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  const deltaSeconds = Math.round((nowMs - then) / 1000)
  if (deltaSeconds < 60) return { key: "now" }
  const minutes = Math.floor(deltaSeconds / 60)
  if (minutes < 60) return { key: "ago", value: minutes, unit: "m" }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { key: "ago", value: hours, unit: "h" }
  const days = Math.floor(hours / 24)
  if (days < 30) return { key: "ago", value: days, unit: "d" }
  // Older than a month: an absolute date is more useful than "214d ago".
  return { key: "date", date: iso.slice(0, 10) }
}

/** Render a RelativeTime as the compact English fallback the tests pin. */
export function formatRelativeTime(rt: RelativeTime | null, neverLabel = "never"): string {
  if (rt === null) return neverLabel
  if (rt.key === "now") return "just now"
  if (rt.key === "date") return rt.date
  return `${rt.value}${rt.unit} ago`
}

// ── Schedule rendering ───────────────────────────────────────────────────────

/** Humanize an intervalMs ("every 30s" / "every 5m" / "every 2h" / "every 1d"). */
export function humanizeInterval(intervalMs: unknown): string {
  const ms = typeof intervalMs === "number" && Number.isFinite(intervalMs) ? intervalMs : 0
  if (ms <= 0) return "every ?"
  if (ms % 86_400_000 === 0) return `every ${ms / 86_400_000}d`
  if (ms % 3_600_000 === 0) return `every ${ms / 3_600_000}h`
  if (ms % 60_000 === 0) return `every ${ms / 60_000}m`
  return `every ${Math.round(ms / 1000)}s`
}

/** One-line schedule for the list row: cron expressions pass through. */
export function formatSchedule(job: Job): string {
  if (job.scheduleKind === "interval") return humanizeInterval(job.intervalMs)
  return typeof job.schedule === "string" ? job.schedule : "?"
}

// ── Status dot ───────────────────────────────────────────────────────────────

export type JobDotColor = "green" | "red" | "gray"
export type JobStatusKey = "armed" | "stalled" | "idle"

export interface JobStatusView {
  color: JobDotColor
  /** i18n key suffix under "tui.jobs.status.*" — the dialog translates it. */
  statusKey: JobStatusKey
}

/**
 * Honest, event-derived status for the row's colored dot:
 *   red   "stalled" — the latest trail entry is a dispatch-failed (the last
 *                     fire never got enqueued)
 *   gray  "idle"    — no schedulable next run (unparseable schedule)
 *   green "armed"   — a nextRunAt exists; the scheduler will fire it
 */
export function jobStatusView(job: Job): JobStatusView {
  const events = Array.isArray(job?.events) ? job.events : []
  const latest = events.length > 0 ? events[events.length - 1] : undefined
  if (latest != null && typeof latest === "object" && latest.kind === "dispatch-failed") {
    return { color: "red", statusKey: "stalled" }
  }
  if (job?.nextRunAt == null) {
    return { color: "gray", statusKey: "idle" }
  }
  return { color: "green", statusKey: "armed" }
}

// ── Payload + details ────────────────────────────────────────────────────────

export type PayloadKind = "workspace" | "none" | "legacy" | "unknown"

/**
 * Defensive read side of a stored payload (mirrors the API's
 * asDispatchPayload): a fully-valid { kind: "workspace", message } is a real
 * dispatch; kind "none" (or absent) is record-only; an object without kind is
 * a legacy v0 record-only payload; everything else is unknown.
 */
export function payloadKind(payload: unknown): PayloadKind {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return "none"
  }
  const kind = (payload as { kind?: unknown }).kind
  if (kind === "workspace") {
    const message = (payload as { message?: unknown }).message
    return typeof message === "string" && message.trim().length > 0 ? "workspace" : "unknown"
  }
  if (kind === "none") return "none"
  if (kind === undefined) return "legacy"
  return "unknown"
}

/** i18n key suffix under "tui.jobs.payload*" for a PayloadKind. */
export function payloadLabelKey(kind: PayloadKind): string {
  switch (kind) {
    case "workspace":
      return "tui.jobs.payload.workspace"
    case "none":
      return "tui.jobs.payloadNone"
    case "legacy":
      return "tui.jobs.payloadLegacy"
    default:
      return "tui.jobs.payloadUnknown"
  }
}

// ── Trigger-history view (expanded detail) ───────────────────────────────────

/**
 * The event kinds the API actually writes (apps/api job trail). Anything
 * else is rendered as its raw string — the list is a rendering aid, not a
 * validator, so a future kind degrades to visible text instead of a key.
 */
export const JOB_EVENT_KINDS = [
  "scheduled-trigger",
  "manual-trigger",
  "dispatched",
  "dispatch-failed",
  "materialized",
] as const

/**
 * Localization route for a trail entry's kind: known kinds map to the
 * "tui.jobs.event.<kind>" key; unknown/garbage kinds come back with
 * known === false so the dialog prints the raw kind verbatim (honest) —
 * never a bare i18n key, never a console.warn from the dictionary.
 */
export function jobEventKindLabel(kind: unknown): { key: string; known: boolean } {
  const raw = typeof kind === "string" && kind.trim().length > 0 ? kind : "unknown"
  return {
    key: `tui.jobs.event.${raw}`,
    known: (JOB_EVENT_KINDS as readonly string[]).includes(raw),
  }
}

/**
 * The most recent trail entries for the expanded detail view, newest first.
 * Defensive: a garbage events array yields [].
 */
export function jobDetailEvents(job: Job, limit = 3): JobEvent[] {
  const events = Array.isArray(job?.events) ? job.events : []
  return events.slice(-limit).reverse()
}

/**
 * "12:34 kind — note" one-liner for a trail entry (defensive).
 *
 * Deepened for the trigger-history view without breaking the pinned compact
 * form: an optional `nowMs` appends a relative marker ("(5m ago)") after the
 * note, and an optional `kindLabel` replaces the raw kind with its localized
 * label (the dialog passes t(jobEventKindLabel(kind).key) for known kinds).
 * Garbage in any field degrades that field only.
 */
export function formatJobEvent(event: JobEvent, nowMs?: number, kindLabel?: string): string {
  const at = typeof event?.at === "string" ? event.at.slice(11, 19) : "??:??:??"
  const kind =
    typeof kindLabel === "string" && kindLabel.length > 0
      ? kindLabel
      : typeof event?.kind === "string" && event.kind.length > 0
        ? event.kind
        : "unknown"
  const note = typeof event?.note === "string" && event.note.length > 0 ? ` — ${event.note}` : ""
  const rt =
    typeof nowMs === "number" && Number.isFinite(nowMs) ? relativeTime(event?.at, nowMs) : null
  const rel = rt !== null ? ` (${formatRelativeTime(rt)})` : ""
  return `${at} ${kind}${note}${rel}`
}

// ── Next-fire estimate (honest, no cron math) ────────────────────────────────

/**
 * What can honestly be said about when a job fires next, derived from the
 * RAW schedule string (the API stores exactly what was provided):
 *   - pure digits      → an intervalMs; rounded to whole seconds and
 *                        humanized ("every 30s") — that IS the estimate
 *   - 5 cron fields    → labeled "cron" with the expression passed through;
 *                        NO concrete time is computed (a real cron parser
 *                        would be a lie at this layer) — the dialog renders
 *                        the estimate.cron disclosure next to it
 *   - otherwise        → falls back to a positive numeric intervalMs field,
 *                        else "unknown" ("?")
 */
export type ScheduleEstimate =
  | { kind: "interval"; intervalMs: number; label: string }
  | { kind: "cron"; label: string }
  | { kind: "unknown"; label: string }

export function scheduleEstimate(job: Job): ScheduleEstimate {
  const raw = typeof job?.schedule === "string" ? job.schedule.trim() : ""
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw)
    if (Number.isFinite(ms) && ms > 0) {
      const intervalMs = Math.round(ms / 1000) * 1000 // whole-second honesty
      return { kind: "interval", intervalMs, label: humanizeInterval(intervalMs) }
    }
  }
  if (raw.split(/\s+/).length === 5 && raw.length > 0) {
    return { kind: "cron", label: raw }
  }
  const fallbackMs = typeof job?.intervalMs === "number" ? job.intervalMs : 0
  if (Number.isFinite(fallbackMs) && fallbackMs > 0) {
    return { kind: "interval", intervalMs: fallbackMs, label: humanizeInterval(fallbackMs) }
  }
  return { kind: "unknown", label: "?" }
}

// ── Refresh hint ─────────────────────────────────────────────────────────────

/**
 * Whole seconds since the dialog last refreshed (for the "updated Ns ago ·
 * r refresh" hint). Clock skew is clamped to 0; garbage in either operand
 * yields null so the dialog can hide the hint instead of guessing.
 */
export function elapsedSeconds(fromMs: unknown, toMs: unknown): number | null {
  if (typeof fromMs !== "number" || !Number.isFinite(fromMs)) return null
  if (typeof toMs !== "number" || !Number.isFinite(toMs)) return null
  return Math.max(0, Math.round((toMs - fromMs) / 1000))
}

// ── Materialization chain ────────────────────────────────────────────────────

/**
 * The workspace a fire of this job materialized into, defensively derived:
 *   1. a non-empty top-level `materializedWorkspaceId` wins (a future API
 *      may promote the backfill onto the row — the field is typed optional
 *      in ../api for exactly that reason)
 *   2. otherwise the newest trail entry carrying a non-empty `workspaceId`
 *      (the `materialized` backfill the worker publishes through the API;
 *      same newest-first semantics as the dashboard's jobs model)
 * A rejected/failed materialization appends a trail entry WITHOUT a
 * workspaceId (only an error), so it naturally yields null — no chip for a
 * failure. Garbage rows (null/undefined/non-object) yield null too.
 */
export function materializedWorkspaceIdOf(job: Job | null | undefined): string | null {
  if (job == null || typeof job !== "object") return null
  const top = (job as { materializedWorkspaceId?: unknown }).materializedWorkspaceId
  if (typeof top === "string" && top.trim().length > 0) return top
  const events = Array.isArray(job.events) ? job.events : []
  for (let i = events.length - 1; i >= 0; i--) {
    const entry = events[i]
    if (entry == null || typeof entry !== "object") continue
    const id = (entry as { workspaceId?: unknown }).workspaceId
    if (typeof id === "string" && id.trim().length > 0) return id
  }
  return null
}

/**
 * Delays (ms) at which the dialog re-pulls GET /api/jobs after a manual
 * trigger. Materialization is asynchronous (worker → Redis → API trail
 * backfill), so the immediate refresh usually shows only the `dispatched`
 * entry; +2s and +5s catch the `materialized` backfill without busy-
 * polling. Pure so the cadence is pinned by tests and tunable in one place.
 */
export function pendingRefreshDelays(): [number, number] {
  return [2000, 5000]
}

/**
 * Defensive read of a `job-materialized` SSE payload (the worker's
 * jobId→workspaceId announcement) into what the dialog's inline hint needs:
 * { jobId, workspaceId }. workspaceId is null when the event announces a
 * FAILED materialization. Returns null for anything without a usable jobId
 * — garbage degrades to "no hint", never to an invented one.
 */
export function materializationEventTarget(
  event: unknown,
): { jobId: string; workspaceId: string | null } | null {
  if (event == null || typeof event !== "object") return null
  const jobId = (event as { jobId?: unknown }).jobId
  if (typeof jobId !== "string" || jobId.trim().length === 0) return null
  const workspaceId = (event as { workspaceId?: unknown }).workspaceId
  return {
    jobId,
    workspaceId:
      typeof workspaceId === "string" && workspaceId.trim().length > 0 ? workspaceId : null,
  }
}

/**
 * Row chip label for a materialized workspace id: short ids pass through,
 * long ones truncate with an ellipsis so the list row survives an
 * 80-column terminal. Garbage degrades to "?" (the schedule "?" convention).
 */
export function workspaceChipLabel(id: unknown): string {
  const clean = typeof id === "string" ? id.trim() : ""
  if (clean.length === 0) return "?"
  return clean.length > 24 ? `${clean.slice(0, 21)}…` : clean
}
