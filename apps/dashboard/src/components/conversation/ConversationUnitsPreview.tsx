// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ConversationUnitsPreview — the turn-unit pipeline assembled end to
 * end: events + workspace → buildTurnFlowItems → groupUnitsByTurn →
 * TurnGroup list. A demo/test surface for the deep surface the main
 * ConversationTimeline will adopt later; ChatPanel wiring stays with
 * the main session.
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
