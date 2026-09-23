// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** task renderer — glyph + body over extractTask. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractTask } from "./agent.model"

export const TASK_GLYPH = "□"

export function TaskBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.task.title"
      vm={extractTask(props.input)}
      input={props.input}
    />
  )
}
