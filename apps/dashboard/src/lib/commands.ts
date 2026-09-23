// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Command registry — the single source of truth for every user-invokable
 * command in the dashboard (ZCode commandsStore / opencode command context
 * borrowing). Commands declare: id, i18n title, optional keybind, the tab
 * they navigate to (or a custom handler), and feature gating.
 *
 * The command palette, the keyboard layer and the settings shortcuts
 * section all read from THIS registry — adding a command is one entry
 * here, never a new hardcoded wiring point.
 */

export type DashboardTab =
  "workspace" | "executions" | "governance" | "evolution" | "usage" | "providers" | "settings"

export interface Keybind {
  /** Modifier combo: "mod" means Cmd on macOS / Ctrl elsewhere. */
  mod?: boolean
  shift?: boolean
  alt?: boolean
  key: string
}

export interface CommandDef {
  id: string
  /** i18n key for the display title. */
  titleKey: string
  /** i18n key for an optional one-line description. */
  descriptionKey?: string
  /** Default keybind. User overrides (future) live in the shortcuts store. */
  keybind?: Keybind
  /** Tab navigation target — mutually exclusive with `handler`. */
  navigateTo?: DashboardTab
  /** Custom action id understood by the App-level command executor. */
  action?: "open-palette" | "toggle-sidebar" | "stop-stream"
  /** When false the command is listed but disabled. */
  enabled?: boolean
  /** Palette section ordering. */
  section: "navigation" | "actions" | "view"
}

export const COMMANDS: CommandDef[] = [
  // Navigation
  {
    id: "nav.workspace",
    titleKey: "nav.workspace",
    navigateTo: "workspace",
    keybind: { mod: true, key: "1" },
    section: "navigation",
  },
  {
    id: "nav.executions",
    titleKey: "nav.executions",
    navigateTo: "executions",
    keybind: { mod: true, key: "2" },
    section: "navigation",
  },
  {
    id: "nav.governance",
    titleKey: "nav.governance",
    navigateTo: "governance",
    keybind: { mod: true, key: "3" },
    section: "navigation",
  },
  {
    id: "nav.evolution",
    titleKey: "nav.evolution",
    navigateTo: "evolution",
    keybind: { mod: true, key: "4" },
    section: "navigation",
  },
  {
    id: "nav.usage",
    titleKey: "nav.usage",
    navigateTo: "usage",
    keybind: { mod: true, key: "5" },
    section: "navigation",
  },
  {
    id: "nav.providers",
    titleKey: "nav.providers",
    navigateTo: "providers",
    keybind: { mod: true, key: "6" },
    section: "navigation",
  },
  {
    id: "nav.settings",
    titleKey: "nav.settings",
    navigateTo: "settings",
    keybind: { mod: true, key: "7" },
    section: "navigation",
  },
  // Actions
  {
    id: "action.openPalette",
    titleKey: "command.openPalette",
    action: "open-palette",
    keybind: { mod: true, key: "k" },
    section: "actions",
  },
  {
    id: "action.stopStream",
    titleKey: "command.stopStream",
    descriptionKey: "command.stopStream.desc",
    action: "stop-stream",
    section: "actions",
  },
  // View
  {
    id: "view.toggleSidebar",
    titleKey: "command.toggleSidebar",
    action: "toggle-sidebar",
    keybind: { mod: true, shift: true, key: "b" },
    section: "view",
  },
]

/** Format a keybind for display ("⌘K" / "Ctrl+K"). */
export function formatKeybind(kb: Keybind, platform: "mac" | "other" = "other"): string {
  const parts: string[] = []
  if (kb.mod) parts.push(platform === "mac" ? "⌘" : "Ctrl")
  if (kb.shift) parts.push(platform === "mac" ? "⇧" : "Shift")
  if (kb.alt) parts.push(platform === "mac" ? "⌥" : "Alt")
  parts.push(kb.key.toUpperCase())
  return parts.join(platform === "mac" ? "" : "+")
}

/** Commands with a keybind, for the keyboard layer. */
export function commandsWithKeybinds(): CommandDef[] {
  return COMMANDS.filter((c) => c.keybind !== undefined && c.enabled !== false)
}

/** Palette-compatible filter: substring match over id (i18n matching is done at render). */
export function filterCommands(query: string): CommandDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return COMMANDS
  return COMMANDS.filter(
    (c) => c.id.toLowerCase().includes(q) || c.titleKey.toLowerCase().includes(q),
  )
}
