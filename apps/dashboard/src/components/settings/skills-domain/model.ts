// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the skills domain: grouping/filtering over the
 * static catalog (see skills-catalog.ts for the honest data-source note
 * — the backend exposes no dynamic tool registry yet).
 */

import { SKILL_CATALOG, type SkillCatalogEntry, type SkillKind } from "./skills-catalog"

export type { SkillCatalogEntry, SkillKind }

/** Catalog grouped by kind, kinds in display order, entries alphabetical. */
export function groupCatalogByKind(
  catalog: SkillCatalogEntry[] = SKILL_CATALOG,
): Array<{ kind: SkillKind; entries: SkillCatalogEntry[] }> {
  const order: SkillKind[] = ["read", "edit", "search", "execute"]
  return order
    .map((kind) => ({
      kind,
      entries: catalog.filter((e) => e.kind === kind).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.entries.length > 0)
}

/** Case-insensitive name/purpose filter. */
export function filterCatalog(catalog: SkillCatalogEntry[], query: string): SkillCatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return catalog
  return catalog.filter((e) => e.name.toLowerCase().includes(q))
}

/** Header counts per kind. */
export function kindCounts(
  catalog: SkillCatalogEntry[] = SKILL_CATALOG,
): Record<SkillKind, number> {
  const counts: Record<SkillKind, number> = { read: 0, edit: 0, search: 0, execute: 0 }
  for (const entry of catalog) {
    counts[entry.kind] += 1
  }
  return counts
}

/** i18n key for a kind badge. */
export function kindLabelKey(kind: SkillKind): string {
  return `skills.kind.${kind}`
}
