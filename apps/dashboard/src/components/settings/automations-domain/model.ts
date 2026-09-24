// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the automations domain: an automation IS a real
 * job (shared /jobs API) whose name carries the `automation:` prefix.
 *
 * The API has no dedicated enabled field, so the card switch maps onto
 * the job lifecycle itself and every state is re-derived from
 * GET /jobs — never trusted locally:
 *
 *   ON   → job present with payload.enabled !== false
 *   OFF  → job present with payload.enabled === false
 *
 * Flipping the switch rebuilds the job (DELETE + POST — the v0 API has
 * no update route) with an `enabled` marker merged into the payload.
 * The marker is the contract the executor uses to skip disabled jobs;
 * v0 dispatch is record-only, so nothing executes either way yet. A
 * rebuild that half-applies (delete ok, create failed) is rolled back
 * by recreating the pre-toggle job (`restore` in TogglePlan).
 */

import { toJobView, type JobView } from "../jobs-domain/model"

export const AUTOMATION_NAME_PREFIX = "automation:"
/** Server-side name limit (JobCreateSchema: max 120 chars). */
export const AUTOMATION_NAME_MAX = 120
/** Server-side minimum interval (parseSchedule: >= 1000ms). */
export const AUTOMATION_MIN_INTERVAL_MS = 1_000

export interface AutomationView extends JobView {
  /** Name without the `automation:` prefix. */
  bareName: string
  /** Raw payload from the job record (marker lives here). */
  payload: unknown
  /** Derived from the payload marker — NOT local UI state. */
  enabled: boolean
}

/** Force the `automation:` prefix onto a user-entered name (idempotent). */
export function automationName(bare: string): string {
  const name = bare.trim()
  return name.startsWith(AUTOMATION_NAME_PREFIX) ? name : AUTOMATION_NAME_PREFIX + name
}

/** Strip the prefix; null when the name is not an automation. */
export function stripAutomationPrefix(name: string): string | null {
  return name.startsWith(AUTOMATION_NAME_PREFIX) ? name.slice(AUTOMATION_NAME_PREFIX.length) : null
}

/**
 * Enabled marker lookup. Only an explicit `enabled: false` inside an
 * object payload disables; garbage / missing payloads read as enabled
 * (matches how a freshly created automation behaves).
 */
export function isAutomationEnabled(payload: unknown): boolean {
  if (payload == null || typeof payload !== "object") return true
  return (payload as { enabled?: unknown }).enabled !== false
}

/** GET /jobs response → automation views (prefix filter + derived state). */
export function toAutomationViews(raw: unknown): AutomationView[] {
  if (raw == null || typeof raw !== "object") return []
  const jobs = (raw as { jobs?: unknown }).jobs
  if (!Array.isArray(jobs)) return []
  const views: AutomationView[] = []
  for (const row of jobs) {
    const view = toJobView(row)
    if (view === null) continue
    const bareName = stripAutomationPrefix(view.name)
    if (bareName === null) continue
    const payload = (row as { payload?: unknown }).payload
    views.push({ ...view, bareName, payload, enabled: isAutomationEnabled(payload) })
  }
  return views
}

/** Case-insensitive filter over full and bare names (empty = everything). */
export function filterAutomations(automations: AutomationView[], query: string): AutomationView[] {
  const q = query.trim().toLowerCase()
  if (!q) return automations
  return automations.filter(
    (a) => a.name.toLowerCase().includes(q) || a.bareName.toLowerCase().includes(q),
  )
}

/** Summary counts for the header row. */
export function automationSummary(automations: AutomationView[]): {
  total: number
  enabled: number
  disabled: number
} {
  const enabled = automations.filter((a) => a.enabled).length
  return { total: automations.length, enabled, disabled: automations.length - enabled }
}

// ── Create dialog ────────────────────────────────────────────────────────────

export interface AutomationDraft {
  name: string
  schedule: string
  description: string
}

export const EMPTY_AUTOMATION_DRAFT: AutomationDraft = { name: "", schedule: "", description: "" }

export type AutomationDraftError = { field: "name" | "schedule"; key: string } | null

/**
 * Basic client-side schedule check mirroring the API contract: pure
 * digits are intervalMs (>= 1000), anything else must be a 5-field cron
 * expression. Deeper cron field validation stays server-side — its error
 * text is echoed verbatim into the dialog.
 */
