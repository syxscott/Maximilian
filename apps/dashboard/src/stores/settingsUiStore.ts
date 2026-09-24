// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Settings-center UI store (ZCode settings-shell borrowing): pure view
 * state for the settings surface — which section is active, which
 * sections are expanded, and per-domain dirty flags ("unsaved changes")
 * that the header save/discard buttons act on. Ephemeral by design:
 * nothing here persists, a reload starts from a clean settings page.
 * Pure helpers are exported so the expansion/dirty rules are testable
 * without the store.
 */
import { create } from "zustand"

/** Section ids the settings shell knows about (one expandable block each). */
export const SETTINGS_SECTIONS = [
  "general",
  "providers",
  "shortcuts",
  "permissions",
  "appearance",
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export function isSettingsSection(v: unknown): v is SettingsSection {
  return typeof v === "string" && (SETTINGS_SECTIONS as readonly string[]).includes(v)
}

/** Pure expansion toggle: set v, flip when v is omitted, default open. */
export function withExpanded(
  expanded: Readonly<Record<string, boolean>>,
  section: string,
  value?: boolean,
): Record<string, boolean> {
  return { ...expanded, [section]: value ?? !(expanded[section] ?? false) }
}

/** Pure dirty-flag write (booleans only — a dirty mark is not a string). */
export function withDirty(
  dirty: Readonly<Record<string, boolean>>,
  section: string,
  value: boolean,
): Record<string, boolean> {
  const next = { ...dirty, [section]: value === true }
  if (!next[section]) delete next[section]
  return next
}

/** Pure "any unsaved work?" check for the header badge. */
export function anyDirty(dirty: Readonly<Record<string, boolean>>): boolean {
  return Object.values(dirty).some(Boolean)
}

interface SettingsUiState {
  /** Active section id (null = none focused yet). */
  activeSection: SettingsSection | null
  /** Per-section expansion; absent = collapsed. */
  expanded: Record<string, boolean>
  /** Per-section unsaved-changes flags; absent = clean. */
  dirty: Record<string, boolean>
  setSection: (section: SettingsSection | null) => void
  toggleExpanded: (section: string, value?: boolean) => void
  expandAll: (sections: readonly string[]) => void
  setDirty: (section: string, value: boolean) => void
  /** Clear one section's dirty flag (after save or discard). */
  markSaved: (section: string) => void
  /** Discard every dirty flag (global "discard all"). */
  discardAll: () => void
  reset: () => void
}

const INITIAL = {
  activeSection: null as SettingsSection | null,
  expanded: {} as Record<string, boolean>,
  dirty: {} as Record<string, boolean>,
}

export const useSettingsUiStore = create<SettingsUiState>((set) => ({
  ...INITIAL,
  setSection: (activeSection) =>
    set({
      activeSection:
        activeSection !== null && isSettingsSection(activeSection) ? activeSection : null,
    }),
  toggleExpanded: (section, value) =>
    set((s) => ({ expanded: withExpanded(s.expanded, section, value) })),
  expandAll: (sections) =>
    set((s) => ({
      expanded: sections.reduce((acc, section) => withExpanded(acc, section, true), s.expanded),
    })),
  setDirty: (section, value) => set((s) => ({ dirty: withDirty(s.dirty, section, value) })),
  markSaved: (section) => set((s) => ({ dirty: withDirty(s.dirty, section, false) })),
  discardAll: () => set({ dirty: {} }),
  reset: () => set({ ...INITIAL }),
}))

// ── Selector hooks ──────────────────────────────────────────────────────────

export const useActiveSection = (): SettingsSection | null =>
  useSettingsUiStore((s) => s.activeSection)

export const useSectionExpanded = (section: string): boolean =>
  useSettingsUiStore((s) => s.expanded[section] ?? false)

export const useHasUnsaved = (): boolean => useSettingsUiStore((s) => anyDirty(s.dirty))
