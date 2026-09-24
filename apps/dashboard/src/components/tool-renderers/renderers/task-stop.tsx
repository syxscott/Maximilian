// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * task-stop renderer — explicit stop request. Body shows the target task
 * id, the force flag and the stop reason, and the collapsed line falls
 * back to the reason when no id is given (see agent.model.ts
 * extractTaskStop); JSON fallback when the payload is opaque.
 */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractTaskStop } from "./agent.model"

export const TASK_STOP_GLYPH = "■"

export function TaskStopBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.task-stop.title"
      vm={extractTaskStop(props.input)}
      input={props.input}
    />
  )
}
