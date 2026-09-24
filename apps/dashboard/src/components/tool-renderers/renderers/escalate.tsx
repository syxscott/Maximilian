// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * escalate renderer — raise a blocker to the coordinator. Body shows the
 * escalation target, the severity and the reason (the collapsed line leads
 * with the reason), with optional background context as a monospace block
 * (coordination.model.ts extractEscalate).
 */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractEscalate } from "./coordination.model"

export const ESCALATE_GLYPH = "↑"

export function EscalateBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.escalate.title"
      vm={extractEscalate(props.input)}
      input={props.input}
    />
  )
}
