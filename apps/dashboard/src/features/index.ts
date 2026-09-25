// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Feature-domain registry — the federation manifest (deepseek ui-*
 * borrowing). One entry per product domain: its i18n title, an icon
 * glyph, and the tab that surfaces it. This file is the single source
 * of truth for the three registries that used to be maintained by hand
 * (and drift):
 *
 *   FEATURE_DOMAINS    — every built domain (this list, ids matching
 *                        the domain directories / panel components);
 *   SETTINGS_SECTIONS  — the settings-center nav, derived in
 *                        components/settings/sections.tsx by bridging
 *                        the shell's store-pinned section ids onto
 *                        these entries (settingsSections() is the
 *                        per-section projection);
 *   WORKSPACE_PANELS   — the workspace dock's resident leaves, listed
 *                        here and mapped one-to-one onto the registry
 *                        by workspacePanelDomains(); the panel→
 *                        component wiring stays in
 *                        components/layout/WorkspaceDockSidebar.tsx.
 *
 * Consumers: the command palette's domain section, the settings nav,
 * the workspace dock sidebar, and future keyboard cheatsheets — one
 * manifest instead of N hardcoded wirings. The invariants that keep
 * the three aligned are locked by test/registry-unification.test.ts.
 */

export interface FeatureDomain {
  id: string
  titleKey: string
  glyph: string
  section: "workspace" | "observe" | "admin"
}

/**
 * The manifest — one entry per built domain, id matching the domain
 * directory / panel component (tasks → TaskPanel, goals →
 * features/goals, model-picker → features/model-picker, workflow-runs
 * → the workflows surface, …) and titleKey matching the key that
 * surface already renders.
 */
export const FEATURE_DOMAINS: FeatureDomain[] = [
  // ── workspace ─────────────────────────────────────────────────────────────
  { id: "chat", titleKey: "nav.workspace", glyph: "💬", section: "workspace" },
  { id: "trajectory", titleKey: "trajectory.title", glyph: "🧭", section: "workspace" },
  { id: "subagents", titleKey: "subagents.title", glyph: "🤖", section: "workspace" },
  { id: "tasks", titleKey: "task.title", glyph: "☑", section: "workspace" },
  { id: "goals", titleKey: "goals.title", glyph: "🎯", section: "workspace" },
  { id: "files", titleKey: "files.title", glyph: "📁", section: "workspace" },
  { id: "artifacts", titleKey: "artifacts.title", glyph: "🗂", section: "workspace" },
  { id: "sessions", titleKey: "sessions.title", glyph: "🕘", section: "workspace" },
  { id: "deliverables", titleKey: "deliverables.title", glyph: "📦", section: "workspace" },
  { id: "session-query", titleKey: "sessionQuery.title", glyph: "🔎", section: "workspace" },
  // ── observe ───────────────────────────────────────────────────────────────
  { id: "executions", titleKey: "nav.executions", glyph: "📊", section: "observe" },
  { id: "workflow-runs", titleKey: "workflows.title", glyph: "🧩", section: "observe" },
  { id: "evolution", titleKey: "nav.evolution", glyph: "🧬", section: "observe" },
  { id: "truth-audit", titleKey: "observability.truth.title", glyph: "🔬", section: "observe" },
  { id: "oracle-triad", titleKey: "observability.oracle.title", glyph: "📐", section: "observe" },
  { id: "usage", titleKey: "nav.usage", glyph: "💰", section: "observe" },
  // ── admin ─────────────────────────────────────────────────────────────────
  { id: "model-picker", titleKey: "modelPicker.title", glyph: "🎛", section: "admin" },
  { id: "automations", titleKey: "automations.title", glyph: "⏱", section: "admin" },
  { id: "jobs", titleKey: "jobs.title", glyph: "🛠", section: "admin" },
  { id: "memory", titleKey: "memory.title", glyph: "🧠", section: "admin" },
  { id: "skills", titleKey: "skills.title", glyph: "🎓", section: "admin" },
  { id: "governance", titleKey: "nav.governance", glyph: "⚖", section: "admin" },
  { id: "permissions", titleKey: "permissions.title", glyph: "🔑", section: "admin" },
  { id: "providers", titleKey: "nav.providers", glyph: "🔌", section: "admin" },
  { id: "vault", titleKey: "settings.vault.title", glyph: "🔐", section: "admin" },
  { id: "settings", titleKey: "nav.settings", glyph: "⚙", section: "admin" },
]

