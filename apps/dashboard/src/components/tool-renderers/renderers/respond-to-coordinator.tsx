// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * respond-to-coordinator renderer — answer the coordinating agent. Body
 * shows the summary headline and owning task, with the full response as a
 * monospace block (coordination.model.ts extractRespondToCoordinator).
 */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractRespondToCoordinator } from "./coordination.model"

export const RESPOND_TO_COORDINATOR_GLYPH = "↩"

export function RespondToCoordinatorBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.respond-to-coordinator.title"
      vm={extractRespondToCoordinator(props.input)}
      input={props.input}
    />
  )
}
