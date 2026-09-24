// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * submit-result renderer — final task report. Body shows the summary, the
 * owning task id, the metadata key count and the result payload as a
 * clamped monospace block (coordination.model.ts extractSubmitResult);
 * a usage payload mounts as the ai-elements TokenUsageBadge; JSON
 * fallback for opaque payloads.
 */

import type { ToolCallProps } from "../registry"
import { TokenUsageBadge } from "@/components/ai-elements"
import { BodyShell } from "./common"
import { extractSubmitResult } from "./coordination.model"
import { usageOf } from "./shared.model"

export const SUBMIT_RESULT_GLYPH = "⇥"

export function SubmitResultBody(props: ToolCallProps) {
  const usage = usageOf(props.input)
  return (
    <BodyShell
      titleKey="toolRenderers.submit-result.title"
      vm={extractSubmitResult(props.input)}
      input={props.input}
      extra={usage === undefined ? undefined : <TokenUsageBadge usage={usage} className="mb-1" />}
    />
  )
}
