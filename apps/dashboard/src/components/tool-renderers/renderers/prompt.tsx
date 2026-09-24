// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Prompt-display bodies — the agent-prompt-section family. agent-prompt
 * leads with the addressed agent as a heading, then model/line rows and
 * the prompt text as a clamped monospace block; enter-plan-mode renders
 * the mode · target · reason section; exit-plan-mode presents the plan
 * document itself as the approval surface (clamped block + allow-list
 * count). All fall back to the generic JSON preview when the payload is
 * opaque.
 */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractAgentPrompt, extractEnterPlanMode, extractExitPlanMode } from "./prompt.model"
import { FIELDS } from "./shared.model"

export const AGENT_PROMPT_GLYPH = "¶"
export const ENTER_PLAN_MODE_GLYPH = "❒"
export const EXIT_PLAN_MODE_GLYPH = "❑"

export function AgentPromptBody({ input }: ToolCallProps) {
  const vm = extractAgentPrompt(input)
  if (vm.isEmpty) {
    return <BodyShell titleKey="toolRenderers.agent-prompt.title" vm={vm} input={input} />
  }
  // The agent name leads as the section heading; keep model/lines as rows.
  const rows = vm.name === undefined ? vm.rows : vm.rows.filter((r) => r.labelKey !== FIELDS.agent)
  return (
    <BodyShell
      titleKey="toolRenderers.agent-prompt.title"
      vm={{ ...vm, rows }}
      input={input}
      extra={
        vm.name !== undefined ? (
          <p className="mb-1 break-words text-xs font-medium" data-testid="agent-prompt-name">
            {vm.name}
          </p>
        ) : undefined
      }
    />
  )
}

export function EnterPlanModeBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.enter-plan-mode.title"
      vm={extractEnterPlanMode(props.input)}
      input={props.input}
    />
  )
}

export function ExitPlanModeBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.exit-plan-mode.title"
      vm={extractExitPlanMode(props.input)}
      input={props.input}
    />
  )
}
