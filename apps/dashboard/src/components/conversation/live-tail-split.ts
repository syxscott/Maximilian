// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Live-tail partition + split for the virtual turn window (borrowing:
 * ZCode v4 conversationTimelineLiveTail.splitConversationTimelineLiveTail).
 *
 * Why: a RUNNING last turn inside an absolutely positioned virtual row
 * grows its DOM first, and the virtualizer's ResizeObserver backfills
 * totalSize/scrollTop a frame later — the turn's tail visibly jumps on
 * every streaming frame. The fix: the LAST turn always renders in
 * normal flow after the virtual spacer; every earlier turn stays in the
 * virtual band. The container is decided by TURN POSITION (is it the
 * stream's last?) — never by isRunning — so a turn keeps its component
 * through Stop (its status flips while it stays last) and only moves
 * into the virtual band when a NEW turn appears after it.
 *
 * The partition keeps the HISTORY array reference stable across
 * streaming frames: a frame that only touches the tail (the common
 * token-append shape) re-uses the previous history/tail arrays, so
 * downstream identity-keyed memoization (the virtualizer window, the
 * height list) does not rebuild per token. Stability is verified by
 * content (sameTurnRender), never assumed — a tool-end that lands in a
 * history turn changes its content and honestly re-issues the array.
 */

import type { TurnModel } from "./model"
import { sameTurnRender } from "./model"

/** The turn stream cut into the virtual-history prefix and the trailing tail. */
export interface TurnPartition {
  /** Turns that belong in the virtual band (stream prefix). */
  history: TurnModel[]
  /** Trailing turns (the last of which renders in normal flow). */
  tail: TurnModel[]
}

function sameTurnList(a: readonly TurnModel[], b: readonly TurnModel[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((turn, i) => sameTurnRender(turn, b[i]))
}

/**
 * Partition the compiled turn stream for live-tail rendering: the tail
 * is exactly the stream's LAST turn (position rule), history is the
 * prefix. When `previous` is given and the prefix's content is
 * unchanged, the previous HISTORY array reference is re-used — a
 * streaming frame that only appends to the last turn keeps every
 * history identity stable.
 */
export function partitionLiveTail(
  turns: readonly TurnModel[],
  previous?: TurnPartition | null,
): TurnPartition {
  const last = turns.length > 0 ? turns[turns.length - 1] : undefined
  const history = last ? turns.slice(0, -1) : []
  const tail = last ? [last] : []
  if (previous) {
    const historyStable = sameTurnList(previous.history, history)
    const tailStable = sameTurnList(previous.tail, tail)
    if (historyStable && tailStable) return previous
    if (historyStable) return { history: previous.history, tail }
  }
  return { history, tail }
}

export interface LiveTailSplit {
  /** Turns rendered inside the virtual spacer (absolutely positioned). */
  virtual: TurnModel[]
  /** Turns rendered in normal flow after the spacer (exactly 0 or 1). */
  tailRows: TurnModel[]
}

/**
 * Split a partition into the virtual band and the normal-flow tail —
 * the three tail shapes:
 * - tail 0: an empty stream renders nothing; a history-only stream
 *   promotes its LAST row to the tail (it is the stream's bottom edge —
 *   position rule, not a running-state rule);
 * - tail 1: the common streaming shape — the single tail row is the
 *   live tail and the virtual band is exactly the history array
 *   (reference untouched across frames);
 * - tail N: only the LAST tail row is live; earlier tail rows stay in
 *   the virtual band.
 */
export function splitLiveTail(partition: TurnPartition): LiveTailSplit {
  const { history, tail } = partition
  if (tail.length === 0) {
    if (history.length === 0) return { virtual: [], tailRows: [] }
    const last = history[history.length - 1]
    return { virtual: history.slice(0, -1), tailRows: last ? [last] : [] }
  }
  if (tail.length === 1) {
    return { virtual: history, tailRows: tail }
  }
  // tail.length >= 2 here: the last tail row is always defined.
  const last = tail[tail.length - 1]
  return {
    virtual: [...history, ...tail.slice(0, -1)],
    tailRows: last ? [last] : [],
  }
}
