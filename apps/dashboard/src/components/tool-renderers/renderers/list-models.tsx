// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** list-models renderer — glyph + body over extractListModels. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractListModels } from "./coordination.model"

export const LIST_MODELS_GLYPH = "☰"

export function ListModelsBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.list-models.title"
      vm={extractListModels(props.input)}
      input={props.input}
    />
  )
}
