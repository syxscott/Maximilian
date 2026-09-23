// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** task-stop renderer — glyph + body over extractTaskStop. */

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
