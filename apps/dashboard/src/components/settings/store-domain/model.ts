// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the session-store status domain. Defensive
 * normalization of GET /system/session-store payloads (which may be a 404
 * or a "disabled" answer until the route is wired).
 */

export interface StoreTableCount {
  name: string
  count: number | null
}

export interface StoreStatusView {
  available: boolean
  schemaVersion: number | null
  path: string | null
  tables: StoreTableCount[]
}

/** Display order for the known tables; unknown keys keep API order. */
const TABLE_ORDER = ["sessions", "messages", "events", "usage", "steering_queue"] as const

/** Stable fallback so the card renders before/without the route. */
export function emptyStoreStatus(): StoreStatusView {
  return { available: false, schemaVersion: null, path: null, tables: [] }
}

export function toStoreStatusView(raw: unknown): StoreStatusView {
  if (raw == null || typeof raw !== "object") return emptyStoreStatus()
  const row = raw as Record<string, unknown>

  const tables: StoreTableCount[] = []
  const rawTables = row.tables != null && typeof row.tables === "object" ? row.tables : null
  if (rawTables) {
    const entries = Object.entries(rawTables as Record<string, unknown>)
    // Known tables in display order first, then anything new the backend adds.
    entries.sort((a, b) => {
      const ai = (TABLE_ORDER as readonly string[]).indexOf(a[0])
      const bi = (TABLE_ORDER as readonly string[]).indexOf(b[0])
      const av = ai === -1 ? TABLE_ORDER.length : ai
      const bv = bi === -1 ? TABLE_ORDER.length : bi
      return av - bv
    })
    for (const [name, count] of entries) {
      tables.push({
        name,
        count: typeof count === "number" && Number.isFinite(count) ? count : null,
      })
    }
  }

  return {
    available: row.available === true,
    schemaVersion:
      typeof row.schemaVersion === "number" && Number.isFinite(row.schemaVersion)
        ? row.schemaVersion
        : null,
    path: typeof row.path === "string" ? row.path : null,
    tables,
  }
}

// ── Migration candidates (GET /system/migrations) ───────────────────────────

export interface MigrationsStatusView {
  /** Routes in the contract snapshot; null = unreadable (honest unknown). */
  apiRoutes: number | null
  sessionStore: {
    available: boolean
    schemaVersion: number | null
    tables: StoreTableCount[]
  }
  i18n: {
    locales: number | null
    coreKeys: number | null
  }
}

/** Stable fallback so the card renders before/without the route. */
export function emptyMigrationsStatus(): MigrationsStatusView {
  return {
    apiRoutes: null,
    sessionStore: { available: false, schemaVersion: null, tables: [] },
    i18n: { locales: null, coreKeys: null },
  }
}

function nullableCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Defensive /system/migrations payload → card view model. */
export function toMigrationsStatusView(raw: unknown): MigrationsStatusView {
  if (raw == null || typeof raw !== "object") return emptyMigrationsStatus()
  const row = raw as Record<string, unknown>

  const api =
    row.api != null && typeof row.api === "object" ? (row.api as Record<string, unknown>) : {}
  const sessionStoreRaw =
    row.sessionStore != null && typeof row.sessionStore === "object"
      ? (row.sessionStore as Record<string, unknown>)
      : {}
  const i18nRaw =
    row.i18n != null && typeof row.i18n === "object" ? (row.i18n as Record<string, unknown>) : {}

  // Same display-order normalization as toStoreStatusView for the table list.
  const tables: StoreTableCount[] = []
  const rawTables =
    sessionStoreRaw.tables != null && typeof sessionStoreRaw.tables === "object"
      ? (sessionStoreRaw.tables as Record<string, unknown>)
      : null
  if (rawTables) {
    const entries = Object.entries(rawTables)
    entries.sort((a, b) => {
      const ai = (TABLE_ORDER as readonly string[]).indexOf(a[0])
      const bi = (TABLE_ORDER as readonly string[]).indexOf(b[0])
      const av = ai === -1 ? TABLE_ORDER.length : ai
      const bv = bi === -1 ? TABLE_ORDER.length : bi
      return av - bv
    })
    for (const [name, count] of entries) {
      tables.push({ name, count: nullableCount(count) })
    }
  }

  return {
    apiRoutes: nullableCount(api.openapiRoutes),
    sessionStore: {
      available: sessionStoreRaw.available === true,
      schemaVersion: nullableCount(sessionStoreRaw.schemaVersion),
      tables,
    },
    i18n: {
      locales: nullableCount(i18nRaw.locales),
      coreKeys: nullableCount(i18nRaw.coreKeys),
    },
  }
}

// ── System-status follow-ups: refresh clock + raw JSON drill-down ───────────

/**
 * Local wall-clock rendering of a query `dataUpdatedAt` timestamp as
 * HH:MM:SS (deterministic padding, locale-independent digits). Undefined /
 * non-finite input → null (the card then shows no refresh time yet).
 */
export function formatClock(ts: number | undefined): string | null {
  if (ts === undefined || !Number.isFinite(ts) || ts <= 0) return null
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Pretty-print one raw status section for the <details> drill-down.
 * null → the caller renders the localized "no data" state.
 */
export function rawJsonText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return null
  }
}
