// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** offpeak-create renderer — glyph + body over extractOffpeakCreate. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractOffpeakCreate } from "./schedule.model"

export const OFFPEAK_CREATE_GLYPH = "☾"

export function OffpeakCreateBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.offpeak-create.title"
      vm={extractOffpeakCreate(props.input)}
      input={props.input}
    />
  )
}
