// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** escalate renderer — glyph + body over extractEscalate. */

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
