// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the automations domain: automation = a job record
 * (shared /jobs API) plus a LOCAL enabled toggle. The toggle is honest
 * client-side state — the v0 jobs API has no enabled field yet, so a
 * disabled automation only stops this UI from offering manual triggers;
 * it does not pause server-side scheduling.
 */

import { toJobViews, type JobView } from "../jobs-domain/model"

export interface AutomationView extends JobView {
  /** Local UI toggle (default true). NOT persisted to the API. */
  enabled: boolean
}

/**
 * Defensive /jobs response → automation views with local toggles merged
 * over the records.
 */
export function toAutomationViews(
  raw: unknown,
  enabledOverrides: Record<string, boolean> = {},
): AutomationView[] {
  return toJobViews(raw).map((job) => ({
    ...job,
    enabled: enabledOverrides[job.id] ?? true,
  }))
}

/** Case-insensitive name filter (empty query = everything). */
export function filterAutomations(automations: AutomationView[], query: string): AutomationView[] {
  const q = query.trim().toLowerCase()
  if (!q) return automations
  return automations.filter((a) => a.name.toLowerCase().includes(q))
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

export interface AutomationDraft {
  name: string
  schedule: string
  description: string
}

export const EMPTY_AUTOMATION_DRAFT: AutomationDraft = { name: "", schedule: "", description: "" }

/**
 * Dialog pre-validation (presence only — schedule semantics stay
 * server-side, same split as the jobs domain).
 */
export function validateAutomationDraft(draft: AutomationDraft): string | null {
  if (draft.name.trim().length === 0) return "automations.errors.nameRequired"
  if (draft.schedule.trim().length === 0) return "automations.errors.scheduleRequired"
  return null
}

/** i18n key describing the trigger cadence of one automation. */
export function triggerLabelKey(automation: AutomationView): string {
  return automation.scheduleKind === "cron"
    ? "automations.trigger.cron"
    : automation.scheduleKind === "interval"
      ? "automations.trigger.interval"
      : "automations.trigger.unknown"
}
