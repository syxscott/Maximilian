// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** save-workflow renderer — glyph + body over extractSaveWorkflow. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractSaveWorkflow } from "./workflow.model"

export const SAVE_WORKFLOW_GLYPH = "⛁"

export function SaveWorkflowBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.save-workflow.title"
      vm={extractSaveWorkflow(props.input)}
      input={props.input}
    />
  )
}
