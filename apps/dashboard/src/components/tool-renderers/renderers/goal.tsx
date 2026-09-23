// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** goal renderer — glyph + body over extractGoal. */

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
