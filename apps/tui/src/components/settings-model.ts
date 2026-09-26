// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the TUI Settings dialog (the TUI face of the
 * dashboard's settings center). Input is the dialog's ambient state — a
 * palette query, an API reachability probe result, a theme-switching
 * capability flag — output is the typed list of section rows the ink
 * component paints.
 *
 * Everything here is defensive and unit-testable; no React, no ink, no i18n
 * imports (the dialog translates the returned *keys*). The section catalog
 * is data, not code: each row carries the i18n keys, the English fallbacks
 * and the *target* (what Enter opens) so the mapping is pinned by tests
 * instead of buried in a switch statement.
 */

// ── Capability flag ──────────────────────────────────────────────────────────

/**
 * Whether the TUI can actually switch themes at runtime. HONESTLY FALSE
 * today: the ported theme context (src/context/theme.tsx) resolves a single
 * hard-coded theme and its `set()` is a no-op stub — 34 theme JSONs and the
 * DialogThemeList picker exist, but selecting one changes nothing on screen.
 * Per the dashboard-parity discipline, the Appearance section must say so
 * ("theme switching is dashboard-only") instead of opening a fake picker.
 * Flip this to `true` only when the theme context's `set()` really re-renders
 * — and wire the picker into the dialog's "theme" target branch in the same
 * commit.
 */
export const TUI_THEME_SWITCHING_SUPPORTED = false

// ── Section catalog ──────────────────────────────────────────────────────────

export type SettingsSectionId = "appearance" | "jobs" | "memory" | "usage"

/**
 * What Enter on the section opens, expressed as data. The dialog maps these
 * kinds onto the existing open* callbacks; "theme" is reserved for the
 * future wired picker (unreachable while TUI_THEME_SWITCHING_SUPPORTED is
 * false).
 */
export type SettingsTargetKind = "theme" | "jobs-dialog" | "memory-panel" | "usage-panel"

export interface SettingsSection {
  readonly id: SettingsSectionId
  /** i18n key for the row title (jobs/memory/usage reuse their panel keys). */
  readonly titleKey: string
  /** English fallback title — tests pin it, the dialog translates the key. */
  readonly title: string
  /** i18n key for the row's one-line description. */
  readonly hintKey: string
  /** English fallback description. */
  readonly hint: string
  /** What Enter opens. */
  readonly target: SettingsTargetKind
  /** True when the section's face needs the Maximilian API to be reachable. */
  readonly requiresApi: boolean
}

/**
 * Canonical section order (the order the dialog lists them in). Mirrors the
 * dashboard settings center: personalization first, then the data faces.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "appearance",
    titleKey: "tui.settings.appearance",
    title: "Appearance",
    hintKey: "tui.settings.appearance.hint",
    hint: "Theme — live switching lives in the dashboard",
    target: "theme",
    requiresApi: false,
  },
  {
    id: "jobs",
    titleKey: "tui.jobs",
    title: "Jobs",
    hintKey: "tui.settings.jobs.hint",
    hint: "Scheduled jobs — opens the jobs view",
    target: "jobs-dialog",
    requiresApi: true,
  },
  {
    id: "memory",
    titleKey: "tui.memory",
    title: "Memory",
    hintKey: "tui.settings.memory.hint",
    hint: "Agent memory buckets — opens the memory panel",
    target: "memory-panel",
    requiresApi: true,
  },
  {
    id: "usage",
    titleKey: "tui.usage",
    title: "Usage",
    hintKey: "tui.settings.usage.hint",
    hint: "Token & cost windows — opens the usage panel",
    target: "usage-panel",
    requiresApi: true,
  },
]

const SECTION_ORDER = new Map<string, number>(
  SETTINGS_SECTIONS.map((section, index) => [section.id, index]),
)

// ── Filtering + sorting ──────────────────────────────────────────────────────

/**
 * Case-insensitive substring filter over id + title + hint (the command
 * palette's own fuzzysort handles ranking up there; this one is for any
 * future inline filter). A non-string, empty or whitespace-only query
 * returns the full catalog — garbage degrades to "no filter", never to "no
 * sections".
 */
export function filterSettingsSections(query: unknown): SettingsSection[] {
  const q = typeof query === "string" ? query.trim().toLowerCase() : ""
  if (q.length === 0) return [...SETTINGS_SECTIONS]
  return SETTINGS_SECTIONS.filter((section) =>
    [section.id, section.title, section.hint].some((field) => field.toLowerCase().includes(q)),
  )
}

function isSettingsSection(value: unknown): value is SettingsSection {
  if (value == null || typeof value !== "object") return false
  const id = (value as { id?: unknown }).id
  return typeof id === "string" && SECTION_ORDER.has(id)
}

