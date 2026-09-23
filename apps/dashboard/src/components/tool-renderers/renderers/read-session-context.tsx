// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** read-session-context renderer — glyph + body over extractReadSessionContext. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractReadSessionContext } from "./coordination.model"

export const READ_SESSION_CONTEXT_GLYPH = "⟲"

export function ReadSessionContextBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.read-session-context.title"
      vm={extractReadSessionContext(props.input)}
      input={props.input}
    />
  )
}
