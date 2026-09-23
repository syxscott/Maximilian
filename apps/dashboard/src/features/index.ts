// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Feature-domain registry — the federation manifest (deepseek ui-*
 * borrowing). One entry per product domain: its i18n title, an icon
 * glyph, and the tab that surfaces it. Consumers: the command palette's
 * domain section, the settings nav, and future keyboard cheatsheets —
 * one manifest instead of N hardcoded wirings.
 */

export interface FeatureDomain {
  id: string
  titleKey: string
  glyph: string
  section: "workspace" | "observe" | "admin"
}

export const FEATURE_DOMAINS: FeatureDomain[] = [
  { id: "chat", titleKey: "nav.workspace", glyph: "💬", section: "workspace" },
  { id: "trajectory", titleKey: "trajectory.title", glyph: "🧭", section: "workspace" },
  { id: "subagents", titleKey: "subagents.title", glyph: "🤖", section: "workspace" },
  { id: "files", titleKey: "files.title", glyph: "📁", section: "workspace" },
  { id: "artifacts", titleKey: "artifacts.title", glyph: "🗂", section: "workspace" },
  { id: "sessions", titleKey: "sessions.title", glyph: "🕘", section: "workspace" },
  { id: "model-picker", titleKey: "modelPicker.title", glyph: "🎛", section: "admin" },
  { id: "deliverables", titleKey: "deliverables.title", glyph: "📦", section: "workspace" },
  { id: "session-query", titleKey: "sessionQuery.title", glyph: "🔎", section: "workspace" },
  { id: "executions", titleKey: "nav.executions", glyph: "📊", section: "observe" },
  { id: "workflow-runs", titleKey: "workflows.title", glyph: "🧩", section: "observe" },
  { id: "evolution", titleKey: "nav.evolution", glyph: "🧬", section: "observe" },
  { id: "truth-audit", titleKey: "observability.truth.title", glyph: "🔬", section: "observe" },
  { id: "oracle-triad", titleKey: "observability.oracle.title", glyph: "📐", section: "observe" },
  { id: "usage", titleKey: "nav.usage", glyph: "💰", section: "observe" },
  { id: "governance", titleKey: "nav.governance", glyph: "⚖", section: "admin" },
  { id: "permissions", titleKey: "nav.governance", glyph: "-key", section: "admin" },
  { id: "providers", titleKey: "nav.providers", glyph: "🔌", section: "admin" },
  { id: "vault", titleKey: "settings.vault.title", glyph: "🔐", section: "admin" },
  { id: "settings", titleKey: "nav.settings", glyph: "⚙", section: "admin" },
]

export function domainsBySection(section: FeatureDomain["section"]): FeatureDomain[] {
  return FEATURE_DOMAINS.filter((d) => d.section === section)
}
