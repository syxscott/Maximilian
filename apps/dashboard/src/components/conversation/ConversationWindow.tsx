// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ConversationWindow — windowed container over the turn-unit pipeline
 * (deepseek ui-conversation borrowing). Renders windowTurns' window:
 * the newest turns by default, or a window pinned at `anchorTurnId`
 * (scroll-anchored deep dive). Older turns materialize through the
 * "load earlier" affordance; an anchor can be released back to
 * tail-following. The timeline drives find (highlight turn ids + text
 * ranges) and virtual-height placeholders through props; all windowing
 * arithmetic lives in the model — this component only renders and
 * interacts.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, t } from "@max/i18n"
import { Button } from "@/components/ui/button"
import type { ConversationUnit, FindHit } from "./model"
import { DEFAULT_WINDOW_TURNS, windowTurns } from "./model"
import { TurnGroup } from "./TurnGroup"

export function ConversationWindow({
  units,
  visibleTurns = DEFAULT_WINDOW_TURNS,
  anchorTurnId = null,
  loadStep = 10,
  onClearAnchor,
  turnDepth,
  highlightTurnIds,
  textHighlights,
  currentUnitKey,
  turnHeights,
  loadEarlierHint,
  onExpand,
  freshSteeringKeys,
}: {
  units: ConversationUnit[]
  /** Initial window size in turns (default 30). */
  visibleTurns?: number
  /** Turn id to anchor the window on (scroll target), or null. */
  anchorTurnId?: string | null
  /** Turns each "load earlier" click materializes. */
  loadStep?: number
  /** Called when the user releases the anchor back to tail-following. */
  onClearAnchor?: () => void
  /**
   * Called after each "load earlier" expansion. Content prepended ABOVE
   * the window keeps scrollTop unchanged, which would push a live-tail
   * attached view off the bottom while its state still claims to follow
   * the tail — the host re-pins when the coexistence model says so
   * (expansionKeepsTail: live + attached + un-anchored).
   */
  onExpand?: () => void
  /** Full-stream turn depths (see WindowTurnsOpts.depth). */
  turnDepth?: Map<string, number>
  /** Turn ids carrying a find match — amber border on their cards. */
  highlightTurnIds?: Set<string>
  /** Unit key → matched ranges inside the unit's text (find highlight). */
  textHighlights?: Map<string, FindHit[]>
  /** Unit key of the CURRENT find match — its highlights render amber
   *  (the cursor's match), others keep the default mark backdrop. */
  currentUnitKey?: string
  /** Turn id → estimated pixel height — reserves that height as the
   *  card wrapper's minHeight and renders a placeholder bar per card so
   *  the scrollbar ratio stays real while windowed. */
  turnHeights?: Map<string, number>
  /** Appended to the load-earlier label (the estimated-height hint). */
  loadEarlierHint?: string
  /** Steering flash-once verdict — unit keys on their FIRST render (see
   *  TurnGroup's prop of the same name). */
  freshSteeringKeys?: Set<string>
}) {
  useLocale()
  const [extra, setExtra] = useState(0)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const { turns, hiddenBefore, anchorOffset } = useMemo(
    () =>
      windowTurns(units, { visibleTurns: visibleTurns + extra, anchorTurnId, depth: turnDepth }),
    [units, visibleTurns, extra, anchorTurnId, turnDepth],
  )

  // Scroll the anchored turn into view whenever the anchor changes —
  // the model guarantees it is the window's first turn.
  useEffect(() => {
    const el = anchorRef.current
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "start" })
    }
  }, [anchorOffset])

  if (turns.length === 0) {
    return (
      <p
        className="py-6 text-center text-sm text-muted-foreground"
        data-testid="conversation-window-empty"
      >
        {t("conversation.window.empty")}
      </p>
    )
  }

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="conversation-window"
      data-hidden-before={hiddenBefore}
      data-anchor-offset={anchorOffset ?? undefined}
    >
      {hiddenBefore > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full text-xs"
          title={t("conversation.window.tailHint")}
          onClick={() => {
            setExtra((v) => v + loadStep)
            onExpand?.()
          }}
          data-testid="window-load-earlier"
        >
          ↑{" "}
          {t("conversation.window.loadEarlier", {
            count: String(Math.min(loadStep, hiddenBefore)),
          })}
          {loadEarlierHint !== undefined && ` · ${loadEarlierHint}`}
        </Button>
      )}
      {turns.map((turn, renderIndex) => {
        const spacer = turnHeights?.get(turn.turnId)
        return (
          <div
            key={turn.turnId}
            ref={anchorOffset !== undefined && renderIndex === 0 ? anchorRef : undefined}
            data-window-index={hiddenBefore + renderIndex}
            // Progressive enhancement: reserve the turn's estimated
            // height on the card wrapper so a re-render can't collapse
            // the row while the window is virtualized (anti-jump).
            style={spacer !== undefined ? { minHeight: spacer } : undefined}
            data-min-height={spacer !== undefined ? spacer : undefined}
          >
            <TurnGroup
              turn={turn}
              highlighted={highlightTurnIds?.has(turn.turnId) ?? false}
              textHighlights={textHighlights}
              currentUnitKey={currentUnitKey}
              freshSteeringKeys={freshSteeringKeys}
            />
            {spacer !== undefined && (
              <div
                aria-hidden
                className="pointer-events-none w-full rounded-sm bg-border/50"
                style={{ height: spacer }}
                data-testid="window-height-spacer"
                data-spacer-height={spacer}
              />
            )}
          </div>
        )
      })}
      {anchorOffset !== undefined && (
        <Button
          variant="secondary"
          size="sm"
          className="h-7 self-center px-3 text-xs"
          onClick={() => onClearAnchor?.()}
          data-testid="window-clear-anchor"
        >
          ↓ {t("conversation.window.jumpLatest")}
        </Button>
      )}
    </div>
  )
}
