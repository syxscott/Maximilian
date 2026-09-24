// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Timeline view layer — the flat-item helpers that SURVIVED the switch
 * to the turn-unit pipeline (components/conversation/model.ts). Find
 * (query filter + highlight ranges) moved to buildConversationFindIndex
 * and share export moved to toConversationMarkdown; what remains is the
 * windowing arithmetic and the turn navigator over the grouped turn
 * list the pipeline produces.
 */

/** Turn groups in display order (structural subset of TurnModel). */
interface TurnLike {
  turnId: string
}

/** The task turns' positions in a turn list (turn navigator's anchors). */
export function turnAnchors(turns: TurnLike[]): number[] {
  return turns.map((turn, i) => (turn.turnId.startsWith("task-") ? i : -1)).filter((i) => i >= 0)
}

/** Next/previous turn anchor index from a current index (-1 = none yet). */
export function adjacentAnchor(anchors: number[], current: number, direction: 1 | -1): number {
  if (anchors.length === 0) return -1
  if (current === -1) return direction === 1 ? anchors[0]! : anchors[anchors.length - 1]!
  const position = anchors.indexOf(current)
  if (position === -1) {
    const later = anchors.find((a) => a > current)
    return direction === 1
      ? (later ?? anchors[anchors.length - 1]!)
      : (anchors.filter((a) => a < current).at(-1) ?? anchors[0]!)
  }
  const next = position + direction
  if (next < 0 || next >= anchors.length) return current
  return anchors[next]!
}

/**
 * Windowing: render at most the newest `visibleCount` turns; older ones
 * are materialized by the "load earlier" affordance. Returns the window
 * plus how many turns are hidden above it.
 */
export function windowItems<T>(
  items: T[],
  visibleCount: number,
): { window: T[]; hiddenAbove: number } {
  if (items.length <= visibleCount) return { window: items, hiddenAbove: 0 }
  return {
    window: items.slice(items.length - visibleCount),
    hiddenAbove: items.length - visibleCount,
  }
}
