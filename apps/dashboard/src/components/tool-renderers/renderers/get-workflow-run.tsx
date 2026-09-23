// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** get-workflow-run renderer — glyph + body over extractGetWorkflowRun. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractGetWorkflowRun } from "./workflow.model"

export const GET_WORKFLOW_RUN_GLYPH = "◉"

export function GetWorkflowRunBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.get-workflow-run.title"
      vm={extractGetWorkflowRun(props.input)}
      input={props.input}
    />
  )
}