export function domainsBySection(section: FeatureDomain["section"]): FeatureDomain[] {
  return FEATURE_DOMAINS.filter((d) => d.section === section)
}

/** One registry row by id (null when the id is unknown). */
export function featureDomain(id: string): FeatureDomain | null {
  return FEATURE_DOMAINS.find((d) => d.id === id) ?? null
}

// ── Settings-nav projection ─────────────────────────────────────────────────

/** A settings-nav projection row: section id + its i18n title key. */
export interface SettingsSectionRef {
  id: string
  titleKey: string
}

/**
 * Registry projection for the settings nav: every domain filed under
 * `section` as an id + titleKey pair. components/settings/sections.tsx
 * bridges the shell's store-pinned section ids onto these entries —
 * the registry decides which domains are admin surfaces, the bridge
 * only names the sections that surface them.
 */
export function settingsSections(
  section: FeatureDomain["section"] = "admin",
): SettingsSectionRef[] {
  return domainsBySection(section).map((d) => ({ id: d.id, titleKey: d.titleKey }))
}

// ── Workspace dock panels ───────────────────────────────────────────────────

export interface WorkspacePanelSpec {
  /** Stable dock leaf id (persisted in the layout document). */
  id: string
  /** Existing i18n title key — reused verbatim in the leaf header. */
  titleKey: string
}

/**
 * The resident workspace panel registry — one dock leaf per entry, ids
 * stable. Lives beside FEATURE_DOMAINS so the leaves and the domains
 * they host cannot drift; the panel→component wiring (what each leaf
 * renders) stays in components/layout/WorkspaceDockSidebar.tsx.
 */
export const WORKSPACE_PANELS: readonly WorkspacePanelSpec[] = [
  { id: "agent", titleKey: "agent.title" },
  { id: "tasks", titleKey: "task.title" },
  { id: "subagents", titleKey: "subagents.title" },
  { id: "trajectory", titleKey: "trajectory.title" },
  { id: "files", titleKey: "files.title" },
  { id: "sessions", titleKey: "sessions.title" },
  { id: "artifacts", titleKey: "artifacts.title" },
  { id: "goals", titleKey: "goals.title" },
  { id: "deliverables", titleKey: "deliverables.title" },
]

/**
 * Panel ids whose FEATURE_DOMAINS entry answers to a different id.
 * Everything else maps by shared id.
 */
export const WORKSPACE_PANEL_DOMAIN_ALIASES: Readonly<Record<string, string>> = {
  agent: "chat", // the agent leaf hosts the chat domain's conversation surface
}

/** One row of the WORKSPACE_PANELS ↔ FEATURE_DOMAINS correspondence. */
export interface WorkspacePanelDomain {
  /** WORKSPACE_PANELS leaf id. */
  panelId: string
  /** The panel's FEATURE_DOMAINS id, null while the domain is pending. */
  domainId: string | null
  /** The leaf's i18n title key (same-id overlaps share the domain's key). */
  titleKey: string
}

/**
 * WORKSPACE_PANELS ↔ FEATURE_DOMAINS correspondence — a pure projection
 * of the two registries, no third hardcoded list. A panel maps to the
 * FEATURE_DOMAINS entry with its id (or its alias's id); a leaf whose
 * domain has not been registered yet surfaces as null so the gap stays
 * visible and tested until it is grown (the tasks/goals gap from the
 * dock-integration round closed this way).
 */
export function workspacePanelDomains(): WorkspacePanelDomain[] {
  return WORKSPACE_PANELS.map((panel) => {
    const alias = WORKSPACE_PANEL_DOMAIN_ALIASES[panel.id]
    const domainId =
      alias ?? (FEATURE_DOMAINS.some((domain) => domain.id === panel.id) ? panel.id : null)
    return { panelId: panel.id, domainId, titleKey: panel.titleKey }
  })
}
