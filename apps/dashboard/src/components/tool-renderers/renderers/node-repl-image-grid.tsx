// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** node-repl-image-grid renderer — glyph + body over extractNodeReplImageGrid. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractNodeReplImageGrid } from "./repl.model"

export const NODE_REPL_IMAGE_GRID_GLYPH = "▦"

export function NodeReplImageGridBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.node-repl-image-grid.title"
      vm={extractNodeReplImageGrid(props.input)}
      input={props.input}
    />
  )
}
