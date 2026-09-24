// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * agent renderer — persistent actor spawn. Body shows the actor identity
 * (unique name, agent role, model override, frozen persona) plus the
 * initial ask as a monospace block, with the spawn outcome as an
 * ai-elements StatusPill (see task.tsx spawnStatus); JSON fallback when
 * the payload is opaque (see agent.model.ts extractAgent).
 */

import type { ToolCallProps } from "../registry"
import { StatusPill } from "@/components/ai-elements"
import { BodyShell } from "./common"
import { extractAgent } from "./agent.model"
import { spawnStatus } from "./task.model"

export const AGENT_GLYPH = "@"

export function AgentBody(props: ToolCallProps) {
  const vm = extractAgent(props.input)
  return (
    <BodyShell
      titleKey="toolRenderers.agent.title"
      vm={vm}
      input={props.input}
      extra={
        vm.isEmpty ? undefined : (
          <div className="mb-1">
            <StatusPill status={spawnStatus(props.ok)} />
          </div>
        )
      }
    />
  )
}
