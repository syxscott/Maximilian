// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** get-workflow-run-situation renderer — glyph + body over extractGetWorkflowRunSituation. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractGetWorkflowRunSituation } from "./workflow.model"

export const GET_WORKFLOW_RUN_SITUATION_GLYPH = "⚑"

export function GetWorkflowRunSituationBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.get-workflow-run-situation.title"
      vm={extractGetWorkflowRunSituation(props.input)}
      input={props.input}
    />
  )
}
