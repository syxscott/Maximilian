// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** resume-workflow-run renderer — glyph + body over extractResumeWorkflowRun. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractResumeWorkflowRun } from "./workflow.model"

export const RESUME_WORKFLOW_RUN_GLYPH = "⟳"

export function ResumeWorkflowRunBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.resume-workflow-run.title"
      vm={extractResumeWorkflowRun(props.input)}
      input={props.input}
    />
  )
}
