// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Scheduled-work tool model layer: cron-create, offpeak-create. Extracts
 * the schedule/interval plus the deferred payload; defensive against
 * missing fields and malformed payloads.
 */

import {
  FIELDS,
  asRecord,
  emptyVm,
  jsonPreview,
  oneLine,
  pickNum,
  pickStr,
  row,
  vmFrom,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"

export function extractCronCreate(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const schedule = pickStr(obj, ["schedule", "cron", "cronExpression", "expression", "every"])
  const payload = pickStr(obj, ["command", "prompt", "task", "job", "action", "message"])
  const name = pickStr(obj, ["name", "label", "title", "id"])
  const description = pickStr(obj, ["description", "desc", "note", "details"])
  const timezone = pickStr(obj, ["timezone", "timeZone", "time_zone", "tz"])
  if (!schedule && !payload && !name && !description && !timezone) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.schedule, schedule, true),
    row(FIELDS.name, name),
    row(FIELDS.timezone, timezone, true),
    row(FIELDS.description, description),
    payload === undefined ? undefined : row(FIELDS.command, oneLine(payload, 200), true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(schedule ?? name ?? ""),
  )
}

export function extractOffpeakCreate(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const interval = pickStr(obj, ["interval", "window", "afterHours", "when", "schedule"])
  const minutes = pickNum(obj, ["intervalMinutes", "interval_minutes", "everyMinutes"])
  const duration = pickNum(obj, ["durationMinutes", "duration_minutes", "duration", "minutes"])
  const start = pickStr(obj, ["start", "from", "startAfter"])
  const end = pickStr(obj, ["end", "until", "endBy", "to"])
  const payload = pickStr(obj, ["command", "prompt", "task", "job", "action", "message"])
  const label = pickStr(obj, ["label", "name", "title", "id"])
  const windowRange =
    start !== undefined && end !== undefined ? `${start} – ${end}` : (start ?? end)
  if (
    !interval &&
    minutes === undefined &&
    duration === undefined &&
    windowRange === undefined &&
    !payload &&
    !label
  ) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.interval, interval ?? (minutes === undefined ? undefined : `${minutes}m`), true),
    windowRange === undefined ? undefined : row(FIELDS.window, windowRange, true),
    duration === undefined ? undefined : row(FIELDS.duration, `${duration}m`),
    row(FIELDS.name, label),
    payload === undefined ? undefined : row(FIELDS.command, oneLine(payload, 200), true),
  ]
  const headline = oneLine(
    interval ?? windowRange ?? label ?? (minutes === undefined ? "" : `${minutes}m`),
  )
  return vmFrom(
    rows.filter((r) => r !== undefined),
    headline.length > 0 ? headline : jsonPreview(payload ?? "", 60),
  )
}
