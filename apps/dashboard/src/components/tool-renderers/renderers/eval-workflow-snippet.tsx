// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** eval-workflow-snippet renderer — glyph + body over extractEvalWorkflowSnippet (monospace code). */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractEvalWorkflowSnippet } from "./workflow.model"

export const EVAL_WORKFLOW_SNIPPET_GLYPH = "ƒ"

export function EvalWorkflowSnippetBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.eval-workflow-snippet.title"
      vm={extractEvalWorkflowSnippet(props.input)}
      input={props.input}
    />
  )
}
