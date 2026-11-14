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

import { formatRelative } from "@max/i18n"
import { getFutureMatches } from "@datasert/cronjs-matcher"
import cronstrue from "cronstrue/i18n"
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
  /** Raw per-job event log from the GET /jobs row (newest last). */
  events: unknown
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
    const events = (row as { events?: unknown }).events
    views.push({ ...view, bareName, payload, enabled: isAutomationEnabled(payload), events })
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

/**
 * Inline manual-trigger feedback auto-dismisses after this long — the
 * slot panel and lastTriggeredAt refresh through the useTriggerJob
 * query invalidations, so nothing here needs a second fetch.
 */
export const TRIGGER_FEEDBACK_MS = 3_000

// ── Slots panel ──────────────────────────────────────────────────────────────

export type AutomationSlotStatus = "pending" | "cleared" | "unknown"

/** One structured row of the slots panel (the API exposes one slot per job). */
export interface AutomationSlotRow {
  status: AutomationSlotStatus
  /** Slot key minus the `job:` namespace prefix (falls back to the job id). */
  keyTail: string
  scheduledAt: string | null
  scheduledAtRelative: string | null
  /** When the slot was stamped (PendingSlotRecord.at). */
  updatedAt: string | null
  updatedAtRelative: string | null
}

/** `job:job_ab12` → `job_ab12`; foreign keys pass through untouched. */
export function slotKeyTail(key: unknown, fallback: string): string {
  if (typeof key !== "string" || key.length === 0) return fallback
  const tail = key.startsWith("job:") ? key.slice("job:".length) : key
  return tail.length > 0 ? tail : fallback
}

/** ISO string → locale relative time; null when missing/unparseable. */
function relativeTime(iso: string | null, now: Date | number): string | null {
  if (iso === null) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return formatRelative(new Date(ms), now)
}

/**
 * Defensive GET /jobs/{id}/slots response → slots-panel rows. The API
 * holds a single slot per job: `pending` while a fire is in flight,
 * `cleared` otherwise — the cleared/unknown rows are synthesized from
 * the job id (the key is always `job:{id}`) because the server answers
 * without a slot record once the slot is released.
 */
export function toAutomationSlotRows(
  raw: unknown,
  jobId: string,
  now: Date | number = Date.now(),
): AutomationSlotRow[] {
  const keyTail = slotKeyTail(`job:${jobId}`, jobId)
  const bareTimes = {
    scheduledAt: null,
    scheduledAtRelative: null,
    updatedAt: null,
    updatedAtRelative: null,
  }
  if (raw == null || typeof raw !== "object") {
    return [{ ...bareTimes, status: "unknown", keyTail }]
  }
  const hasPendingSlot = (raw as { hasPendingSlot?: unknown }).hasPendingSlot
  if (hasPendingSlot !== true) {
    return [{ ...bareTimes, keyTail, status: hasPendingSlot === false ? "cleared" : "unknown" }]
  }
  const slot = (raw as { slot?: unknown }).slot
  if (slot == null || typeof slot !== "object") {
    return [{ ...bareTimes, keyTail, status: "pending" }]
  }
  const s = slot as Record<string, unknown>
  const strOrNull = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null
  const scheduledAt = strOrNull(s.scheduledAt)
  const updatedAt = strOrNull(s.at)
  return [
    {
      status: "pending",
      keyTail: slotKeyTail(s.key, keyTail),
      scheduledAt,
      scheduledAtRelative: relativeTime(scheduledAt, now),
      updatedAt,
      updatedAtRelative: relativeTime(updatedAt, now),
    },
  ]
}

/** Status → i18n key for the badge label. */
export function slotStatusLabelKey(status: AutomationSlotStatus): string {
  return status === "pending"
    ? "automations.slot.pending"
    : status === "cleared"
      ? "automations.slot.cleared"
      : "automations.slot.unknown"
}

// ── Event log views ──────────────────────────────────────────────────────────

export interface AutomationEventView {
  at: string | null
  atRelative: string | null
  /** Raw server kind (manual/scheduled/recovered-trigger). */
  kind: string
  labelKey: string
  note: string | null
}

