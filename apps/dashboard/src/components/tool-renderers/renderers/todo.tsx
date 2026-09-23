// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** todo renderer — glyph + body over extractTodo. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractTodo } from "./coordination.model"

export const TODO_GLYPH = "☑"

export function TodoBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.todo.title"
      vm={extractTodo(props.input)}
      input={props.input}
    />
  )
}
