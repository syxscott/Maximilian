// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the settings-center global search (ZCode
 * settings/ borrowing): the nav's search input filters the section list
 * so a keyword like "memory" or "store" lands on the right section
 * without reading every tooltip. Matching is title-based — a section
 * matches when the query is a case-insensitive substring of its
 * localized title, its titleKey, its id, or of any subdomain entry it
 * surfaces (each entry matched by localized title, titleKey, and
 * registry id). No i18n or store dependency here: labels are resolved
 * by the caller, so the filter itself is trivially testable.
 */

/** One FEATURE_DOMAINS row a section surfaces (e.g. model-picker under providers). */
export interface SettingsSearchItem {
  /** Registry domain id (also matched — ids like "store" are meaningful). */
  id: string
  titleKey: string
  /** Localized label; the caller resolves it via t(titleKey). */
  title: string
}

/** One settings section as the search sees it. */
export interface SettingsSearchSection {
  /** Shell section id (settingsUiStore SettingsSection). */
  id: string
  titleKey: string
  /** Localized nav label; t() fallback makes this at worst the key itself. */
  title: string
  /** Nav tooltip key; carried along so the filtered nav renders it. */
  descriptionKey?: string
  /** Subdomains this section surfaces — matched by title and key. */
  entries: readonly SettingsSearchItem[]
}

/**
 * Filter the section list by a free-text query. An empty / whitespace
 * query keeps every section (input order preserved). A non-empty query
 * keeps only sections whose id, titleKey, title, or any entry's
 * id/titleKey/title contains the needle case-insensitively. Returns a
 * new array; the input is never mutated.
 */
export function filterSections(
  sections: readonly SettingsSearchSection[],
  query: string,
): SettingsSearchSection[] {
  const needle = query.trim().toLowerCase()
  if (needle === "") return [...sections]
  return sections.filter((section) => searchFields(section).some((field) => field.includes(needle)))
}

/** Every lowercase haystack this section may match against. */
function searchFields(section: SettingsSearchSection): string[] {
  const fields = [section.id, section.titleKey, section.title]
  for (const entry of section.entries) {
    fields.push(entry.id, entry.titleKey, entry.title)
  }
  return fields.map((field) => field.toLowerCase())
}