/** Server TriggerKind → i18n key for the human label. */
export function eventKindLabelKey(kind: unknown): string {
  switch (kind) {
    case "manual-trigger":
      return "automations.event.manual"
    case "scheduled-trigger":
      return "automations.event.scheduled"
    case "recovered-trigger":
      return "automations.event.recovered"
    default:
      return "automations.event.unknown"
  }
}

/**
 * Raw per-job event log (GET /jobs rows carry it; append-only, newest
 * LAST server-side) → defensive views ordered newest-first for the
 * history timeline.
 */
export function toAutomationEventViews(
  raw: unknown,
  now: Date | number = Date.now(),
): AutomationEventView[] {
  if (!Array.isArray(raw)) return []
  const views: AutomationEventView[] = []
  for (const entry of raw) {
    if (entry == null || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const at = typeof e.at === "string" && e.at.length > 0 ? e.at : null
    views.push({
      at,
      atRelative: relativeTime(at, now),
      kind: typeof e.kind === "string" ? e.kind : "unknown",
      labelKey: eventKindLabelKey(e.kind),
      note: typeof e.note === "string" && e.note.length > 0 ? e.note : null,
    })
  }
  return views.reverse()
}

/**
 * TimelineMini input for the history panel: one completed entry per
 * recorded fire, labeled with the kind (+ note when present) and the
 * relative time. `kindLabel` translates an event's labelKey.
 */
export function automationTimelineInput(
  events: AutomationEventView[],
  kindLabel: (labelKey: string) => string,
): { items: Array<{ label: string; time?: string; status: string }> } {
  return {
    items: events.map((e) => ({
      label: e.note !== null ? `${kindLabel(e.labelKey)} · ${e.note}` : kindLabel(e.labelKey),
      ...(e.atRelative !== null ? { time: e.atRelative } : {}),
      status: "completed",
    })),
  }
}

// ── Event kind filter (history chips) ────────────────────────────────────────

/** The history panel's filter chips: all events, or one trigger kind. */
export type JobEventKindFilter = "all" | "manual" | "scheduled" | "recovered"

/** Chip order + their i18n label keys (rendered as filter buttons). */
export const JOB_EVENT_FILTER_CHIPS: Array<{
  kind: JobEventKindFilter
  labelKey: string
}> = [
  { kind: "all", labelKey: "automations.filter.all" },
  { kind: "manual", labelKey: "automations.filter.manual" },
  { kind: "scheduled", labelKey: "automations.filter.scheduled" },
  { kind: "recovered", labelKey: "automations.filter.recovered" },
]

/**
 * Kind-chip filter over the (newest-first) event views: "all" passes the
 * list through untouched; a chip maps onto the server TriggerKind
 * (`manual` → `manual-trigger`, …), so unknown raw kinds stay visible
 * only under "all" instead of silently disappearing. Order is preserved
 * — the newest-first sort from toAutomationEventViews survives filtering.
 */
export function filterJobEvents(
  events: AutomationEventView[],
  kind: JobEventKindFilter,
): AutomationEventView[] {
  if (!Array.isArray(events)) return []
  if (kind === "all") return events
  const raw = `${kind}-trigger`
  return events.filter((e) => e.kind === raw)
}

// ── Cron editing suite (conductor scheduler borrowing) ──────────────────────

/**
 * Per-field accent colors for 5-field cron expressions. Conductor's
 * `CRON_COLORS_BY_POSITION` colors the SIX Quartz slots (second minute
 * hour dom mon dow); our expressions have no seconds field, so the array
 * is re-indexed to slots 1..5 and re-trimmed to five entries — otherwise
 * every field would render one position too late.
 */
export const CRON_FIELD_COLORS: readonly string[] = [
  "#6569AC", // minute
  "#45AC59", // hour
  "#C99E00", // day of month
  "#EE6B31", // month
  "#CE2836", // day of week
]

/** Field help entries in expression order (CronExpressionHelp borrowing). */
export const CRON_FIELD_HELP: ReadonlyArray<{ key: string; color: string }> = [
  { key: "automations.cron.field.minute", color: CRON_FIELD_COLORS[0] },
  { key: "automations.cron.field.hour", color: CRON_FIELD_COLORS[1] },
  { key: "automations.cron.field.dom", color: CRON_FIELD_COLORS[2] },
  { key: "automations.cron.field.mon", color: CRON_FIELD_COLORS[3] },
  { key: "automations.cron.field.dow", color: CRON_FIELD_COLORS[4] },
]

/**
 * Ready-made 5-field expressions for the template dropdown. Unlike
 * conductor's CRON_SAMPLES (Quartz with seconds + `?` wildcards) these are
 * plain 5-field crons the server accepts directly.
 */
export const CRON_TEMPLATES: ReadonlyArray<{ expr: string; labelKey: string }> = [
  { expr: "*/5 * * * *", labelKey: "automations.cron.template.every5" },
  { expr: "0 * * * *", labelKey: "automations.cron.template.hourly" },
  { expr: "0 9 * * MON-FRI", labelKey: "automations.cron.template.weekdayMorning" },
  { expr: "30 8 1 * *", labelKey: "automations.cron.template.monthlyFirst" },
  { expr: "0 0 * * 0", labelKey: "automations.cron.template.sundayMidnight" },
]

/**
 * Cursor position → cron field index (conductor `getHighlightedPart`
 * borrowing). Splits everything before the caret on whitespace and clamps
 * to the five fields, so a caret sitting in the trailing space after a
 * field keeps that field highlighted.
 */
export function cursorToFieldIndex(value: string, selectionStart: number): number {
  const before = value.slice(0, Math.max(0, selectionStart))
  const parts = before.split(/\s+/).filter((part) => part.length > 0)
  return Math.min(parts.length === 0 ? 0 : parts.length - 1, 4)
}

/** How many future runs the preview shows. */
export const SCHEDULE_PREVIEW_RUN_COUNT = 10

/**
 * Intervals this chatty (< 1 min) surface as a soft — not hard — issue:
 * the server accepts them, but they hammer the queue.
 */
export const AUTOMATION_CHATTY_INTERVAL_MS = 60_000

/** One business-level (non-blocking) schedule concern. */
export interface ScheduleSoftIssue {
  key: string
  params?: Record<string, string | number>
}

/**
 * Soft validation (cc-switch ProviderForm borrowing): collect the
 * business-concern list that should NOT block submission, only confirm
 * it. Today: sub-minute intervals, and the standard-cron gotcha where a
 * restricted day-of-month AND day-of-week OR together (most users expect
 * AND).
 */
export function collectScheduleSoftIssues(schedule: string): ScheduleSoftIssue[] {
  const trimmed = schedule.trim()
  const issues: ScheduleSoftIssue[] = []
  if (trimmed.length === 0) return issues
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed)
    if (Number.isSafeInteger(ms) && ms >= AUTOMATION_MIN_INTERVAL_MS) {
      if (ms < AUTOMATION_CHATTY_INTERVAL_MS) {
        issues.push({
          key: "automations.softIssues.chattyInterval",
          params: { seconds: Math.round(ms / 1000) },
        })
      }
      return issues
    }
  }
  const fields = trimmed.split(/\s+/)
  if (fields.length === 5 && fields[2] !== "*" && fields[4] !== "*") {
    issues.push({ key: "automations.softIssues.domDowBoth" })
  }
  return issues
}

