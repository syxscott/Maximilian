// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * agent renderer — persistent actor spawn. Body shows the actor identity
 * (unique name, agent role, model override, frozen persona) plus the
 * initial ask as a monospace block; JSON fallback when the payload is
 * opaque (see agent.model.ts extractAgent).
 */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractAgent } from "./agent.model"

export const AGENT_GLYPH = "@"

export function AgentBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.agent.title"
      vm={extractAgent(props.input)}
      input={props.input}
    />
  )
}
