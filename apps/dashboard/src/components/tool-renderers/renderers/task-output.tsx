// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** task-output renderer — glyph + body over extractTaskOutput. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractTaskOutput } from "./agent.model"

export const TASK_OUTPUT_GLYPH = "⋯"

export function TaskOutputBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.task-output.title"
      vm={extractTaskOutput(props.input)}
      input={props.input}
    />
  )
}
