// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * goal renderer — goal registration/progress. Body shows the goal text,
 * its status and the percent progress when the payload carries one
 * (coordination.model.ts extractGoal); JSON fallback otherwise.
 */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractGoal } from "./coordination.model"

export const GOAL_GLYPH = "◎"

export function GoalBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.goal.title"
      vm={extractGoal(props.input)}
      input={props.input}
    />
  )
}
