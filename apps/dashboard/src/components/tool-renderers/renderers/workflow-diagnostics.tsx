// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** workflow-diagnostics renderer — glyph + body over extractWorkflowDiagnostics. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractWorkflowDiagnostics } from "./workflow.model"

export const WORKFLOW_DIAGNOSTICS_GLYPH = "⚕"

export function WorkflowDiagnosticsBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.workflow-diagnostics.title"
      vm={extractWorkflowDiagnostics(props.input)}
      input={props.input}
    />
  )
}
