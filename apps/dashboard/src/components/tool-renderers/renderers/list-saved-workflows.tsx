// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** list-saved-workflows renderer — glyph + body over extractListSavedWorkflows. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractListSavedWorkflows } from "./workflow.model"

export const LIST_SAVED_WORKFLOWS_GLYPH = "≔"

export function ListSavedWorkflowsBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.list-saved-workflows.title"
      vm={extractListSavedWorkflows(props.input)}
      input={props.input}
    />
  )
}
