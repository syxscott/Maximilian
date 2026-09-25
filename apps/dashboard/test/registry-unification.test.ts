// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Registry unification — FEATURE_DOMAINS (src/features) is the single
 * source of truth for the three lists that used to be maintained by
 * hand and drift:
 *
 *   ① the manifest itself is id-clean (no duplicate domain ids);
 *   ② every SETTINGS_SECTIONS row resolves onto FEATURE_DOMAINS entries
 *     (settings bridge), and conversely every admin domain is surfaced
 *     by some settings section (settingsSections() projection);
 *   ③ workspacePanelDomains() maps the dock leaves onto the registry
 *     completely — the tasks/goals gap pinned during the dock round is
 *     closed, no leaf is left domainless;
 *   ④ every registry titleKey resolves in the merged (core + domain)
 *     dictionary for BOTH locales.
 */

import { describe, expect, it } from "vitest"
import { getDictionary } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"
import {
  FEATURE_DOMAINS,
  WORKSPACE_PANELS,
  featureDomain,
  settingsSections,
  workspacePanelDomains,
} from "../src/features"
import { SETTINGS_SECTIONS, SETTINGS_SECTION_DOMAINS } from "../src/components/settings/sections"

// Register the aggregated dashboard dictionaries exactly like main.tsx
// so getDictionary() answers with core + every domain file merged.
applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})

describe("registry unification — FEATURE_DOMAINS is the single source", () => {
  it("① has no duplicate domain ids", () => {
    const ids = FEATURE_DOMAINS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("① keeps the manifest at full coverage (no accidental mass deletion)", () => {
    // 20 domains at the unification baseline + tasks/goals (the dock
    // round's pinned gap) + automations/jobs/memory/skills (the
    // settings-center domains) — the floor only guards regressions.
    expect(FEATURE_DOMAINS.length).toBeGreaterThanOrEqual(22)
  })

  it("② every settings section resolves onto FEATURE_DOMAINS entries", () => {
    const known = new Set(FEATURE_DOMAINS.map((d) => d.id))
    const ids = SETTINGS_SECTIONS.map((s) => s.id)
    // The nav itself stays id-clean, and every section bridges to at
    // least one real registry entry.
    expect(new Set(ids).size).toBe(ids.length)
    for (const section of SETTINGS_SECTIONS) {
      expect(
        section.domains.length,
        `section ${section.id} bridges no FEATURE_DOMAINS entry`,
      ).toBeGreaterThan(0)
      for (const domain of section.domains) {
        expect(known.has(domain), `section ${section.id} bridges unknown domain "${domain}"`).toBe(
          true,
        )
      }
    }
  })

  it("② reverse: every admin domain is surfaced by a settings section", () => {
    const projected = settingsSections("admin")
    // The projection is exactly the admin slice of the registry.
    expect(projected).toEqual(
      FEATURE_DOMAINS.filter((d) => d.section === "admin").map((d) => ({
        id: d.id,
        titleKey: d.titleKey,
      })),
    )
    const covered = new Set(SETTINGS_SECTIONS.flatMap((s) => [...s.domains]))
    for (const ref of projected) {
      expect(
        covered.has(ref.id),
        `admin domain "${ref.id}" is surfaced by no settings section`,
      ).toBe(true)
    }
  })

  it("② sections without a surface-local label derive it from the registry", () => {
    // The rendered nav list must be a pure function of the bridge + the
    // registry: a row's label is its override, else its primary
    // domain's titleKey — no second copy of any label to drift.
    expect(SETTINGS_SECTIONS).toHaveLength(SETTINGS_SECTION_DOMAINS.length)
    for (const row of SETTINGS_SECTION_DOMAINS) {
      const primary = featureDomain(row.domains[0])
      expect(primary, `section ${row.id} primary domain missing`).not.toBeNull()
      const rendered = SETTINGS_SECTIONS.find((s) => s.id === row.id)
      expect(rendered?.titleKey).toBe(row.titleKey ?? primary?.titleKey)
    }
  })

  it("③ workspacePanelDomains maps every dock leaf onto the registry", () => {
    const mappings = workspacePanelDomains()
    // The leaves are id-clean and exhaust WORKSPACE_PANELS.
    const panelIds = WORKSPACE_PANELS.map((p) => p.id)
    expect(new Set(panelIds).size).toBe(panelIds.length)
    expect(mappings.map((m) => m.panelId)).toEqual(panelIds)
    // The tasks/goals gap pinned last round is closed: no null domains,
    // every resolved id is a real entry, and the mapping is injective.
    for (const mapping of mappings) {
      expect(mapping.domainId, `panel ${mapping.panelId} maps to no domain`).not.toBeNull()
    }
    const domainIds = mappings.map((m) => m.domainId as string)
    expect(new Set(domainIds).size).toBe(domainIds.length)
    const known = new Set(FEATURE_DOMAINS.map((d) => d.id))
    for (const id of domainIds) expect(known.has(id)).toBe(true)
    // Dock residency is workspace-only: every panel's domain is filed
    // under the workspace section.
    for (const mapping of mappings) {
      expect(featureDomain(mapping.domainId as string)?.section).toBe("workspace")
    }
  })

  it("③ same-id panels share the domain's titleKey (one label, one place)", () => {
    for (const mapping of workspacePanelDomains()) {
      if (mapping.domainId !== mapping.panelId) continue
      expect(featureDomain(mapping.domainId)?.titleKey).toBe(mapping.titleKey)
    }
    // The tasks/goals gap specifically: closed by id, not by alias.
    for (const id of ["tasks", "goals"]) {
      expect(workspacePanelDomains().find((m) => m.panelId === id)?.domainId).toBe(id)
    }
  })

  it("④ every registry titleKey resolves in the merged dictionary (both locales)", () => {
    const keys = [
      ...FEATURE_DOMAINS.map((d) => d.titleKey),
      ...SETTINGS_SECTIONS.map((s) => s.titleKey),
      ...WORKSPACE_PANELS.map((p) => p.titleKey),
    ]
    for (const locale of ["zh-CN", "en-US"]) {
      const dict = getDictionary(locale) ?? {}
      for (const key of keys) {
        expect(
          typeof dict[key],
          `${locale}: registry titleKey "${key}" is missing from the merged dictionary`,
        ).toBe("string")
      }
    }
  })
})