/**
 * Restore the canonical catalog order from any input order. Defensive: a
 * non-array input yields [], garbage rows are dropped (a row that is not a
 * catalog section cannot be rendered or translated anyway), duplicates of
 * the same id keep their relative order, and the input array is never
 * mutated.
 */
export function sortSettingsSections(sections: unknown): SettingsSection[] {
  const list = Array.isArray(sections) ? sections.filter(isSettingsSection) : []
  return [...list].sort((a, b) => {
    const rankA = SECTION_ORDER.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const rankB = SECTION_ORDER.get(b.id) ?? Number.MAX_SAFE_INTEGER
    if (rankA !== rankB) return rankA - rankB
    return a.id.localeCompare(b.id)
  })
}

// ── Availability ─────────────────────────────────────────────────────────────

/** Ambient state the availability rules read. Both fields are optional. */
export interface SettingsDeps {
  /**
   * Result of the dialog's GET /api/health probe: true (reachable), false
   * (a DEFINITIVE failure), null/undefined (still probing / no probe).
   */
  apiReachable?: boolean | null
  /** Whether the theme context can actually switch themes at runtime. */
  themeSwitchable?: boolean | null
}

export type SectionAvailability =
  { state: "available" } | { state: "unavailable"; reasonKey: string; reason: string }

/**
 * Can the user actually open this section, given the ambient deps?
 *
 * Rules (defensive on both operands):
 *   - a garbage/unknown section is unavailable with the "unknown" reason —
 *     never available by accident;
 *   - "appearance" is available only when `themeSwitchable === true` (a
 *     strict check: the theme context's set() is a stub today, see
 *     TUI_THEME_SWITCHING_SUPPORTED). Anything else degrades to the honest
 *     "dashboard-only" note;
 *   - API-backed sections (requiresApi) are blocked ONLY by a definitive
 *     probe failure (`apiReachable === false`). An unknown probe state
 *     (null/undefined, still probing) degrades to available — the target
 *     panels own their loading/error three-state, so the settings dialog
 *     does not second-guess them.
 */
export function sectionAvailability(section: unknown, deps: unknown): SectionAvailability {
  if (section == null || typeof section !== "object") {
    return {
      state: "unavailable",
      reasonKey: "tui.settings.unavailable.unknown",
      reason: "unknown section",
    }
  }
  const id = (section as { id?: unknown }).id
  if (typeof id !== "string" || !SECTION_ORDER.has(id)) {
    return {
      state: "unavailable",
      reasonKey: "tui.settings.unavailable.unknown",
      reason: "unknown section",
    }
  }
  const d =
    deps != null && typeof deps === "object"
      ? (deps as { apiReachable?: unknown; themeSwitchable?: unknown })
      : {}
  if (id === "appearance") {
    if (d.themeSwitchable === true) return { state: "available" }
    return {
      state: "unavailable",
      reasonKey: "tui.settings.unavailable.dashboardOnly",
      reason: "theme switching is dashboard-only",
    }
  }
  if (d.apiReachable === false) {
    return {
      state: "unavailable",
      reasonKey: "tui.settings.unavailable.apiUnreachable",
      reason: "API unreachable — start the server and retry",
    }
  }
  return { state: "available" }
}

// ── View composition ─────────────────────────────────────────────────────────

/** One paintable row: the section plus its availability verdict. */
export interface SettingsSectionRow {
  readonly section: SettingsSection
  readonly availability: SectionAvailability
}

/**
 * The dialog's full view model: filter by query (if any), restore canonical
 * order, attach availability. Garbage operands degrade to an empty list or
 * per-row "unknown" — never a throw.
 */
export function settingsSectionsView(query: unknown, deps: unknown): SettingsSectionRow[] {
  return sortSettingsSections(filterSettingsSections(query)).map((section) => ({
    section,
    availability: sectionAvailability(section, deps),
  }))
}

// ── Navigation ───────────────────────────────────────────────────────────────

/**
 * Clamp the j/k cursor into [0, length-1]. Garbage operands degrade to 0 —
 * the same convention the jobs dialog's safeCursor uses, but pure so tests
 * pin it: negative cursors clamp to the top, overflowing ones to the last
 * row, non-finite numbers and non-numbers to the top, and an empty list
 * always yields 0.
 */
export function clampSettingsCursor(cursor: unknown, length: unknown): number {
  const len = typeof length === "number" && Number.isFinite(length) ? Math.trunc(length) : 0
  if (len <= 0) return 0
  const cur = typeof cursor === "number" && Number.isFinite(cursor) ? Math.trunc(cursor) : 0
  return Math.min(len - 1, Math.max(0, cur))
}
