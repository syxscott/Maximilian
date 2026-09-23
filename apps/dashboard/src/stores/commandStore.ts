// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Command store (ZCode commandsStore borrowing): execution history for
 * the palette's "recent" section (last 20, most recent first, deduped)
 * and the user's disabled-command id set. Pure helpers are exported so
 * the rules are testable without the store; COMMANDS itself stays the
 * untouched registry in lib/commands.ts.
 */
import { create } from "zustand"
import { COMMANDS } from "@/lib/commands"
import type { CommandDef } from "@/lib/commands"

/** History cap — matches ZCode's palette "recent commands" depth. */
export const COMMAND_HISTORY_LIMIT = 20

/**
 * Pure history update: move `id` to the front, dedupe, cap at `limit`.
 */
export function pushRecent(history: string[], id: string, limit = COMMAND_HISTORY_LIMIT): string[] {
  if (id === "") return history
  return [id, ...history.filter((h) => h !== id)].slice(0, limit)
}

/**
 * Registry view the palette should render: COMMANDS minus user-disabled
 * ids and minus registry-level `enabled: false` entries.
 */
export function visibleCommands(disabledIds: ReadonlySet<string>): CommandDef[] {
  return COMMANDS.filter((c) => c.enabled !== false && !disabledIds.has(c.id))
}

interface CommandState {
  /** Most recent first, deduped, at most COMMAND_HISTORY_LIMIT ids. */
  history: string[]
  /** Ids the user turned off (e.g. in settings shortcuts). */
  disabledIds: Set<string>
  recordCommand: (id: string) => void
  toggleDisabled: (id: string) => void
  isDisabled: (id: string) => boolean
  clearHistory: () => void
}

export const useCommandStore = create<CommandState>((set, get) => ({
  history: [],
  disabledIds: new Set<string>(),
  recordCommand: (id) => set((s) => ({ history: pushRecent(s.history, id) })),
  toggleDisabled: (id) =>
    set((s) => {
      const disabledIds = new Set(s.disabledIds)
      if (disabledIds.has(id)) {
        disabledIds.delete(id)
      } else {
        disabledIds.add(id)
      }
      return { disabledIds }
    }),
  isDisabled: (id) => get().disabledIds.has(id),
  clearHistory: () => set({ history: [] }),
}))

/** Selector hook: palette-visible commands for the current disabled set. */
export const useVisibleCommands = (): CommandDef[] =>
  useCommandStore((s) => visibleCommands(s.disabledIds))

/** Selector hook: recent ids for one command (palette ordering helper). */
export const useHistory = (): string[] => useCommandStore((s) => s.history)
