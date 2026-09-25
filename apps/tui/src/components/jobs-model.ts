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

/**
 * The most recent trail entries for the expanded detail view, newest first.
 * Defensive: a garbage events array yields [].
 */
export function jobDetailEvents(job: Job, limit = 3): JobEvent[] {
  const events = Array.isArray(job?.events) ? job.events : []
  return events.slice(-limit).reverse()
}

/** "12:34 kind — note" one-liner for a trail entry (defensive). */
export function formatJobEvent(event: JobEvent): string {
  const at = typeof event?.at === "string" ? event.at.slice(11, 19) : "??:??:??"
  const kind = typeof event?.kind === "string" ? event.kind : "unknown"
  const note = typeof event?.note === "string" && event.note.length > 0 ? ` — ${event.note}` : ""
  return `${at} ${kind}${note}`
}
