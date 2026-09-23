// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** mcp renderer — glyph + body over extractMcp. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractMcp } from "./web.model"

export const MCP_GLYPH = "⬡"

export function McpBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.mcp.title"
      vm={extractMcp(props.input)}
      input={props.input}
    />
  )
}
