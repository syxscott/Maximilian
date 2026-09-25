// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the TUI Cron panel: cron-expression validation and
 * the "which jobs are cron-scheduled" filter over GET /api/jobs payloads.
 *
 * The API accepts any schedule string (a 5-field cron expression OR a plain
 * digit intervalMs) — telling the two apart and refusing broken expressions
 * is the client's job, so this module is the single source of truth for both
 * the list filter and the create-form validation. No React, no ink, no i18n
 * imports (validation failures return *label keys*, the panel translates).
 */

import type { Job } from "../api"

// ── Field grammar ────────────────────────────────────────────────────────────

export interface CronFieldRule {
  /** i18n key suffix under "tui.cron.field.*". */
  name: string
  min: number
  max: number
}

/**
 * The five vixie-style fields. Day-of-week allows 0-7 (both Sundays), the
 * same honesty the scheduler's parse side applies.
 */
export const CRON_FIELDS: readonly CronFieldRule[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dayOfMonth", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "dayOfWeek", min: 0, max: 7 },
]

/** One field atom: wildcard `*`, `n`, `n-step`, optionally with a `/step` suffix. */
const FIELD_ATOM = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/

function isValidCronField(raw: string, rule: CronFieldRule): boolean {
  if (raw.length === 0) return false
  return raw.split(",").every((atom) => {
    const match = FIELD_ATOM.exec(atom)
    if (match == null) return false
    const range = match[1]!
    const step = match[2]
    if (step !== undefined) {
      const s = Number(step)
      // Leading zeros are fine; fractions/negatives never reach the regex.
      if (!Number.isInteger(s) || s < 1 || s > rule.max - rule.min + 1) return false
    }
    if (range === "*") return true
    if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number)
      return a >= rule.min && b <= rule.max && a <= b
    }
    const n = Number(range)
    return n >= rule.min && n <= rule.max
  })
}

/**
 * Validate a 5-field cron expression (the only cron shape the API stores):
 *   - input must be a non-empty string with exactly 5 whitespace-separated
 *     fields
 *   - each field is a comma list of atoms — wildcard star, a number, or a
 *     "n-m" range — each optionally followed by a "/step" suffix
 *   - numbers must sit inside the field's range; steps are positive integers
 *
 * Pure digits ("300000") are an intervalMs, NOT cron — one field → false.
 */
export function isValidCron(expr: unknown): boolean {
  return cronValidationError(expr) === null
}

export interface CronFieldError {
  /** i18n key "tui.cron.field.<name>" of the first offending field. */
  fieldKey: string
  index: number
}

/**
 * Why an expression is invalid, as the FIRST offending field (left-to-right
 * — enough for a one-line form error), or null when it is a valid 5-field
 * cron. A wrong field count reports against the closest existing field.
 */
export function cronValidationError(expr: unknown): CronFieldError | null {
  if (typeof expr !== "string") return { fieldKey: "tui.cron.field.minute", index: 0 }
  const fields = expr
    .trim()
    .split(/\s+/)
    .filter((f) => f.length > 0)
  if (fields.length !== CRON_FIELDS.length) {
    const index = Math.min(fields.length - 1, CRON_FIELDS.length - 1)
    const name = CRON_FIELDS[Math.max(0, index)]!.name
    return { fieldKey: `tui.cron.field.${name}`, index: Math.max(0, index) }
  }
  for (let i = 0; i < CRON_FIELDS.length; i++) {
    const rule = CRON_FIELDS[i]!
    if (!isValidCronField(fields[i]!, rule)) {
      return { fieldKey: `tui.cron.field.${rule.name}`, index: i }
    }
  }
  return null
}

// ── List filter (cron jobs only — digit intervals live in the Jobs dialog) ──

/**
 * Is this passthrough job a cron-scheduled one? True when the raw schedule
 * is a valid 5-field cron expression; pure-digit intervalMs schedules are
 * explicitly excluded (they belong to the Jobs dialog). Garbage jobs are
 * never cron.
 */
export function isCronJob(job: unknown): boolean {
  if (job == null || typeof job !== "object") return false
  const schedule = (job as { schedule?: unknown }).schedule
  if (typeof schedule !== "string") return false
  if (/^\d+$/.test(schedule.trim())) return false // intervalMs, not cron
  return isValidCron(schedule)
}

/**
 * The cron subset of a job list, preserving the API's order (newest first).
 * Defensive: a garbage payload contributes nothing.
 */
export function filterCronJobs(jobs: unknown): Job[] {
  if (!Array.isArray(jobs)) return []
  return jobs.filter(isCronJob) as Job[]
}

// ── Create-form helper ──────────────────────────────────────────────────────

/**
 * The POST /api/jobs body for the create form: kind "workspace" dispatch
 * with the user's message (the real BullMQ producer path — backend round 7).
 */
export function cronJobCreateInput(name: string, schedule: string, message: string) {
  return {
    name: name.trim(),
    schedule: schedule.trim(),
    payload: { kind: "workspace" as const, message: message.trim() },
  }
}
