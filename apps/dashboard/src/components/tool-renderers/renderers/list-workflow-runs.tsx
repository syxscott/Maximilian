// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** list-workflow-runs renderer — glyph + body over extractListWorkflowRuns. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractListWorkflowRuns } from "./workflow.model"

export const LIST_WORKFLOW_RUNS_GLYPH = "≣"

export function ListWorkflowRunsBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.list-workflow-runs.title"
      vm={extractListWorkflowRuns(props.input)}
      input={props.input}
    />
  )
}
