// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** get-workflow-run-roster renderer — glyph + body over extractGetWorkflowRunRoster. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractGetWorkflowRunRoster } from "./workflow.model"

export const GET_WORKFLOW_RUN_ROSTER_GLYPH = "⧉"

export function GetWorkflowRunRosterBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.get-workflow-run-roster.title"
      vm={extractGetWorkflowRunRoster(props.input)}
      input={props.input}
    />
  )
}
