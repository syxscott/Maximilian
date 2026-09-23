// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** skill renderer — glyph + body over extractSkill. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractSkill } from "./coordination.model"

export const SKILL_GLYPH = "✦"

export function SkillBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.skill.title"
      vm={extractSkill(props.input)}
      input={props.input}
    />
  )
}
