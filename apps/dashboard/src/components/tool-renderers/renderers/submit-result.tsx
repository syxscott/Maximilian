// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * submit-result renderer — final task report. Body shows the summary, the
 * owning task id and the result payload as a clamped monospace block
 * (coordination.model.ts extractSubmitResult); JSON fallback for opaque
 * payloads.
 */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractSubmitResult } from "./coordination.model"

export const SUBMIT_RESULT_GLYPH = "⇥"

export function SubmitResultBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.submit-result.title"
      vm={extractSubmitResult(props.input)}
      input={props.input}
    />
  )
}
