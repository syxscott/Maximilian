// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * create-workflow renderer — author a dynamic workflow. Body shows the
 * workflow name, the description and the step count, with the numbered
 * step list as a clamped preview block (workflow.model.ts
 * extractCreateWorkflow).
 */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractCreateWorkflow } from "./workflow.model"

export const CREATE_WORKFLOW_GLYPH = "⚒"

export function CreateWorkflowBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.create-workflow.title"
      vm={extractCreateWorkflow(props.input)}
      input={props.input}
    />
  )
}
