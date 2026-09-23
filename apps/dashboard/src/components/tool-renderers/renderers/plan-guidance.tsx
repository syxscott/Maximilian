// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** plan-guidance renderer — glyph + body over extractPlanGuidance. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractPlanGuidance } from "./agent.model"

export const PLAN_GUIDANCE_GLYPH = "§"

export function PlanGuidanceBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.plan-guidance.title"
      vm={extractPlanGuidance(props.input)}
      input={props.input}
    />
  )
}
