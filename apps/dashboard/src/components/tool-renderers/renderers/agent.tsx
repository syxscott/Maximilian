// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** agent renderer — glyph + body over extractAgent. */

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
