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
 * tail-following. All windowing arithmetic lives in the model — this
 * component only renders and interacts.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, t } from "@max/i18n"
import { Button } from "@/components/ui/button"
import type { ConversationUnit } from "./model"
import { DEFAULT_WINDOW_TURNS, windowTurns } from "./model"
import { TurnGroup } from "./TurnGroup"

export function ConversationWindow({
  units,
  visibleTurns = DEFAULT_WINDOW_TURNS,
  anchorTurnId = null,
  loadStep = 10,
  onClearAnchor,
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
}) {
  useLocale()
  const [extra, setExtra] = useState(0)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const { turns, hiddenBefore, anchorOffset } = useMemo(
    () => windowTurns(units, { visibleTurns: visibleTurns + extra, anchorTurnId }),
    [units, visibleTurns, extra, anchorTurnId],
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
          onClick={() => setExtra((v) => v + loadStep)}
          data-testid="window-load-earlier"
        >
          ↑{" "}
          {t("conversation.window.loadEarlier", {
            count: String(Math.min(loadStep, hiddenBefore)),
          })}
        </Button>
      )}
      {turns.map((turn, renderIndex) => (
        <div
          key={turn.turnId}
          ref={anchorOffset !== undefined && renderIndex === 0 ? anchorRef : undefined}
          data-window-index={hiddenBefore + renderIndex}
        >
          <TurnGroup turn={turn} />
        </div>
      ))}
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
