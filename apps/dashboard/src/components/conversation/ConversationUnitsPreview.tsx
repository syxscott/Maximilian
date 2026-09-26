// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ConversationUnitsPreview — the turn-unit pipeline assembled end to
 * end: events + workspace → buildTurnFlowItems → groupUnitsByTurn →
 * TurnGroup list. STATIC preview/test surface only: it compiles the
 * pipeline once per prop change and renders the plain turn list — no
 * windowing, find, live-tail or flash-once registry. The LIVE render
 * path (ChatPanel's real-time stream) is ConversationTimeline, which
 * wraps the same pipeline in ConversationWindow / VirtualTurnWindow.
 * The two are the only renders of TurnGroup; there is no other
 * timeline path.
 */

import { useMemo } from "react"
import { useLocale, t } from "@max/i18n"
import type { RuntimeEvent, Workspace } from "@/api"
import { buildTurnFlowItems, groupUnitsByTurn } from "./model"
import { TurnGroup } from "./TurnGroup"

export function ConversationUnitsPreview({
  events,
  workspace,
}: {
  events: RuntimeEvent[]
  workspace: Workspace | null
}) {
  useLocale()
  const units = useMemo(() => buildTurnFlowItems(events, workspace), [events, workspace])
  const turns = useMemo(() => groupUnitsByTurn(units), [units])

  if (turns.length === 0) {
    return (
      <p
        className="py-6 text-center text-sm text-muted-foreground"
        data-testid="conversation-units-empty"
      >
        {t("conversation.preview.empty")}
      </p>
    )
  }

  return (
    <div className="space-y-3" data-testid="conversation-units-preview">
      <p className="text-xs text-muted-foreground" data-testid="conversation-units-stats">
        {t("conversation.preview.stats", {
          turns: turns.length,
          units: units.length,
        })}
      </p>
      {turns.map((turn) => (
        <TurnGroup key={turn.turnId} turn={turn} />
      ))}
    </div>
  )
}
