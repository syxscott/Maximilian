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
  if (!schedule && !payload && !name) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.schedule, schedule, true),
    row(FIELDS.name, name),
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
  const payload = pickStr(obj, ["command", "prompt", "task", "job", "action", "message"])
  const label = pickStr(obj, ["label", "name", "title", "id"])
  if (!interval && minutes === undefined && !payload && !label) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.interval, interval ?? (minutes === undefined ? undefined : `${minutes}m`), true),
    row(FIELDS.name, label),
    payload === undefined ? undefined : row(FIELDS.command, oneLine(payload, 200), true),
  ]
  const headline = oneLine(interval ?? label ?? (minutes === undefined ? "" : `${minutes}m`))
  return vmFrom(
    rows.filter((r) => r !== undefined),
    headline.length > 0 ? headline : jsonPreview(payload ?? "", 60),
  )
}
