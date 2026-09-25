// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * QuickPick model — fuzzy filtering and ranking for the quick picker
 * (ZCode quickpick borrowing). Pure functions only: given passthrough
 * item blobs (fields may be missing) they produce a typed, ranked,
 * sectioned view model the component renders verbatim.
 */

import { formatKeybind, type CommandDef } from "@/lib/commands"

export interface QuickPickItem {
  id: string
  label: string
  description?: string
  /** Section heading; items without one render in the "ungrouped" tail. */
  section?: string
  disabled?: boolean
}

export interface RankedQuickPickItem {
  item: QuickPickItem
  score: number
  /** Index into the ORIGINAL items array — stable tie-breaking. */
  index: number
}

export interface QuickPickSection {
  /** null = the ungrouped tail. */
  section: string | null
  items: RankedQuickPickItem[]
}

function isWordBoundary(label: string, at: number): boolean {
  if (at === 0) return true
  const prev = label.charAt(at - 1)
  const cur = label.charAt(at)
  // Separators ("-_. /") and camelCase humps both count as boundaries.
  if (/[^a-zA-Z0-9]/.test(prev)) return true
  return /[a-z0-9]/.test(prev) && /[A-Z]/.test(cur)
}

/**
 * Fuzzy subsequence match: every query character must appear in the
 * label in order. Score rewards consecutive runs (+4), word-boundary
 * hits (+3) and an opening match (+4); a character matched later in the
 * label costs nothing extra beyond run breaks. Returns null when the
 * query is not a subsequence. Case-insensitive; empty query → 0.
 */
export function fuzzyScore(query: string, label: string): number | null {
  const q = query.toLowerCase()
  const l = label.toLowerCase()
  if (!q) return 0
  let score = 0
  let searchFrom = 0
  let prevMatch = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    const found = l.indexOf(ch, searchFrom)
    if (found === -1) return null
    score += 1
    if (found === prevMatch + 1) score += 4
    if (isWordBoundary(label, found)) score += 3
    if (qi === 0 && found === 0) score += 4
    prevMatch = found
    searchFrom = found + 1
  }
  return score
}

/**
 * Defensive normalization of passthrough items: non-objects, entries
 * without an id are dropped; a missing label falls back to the id.
 */
export function normalizeQuickPickItems(input: unknown): QuickPickItem[] {
  if (!Array.isArray(input)) return []
  const out: QuickPickItem[] = []
  for (const raw of input) {
    if (raw === null || typeof raw !== "object") continue
    const rec = raw as Record<string, unknown>
    if (typeof rec.id !== "string" || rec.id.length === 0) continue
    out.push({
      id: rec.id,
      label: typeof rec.label === "string" ? rec.label : rec.id,
      description: typeof rec.description === "string" ? rec.description : undefined,
      section: typeof rec.section === "string" ? rec.section : undefined,
      disabled: rec.disabled === true,
    })
  }
  return out
}

/**
 * Filter + rank items against the query. Labels are matched with
 * fuzzyScore; ids match with a one-point penalty so label hits win ties.
 * Empty query keeps registry order. Disabled items never match. Sorting:
 * score desc, then original index asc.
 */
export function rankQuickPick(items: QuickPickItem[], query: string): RankedQuickPickItem[] {
  const q = query.trim()
  const ranked: RankedQuickPickItem[] = []
  items.forEach((item, index) => {
    if (item.disabled) return
    if (!q) {
      ranked.push({ item, score: 0, index })
      return
    }
    const labelScore = fuzzyScore(q, item.label)
    const idScore = fuzzyScore(q, item.id)
    const score = labelScore ?? (idScore === null ? null : idScore - 1)
    if (score !== null) ranked.push({ item, score, index })
  })
  ranked.sort((a, b) => b.score - a.score || a.index - b.index)
  return ranked
}

/**
 * Split a ranked list into sections in first-appearance order; items
 * without a section collect in the trailing "ungrouped" group.
 */
export function groupBySection(ranked: RankedQuickPickItem[]): QuickPickSection[] {
  const groups: QuickPickSection[] = []
  const byName = new Map<string, QuickPickSection>()
  let ungrouped: QuickPickSection | null = null
  for (const entry of ranked) {
    const name = entry.item.section ?? null
    if (name === null) {
      if (!ungrouped) {
        ungrouped = { section: null, items: [] }
        groups.push(ungrouped)
      }
      ungrouped.items.push(entry)
      continue
    }
    let group = byName.get(name)
    if (!group) {
      group = { section: name, items: [] }
      byName.set(name, group)
      groups.push(group)
    }
    group.items.push(entry)
  }
  return groups
}

/** Flatten sections back into one highlight-ordered list. */
export function flattenSections(sections: QuickPickSection[]): RankedQuickPickItem[] {
  return sections.flatMap((s) => s.items)
}

// ── slash-command menu (ChatPanel "/" quickpick) ────────────────────────────

/**
 * Which custom-action executors the caller can actually reach. Navigation
 * commands are NOT gated here: they always route through the caller's
 * onNavigate callback (a no-op until the shell wires it), so the menu
 * keeps listing them.
 */
export interface SlashCommandHandlers {
  /** A palette-opener callback exists (onOpenPalette). */
  openPalette: boolean
  /** A stream-abort callback exists (onAbort). */
  stopStream: boolean
}

/** i18n section labels for the slash menu, keyed by registry section. */
export function slashSectionKey(section: CommandDef["section"]): string {
  return `quickpick.slash.${section}`
}

/**
 * Map the command registry into QuickPick items for the chat composer's
 * "/" menu. Titles/descriptions flow through i18n; the description
 * prefers the command's i18n description, falling back to its keybind.
 *
 * Offer policy (QuickPick ranking HIDES disabled items, so "listed but
 * disabled" is not a state it can render): navigation commands are
 * always offered — selecting one calls the panel's onNavigate with the
 * target tab; open-palette / stop-stream are offered only when their
 * executor callback exists; view toggles have no panel-reachable
 * executor at all and are never offered from here.
 */
export function commandQuickPickItems(
  commands: readonly CommandDef[],
  translate: (key: string) => string,
  handlers: SlashCommandHandlers,
): QuickPickItem[] {
  return commands.map((command) => {
    const wired =
      command.navigateTo !== undefined
        ? true
        : command.action === "open-palette"
          ? handlers.openPalette
          : command.action === "stop-stream"
            ? handlers.stopStream
            : false // view toggles have no panel-reachable executor
    return {
      id: command.id,
      label: translate(command.titleKey),
      description:
        command.descriptionKey !== undefined
          ? translate(command.descriptionKey)
          : command.keybind !== undefined
            ? formatKeybind(command.keybind)
            : undefined,
      section: translate(slashSectionKey(command.section)),
      disabled: command.enabled === false || !wired,
    }
  })
}