export function validateScheduleText(schedule: string): AutomationDraftError {
  const trimmed = schedule.trim()
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed)
    if (!Number.isSafeInteger(ms) || ms < AUTOMATION_MIN_INTERVAL_MS) {
      return { field: "schedule", key: "automations.errors.intervalTooShort" }
    }
    return null
  }
  if (trimmed.split(/\s+/).length !== 5) {
    return { field: "schedule", key: "automations.errors.cronFields" }
  }
  return null
}

/**
 * Dialog pre-validation (presence, forced-prefix name length, basic
 * schedule shape). Schedule semantics stay server-side, same split as
 * the jobs domain.
 */
export function validateAutomationDraft(draft: AutomationDraft): AutomationDraftError {
  const name = draft.name.trim()
  if (name.length === 0) return { field: "name", key: "automations.errors.nameRequired" }
  if (automationName(name).length > AUTOMATION_NAME_MAX) {
    return { field: "name", key: "automations.errors.nameTooLong" }
  }
  const schedule = draft.schedule.trim()
  if (schedule.length === 0)
    return { field: "schedule", key: "automations.errors.scheduleRequired" }
  return validateScheduleText(schedule)
}

/** i18n key describing the trigger cadence of one automation. */
export function triggerLabelKey(automation: AutomationView): string {
  return automation.scheduleKind === "cron"
    ? "automations.trigger.cron"
    : automation.scheduleKind === "interval"
      ? "automations.trigger.interval"
      : "automations.trigger.unknown"
}

// ── Switch ↔ job lifecycle ───────────────────────────────────────────────────

/** Body for POST /jobs (payload omitted when there is none). */
export interface AutomationCreateInput {
  name: string
  schedule: string
  description?: string
  payload?: unknown
}

export type TogglePlan =
  | { action: "none" }
  | {
      action: "rebuild"
      /** DELETE target — the current job record. */
      deleteId: string
      /** POST replacement with the marker flipped to the next state. */
      create: AutomationCreateInput
      /** POST recreating the pre-toggle job if the rebuild half-applies. */
      restore: AutomationCreateInput
    }

function createInputFromView(view: AutomationView, payload: unknown): AutomationCreateInput {
  return {
    name: view.name,
    schedule: view.schedule,
    ...(view.description !== null ? { description: view.description } : {}),
    ...(payload !== undefined ? { payload } : {}),
  }
}

/**
 * Pure switch-flip plan. Enabling an already-enabled (or disabling an
 * already-disabled) automation is a no-op; otherwise the job is rebuilt
 * with `payload.enabled` set to the next state, preserving the user's
 * other payload fields, name, schedule and description.
 */
export function planToggle(view: AutomationView, next: boolean): TogglePlan {
  if (view.enabled === next) return { action: "none" }
  const base =
    view.payload != null && typeof view.payload === "object"
      ? { ...(view.payload as Record<string, unknown>) }
      : {}
  return {
    action: "rebuild",
    deleteId: view.id,
    create: createInputFromView(view, { ...base, enabled: next }),
    restore: createInputFromView(view, view.payload),
  }
}

// ── Trigger history (expansion panel) ────────────────────────────────────────

export type AutomationSlotKind = "idle" | "pending" | "unknown"

export interface AutomationSlotView {
  kind: AutomationSlotKind
  /** scheduledAt of the pending slot, when the server sent one. */
  scheduledAt: string | null
}

/** Defensive GET /jobs/{id}/slots response → expansion-panel state. */
export function toAutomationSlotView(raw: unknown): AutomationSlotView {
  if (raw == null || typeof raw !== "object") return { kind: "unknown", scheduledAt: null }
  const hasPending = (raw as { hasPendingSlot?: unknown }).hasPendingSlot
  const kind: AutomationSlotKind =
    hasPending === true ? "pending" : hasPending === false ? "idle" : "unknown"
  if (kind !== "pending") return { kind, scheduledAt: null }
  const slot = (raw as { slot?: unknown }).slot
  const scheduledAt =
    slot != null && typeof slot === "object"
      ? typeof (slot as { scheduledAt?: unknown }).scheduledAt === "string"
        ? (slot as { scheduledAt: string }).scheduledAt
        : null
      : null
  return { kind, scheduledAt }
}
