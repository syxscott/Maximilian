// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the oracle lessons editor. Defensive normalization
 * of the GET /evolution/oracle-lessons payload (which may be a disabled
 * answer or garbage), the role-name whitelist mirrored from the server's
 * PUT route ([a-z0-9-], 1–64), and a pure upsert used to fold a saved
 * lesson back into the visible corpus before the refetch lands.
 */

/** Canonical role whitelist — the server route enforces the same pattern. */
export const ORACLE_ROLE_NAME_PATTERN = /^[a-z0-9-]{1,64}$/

/** Role-name validation outcomes; null = the name is acceptable. */
export type OracleRoleError = "empty" | "charset" | "tooLong"

/** Hard cap mirrored from the backend route. */
export const ORACLE_ROLE_MAX_LENGTH = 64

/**
 * Validate a role name for the editor (create + save guards). Returns a
 * stable error code the component maps to an i18n key, or null when the
 * name may be sent.
 */
export function validateOracleRoleName(role: unknown): OracleRoleError | null {
  if (typeof role !== "string" || role.trim().length === 0) return "empty"
  if (role.length > ORACLE_ROLE_MAX_LENGTH) return "tooLong"
  if (!ORACLE_ROLE_NAME_PATTERN.test(role)) return "charset"
  return null
}

export interface OracleLessonView {
  role: string
  content: string
  bytes: number
}

export interface OracleCorpusView {
  configured: boolean
  dir: string | null
  lessons: OracleLessonView[]
}

/** UTF-8 byte length without Node's Buffer (browser-safe). */
function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Stable fallback so the editor renders before/without the route. */
export function emptyCorpusView(): OracleCorpusView {
  return { configured: false, dir: null, lessons: [] }
}

/** Defensive GET payload → editor view model. */
export function toOracleCorpusView(raw: unknown): OracleCorpusView {
  if (raw == null || typeof raw !== "object") return emptyCorpusView()
  const row = raw as Record<string, unknown>

  const lessons: OracleLessonView[] = []
  if (Array.isArray(row.lessons)) {
    for (const entry of row.lessons) {
      if (entry == null || typeof entry !== "object") continue
      const e = entry as Record<string, unknown>
      if (typeof e.role !== "string" || e.role.length === 0) continue
      if (typeof e.content !== "string") continue
      lessons.push({
        role: e.role,
        content: e.content,
        bytes:
          typeof e.bytes === "number" && Number.isFinite(e.bytes) ? e.bytes : utf8Length(e.content),
      })
    }
  }
  // Alphabetical by role keeps the corpus stable across refetches.
  lessons.sort((a, b) => a.role.localeCompare(b.role))

  return {
    configured: row.configured === true,
    dir: typeof row.dir === "string" ? row.dir : null,
    lessons,
  }
}

/**
 * Pure upsert: replace one lesson's content in place (recomputing bytes)
 * or append a new entry — always re-sorted by role. Used by the editor to
 * reflect a successful save immediately, before the query refetch lands.
 */
export function upsertLesson(
  lessons: ReadonlyArray<OracleLessonView>,
  role: string,
  content: string,
): OracleLessonView[] {
  const next = lessons
    .filter((l) => l.role !== role)
    .concat([{ role, content, bytes: utf8Length(content) }])
  next.sort((a, b) => a.role.localeCompare(b.role))
  return next
}

/**
 * Map a save-mutation failure to a stable i18n error-code suffix. The
 * server's message travels alongside as detail text; the code keeps the
 * line itself localizable.
 */
export function oracleSaveErrorKind(
  error: unknown,
): "invalidRole" | "notConfigured" | "invalidContent" | "generic" {
  const message = error instanceof Error ? error.message : String(error ?? "")
  if (message.includes("Invalid role name")) return "invalidRole"
  if (message.includes("not configured")) return "notConfigured"
  if (message.includes("Invalid lesson content")) return "invalidContent"
  return "generic"
}
