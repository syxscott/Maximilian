// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** webfetch renderer — glyph + body over extractWebfetch. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractWebfetch } from "./web.model"

export const WEBFETCH_GLYPH = "⇣"

export function WebfetchBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.webfetch.title"
      vm={extractWebfetch(props.input)}
      input={props.input}
    />
  )
}
