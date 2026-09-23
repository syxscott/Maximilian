// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** switch-mode renderer — glyph + body over extractSwitchMode. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractSwitchMode } from "./coordination.model"

export const SWITCH_MODE_GLYPH = "⇄"

export function SwitchModeBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.switch-mode.title"
      vm={extractSwitchMode(props.input)}
      input={props.input}
    />
  )
}
