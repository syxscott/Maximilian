// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * amend-workflow renderer — the revision side of the dynamic-workflow
 * family (AmendWorkflow stops a run and restarts it from a revised
 * script). The body shows the targeted run · workflow, the revised
 * script as a clamped monospace block (workflow.model.ts
 * extractAmendWorkflow); JSON fallback when the payload is opaque.
 */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractAmendWorkflow } from "./workflow.model"

export const AMEND_WORKFLOW_GLYPH = "✎"

export function AmendWorkflowBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.amend-workflow.title"
      vm={extractAmendWorkflow(props.input)}
      input={props.input}
    />
  )
}
