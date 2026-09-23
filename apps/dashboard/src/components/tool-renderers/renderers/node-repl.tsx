// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** node-repl renderer — glyph + body over extractNodeRepl (monospace code). */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractNodeRepl } from "./repl.model"

export const NODE_REPL_GLYPH = "❯"

export function NodeReplBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.node-repl.title"
      vm={extractNodeRepl(props.input)}
      input={props.input}
    />
  )
}
