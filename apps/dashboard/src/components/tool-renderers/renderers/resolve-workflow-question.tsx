// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** resolve-workflow-question renderer — glyph + body over extractResolveWorkflowQuestion. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractResolveWorkflowQuestion } from "./workflow.model"

export const RESOLVE_WORKFLOW_QUESTION_GLYPH = "⁇"

export function ResolveWorkflowQuestionBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.resolve-workflow-question.title"
      vm={extractResolveWorkflowQuestion(props.input)}
      input={props.input}
    />
  )
}
