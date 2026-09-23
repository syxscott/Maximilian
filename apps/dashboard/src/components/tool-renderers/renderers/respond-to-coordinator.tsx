// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** respond-to-coordinator renderer — glyph + body over extractRespondToCoordinator. */

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
