// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * task renderer — subagent spawn. Shows the spawn parameters (description,
 * subagent type, model, execution mode, owned files) with the full prompt
 * as a monospace block, and the spawn outcome as an ai-elements StatusPill
 * (queued while the call runs, completed/failed once the tool-end lands);
 * JSON fallback when the payload is opaque.
 */

import type { ToolCallProps } from "../registry"
import { StatusPill } from "@/components/ai-elements"
import { BodyShell } from "./common"
import { extractTask, spawnStatus } from "./task.model"

export const TASK_GLYPH = "□"

export function TaskBody(props: ToolCallProps) {
  const vm = extractTask(props.input)
  return (
    <BodyShell
      titleKey="toolRenderers.task.title"
      vm={vm}
      input={props.input}
      extra={
        vm.isEmpty ? undefined : (
          <div className="mb-1">
            <StatusPill status={spawnStatus(props.ok)} />
          </div>
        )
      }
    />
  )
}
