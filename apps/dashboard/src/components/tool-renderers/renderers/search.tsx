// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** search renderer — glyph + body over extractSearch. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractSearch } from "./web.model"

export const SEARCH_GLYPH = "⌕"

export function SearchBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.search.title"
      vm={extractSearch(props.input)}
      input={props.input}
    />
  )
}
