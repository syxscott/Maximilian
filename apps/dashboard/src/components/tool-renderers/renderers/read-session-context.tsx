// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * read-session-context renderer — pull context from a prior session. Body
 * shows the session id, the focused query, the retrieval strategy and the
 * token budget (coordination.model.ts extractReadSessionContext).
 */

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
