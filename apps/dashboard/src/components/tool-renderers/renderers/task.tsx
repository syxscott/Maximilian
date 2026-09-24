// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * task renderer — subagent spawn. Shows the spawn parameters (description,
 * subagent type, model, execution mode, owned files) with the full prompt
 * as a monospace block; JSON fallback when the payload is opaque.
 */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractTask } from "./task.model"

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