/** Result of the advisory schedule preview shown under the input. */
export interface SchedulePreview {
  kind: "cron" | "interval" | "invalid"
  /** i18n key of the hard-validation failure; null when parseable. */
  errorKey: string | null
  /** Raw parser detail (cronstrue/cronjs message) for the error line. */
  errorDetail: string | null
  /** cronstrue human description (cron only, null otherwise). */
  description: string | null
  /** Next fire instants as epoch ms, UTC-sorted, at most 10 entries. */
  nextRuns: number[]
}

/**
 * Pure schedule preview: validates against the same shape rules as
 * {@link validateScheduleText} (pure digits = intervalMs ≥ 1000, else
 * exactly 5 cron fields), then computes the next runs — cron via
 * `@datasert/cronjs-matcher` (5 fields ⇒ `hasSeconds: false`, our
 * expressions never carry a seconds slot) and intervalMs via a local loop
 * (no cron library involvement). Never throws: parser failures land in
 * `errorKey`/`errorDetail` so the dialog can echo them. `locale` is the
 * @max/i18n tag; cronstrue descriptions follow it (zh → zh_CN).
 */
export function buildSchedulePreview(
  schedule: string,
  options?: { now?: number; runCount?: number; locale?: string },
): SchedulePreview {
  const now = options?.now ?? Date.now()
  const runCount = options?.runCount ?? SCHEDULE_PREVIEW_RUN_COUNT
  const cronstrueLocale = (options?.locale ?? "en-US").startsWith("zh") ? "zh_CN" : "en"
  const trimmed = schedule.trim()
  if (trimmed.length === 0) {
    return { kind: "invalid", errorKey: null, errorDetail: null, description: null, nextRuns: [] }
  }
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed)
    if (!Number.isSafeInteger(ms) || ms < AUTOMATION_MIN_INTERVAL_MS) {
      return {
        kind: "invalid",
        errorKey: "automations.errors.intervalTooShort",
        errorDetail: null,
        description: null,
        nextRuns: [],
      }
    }
    const nextRuns: number[] = []
    let t = now
    for (let i = 0; i < runCount; i += 1) {
      t += ms
      nextRuns.push(t)
    }
    return { kind: "interval", errorKey: null, errorDetail: null, description: null, nextRuns }
  }
  const fields = trimmed.split(/\s+/)
  if (fields.length !== 5) {
    return {
      kind: "invalid",
      errorKey: "automations.errors.cronFields",
      errorDetail: null,
      description: null,
      nextRuns: [],
    }
  }
  try {
    // cronstrue describes; a parse failure here (out-of-range field, bad
    // name) is the hard client-side validation.
    const description = cronstrue.toString(trimmed, { locale: cronstrueLocale })
    // startAt pins the matcher's clock (it defaults to Date.now(), which
    // would make the preview nondeterministic between keystrokes).
    const isoMatches = getFutureMatches(trimmed, {
      hasSeconds: false,
      matchCount: runCount,
      startAt: new Date(now).toISOString(),
    })
    const nextRuns = isoMatches.map((iso) => Date.parse(iso)).filter((ms) => !Number.isNaN(ms))
    return { kind: "cron", errorKey: null, errorDetail: null, description, nextRuns }
  } catch (err) {
    return {
      kind: "invalid",
      errorKey: "automations.errors.cronInvalid",
      errorDetail: err instanceof Error ? err.message : String(err),
      description: null,
      nextRuns: [],
    }
  }
}

/**
 * One preview row: the instant rendered in the scheduler timezone (the
 * API worker runs on UTC, so cron fields mean UTC) and again in the
 * viewer's timezone — the dual-timezone comparison that makes "why did it
 * fire at 02:00?" answerable.
 */
export interface ScheduleRunRow {
  /** Epoch ms of the fire instant. */
  at: number
  /** Rendered in the scheduler timezone (UTC). */
  schedulerText: string
  /** Rendered in the viewer's local timezone. */
  localText: string
}

/** Scheduler-side timezone of the job API (worker runs UTC). */
export const SCHEDULE_TZ = "UTC"

/** Compact locale-aware stamp for a preview row in one timezone. */
export function formatRunTime(ms: number, timeZone: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(ms))
}

/**
 * epoch-ms runs → dual-timezone rows for the preview list. `localeTag`
 * comes from the caller's active dictionary locale so both columns follow
 * the UI language.
 */
export function toScheduleRunRows(
  nextRuns: number[],
  localeTag: string,
  localTimeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ScheduleRunRow[] {
  return nextRuns.map((at) => ({
    at,
    schedulerText: formatRunTime(at, SCHEDULE_TZ, localeTag),
    localText: formatRunTime(at, localTimeZone, localeTag),
  }))
}
