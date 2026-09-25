// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the system-overview section: folds the four
 * subsystem status payloads (vault / session store / migrations / oracle
 * lessons) into one comparable health row each. Defensive by design — a
 * payload that is missing (still loading), errored, or shaped wrong maps
 * to "unknown", never to a guessed ok/degraded.
 */

export type SubsystemState = "ok" | "degraded" | "unknown"

export type SubsystemId = "vault" | "store" | "migrations" | "oracle"

export interface SubsystemHealth {
  id: SubsystemId
  state: SubsystemState
}

export interface SystemHealthInput {
  /** GET /system/vault payload; undefined while loading / errored. */
  vault?: unknown
  /** GET /system/session-store payload. */
  store?: unknown
  /** GET /system/migrations payload. */
  migrations?: unknown
  /** GET /evolution/oracle-lessons payload. */
  oracle?: unknown
}

/** Display order of the summary row (stable across refetches). */
export const SUBSYSTEM_ORDER: ReadonlyArray<SubsystemId> = [
  "vault",
  "store",
  "migrations",
  "oracle",
]

function obj(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function vaultState(raw: unknown): SubsystemState {
  const row = obj(raw)
  if (Object.keys(row).length === 0) return "unknown"
  if (row.configured !== true) return "unknown" // nothing configured — not a fault
  return row.open === true ? "ok" : "degraded" // configured but locked
}

function storeState(raw: unknown): SubsystemState {
  const row = obj(raw)
  if (Object.keys(row).length === 0) return "unknown"
  return row.available === true ? "ok" : "degraded" // explicitly disabled
}

function migrationsState(raw: unknown): SubsystemState {
  const row = obj(raw)
  if (Object.keys(row).length === 0) return "unknown"
  const api = obj(row.api)
  const i18n = obj(row.i18n)
  const readable = [api.openapiRoutes, i18n.locales, i18n.coreKeys].some(
    (v) => typeof v === "number" && Number.isFinite(v),
  )
  // At least one honest metric → healthy; an object with no readable
  // metric means every anchor missed (deployment shape) → degraded.
  return readable ? "ok" : "degraded"
}

function oracleState(raw: unknown): SubsystemState {
  const row = obj(raw)
  if (Object.keys(row).length === 0) return "unknown"
  // Configured dir (even an empty one) → healthy; unset dir → degraded,
  // because the settings editor cannot write anywhere.
  return row.configured === true ? "ok" : "degraded"
}

const STATES: Record<SubsystemId, (raw: unknown) => SubsystemState> = {
  vault: vaultState,
  store: storeState,
  migrations: migrationsState,
  oracle: oracleState,
}

/** Fold the four payloads into one health row per subsystem, in order. */
export function toSystemHealthView(input: SystemHealthInput): SubsystemHealth[] {
  return SUBSYSTEM_ORDER.map((id) => ({ id, state: STATES[id](input[id]) }))
}

/** Aggregate for the header chip: worst state wins, unknown only when all unknown. */
export function worstState(states: ReadonlyArray<SubsystemState>): SubsystemState {
  if (states.includes("degraded")) return "degraded"
  if (states.includes("ok")) return "ok"
  return "unknown"
}
