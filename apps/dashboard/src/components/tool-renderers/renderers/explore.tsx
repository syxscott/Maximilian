// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * explore renderer — read-only workspace reconnaissance. Body shows the
 * query, the base path, the scoped paths, the exploration strategy and
 * the depth/breadth knobs (agent.model.ts extractExplore).
 */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractExplore } from "./agent.model"

export const EXPLORE_GLYPH = "»"

export function ExploreBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.explore.title"
      vm={extractExplore(props.input)}
      input={props.input}
    />
  )
}
