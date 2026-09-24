// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * cron-create renderer — scheduled job registration. Body shows the cron
 * expression, the job name, the timezone (when the payload carries one),
 * the description and the deferred command (schedule.model.ts
 * extractCronCreate).
 */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractCronCreate } from "./schedule.model"

export const CRON_CREATE_GLYPH = "⏱"

export function CronCreateBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.cron-create.title"
      vm={extractCronCreate(props.input)}
      input={props.input}
    />
  )
}
