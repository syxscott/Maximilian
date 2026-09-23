// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** ask-question renderer — glyph + body over extractAskQuestion. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractAskQuestion } from "./coordination.model"

export const ASK_QUESTION_GLYPH = "?"

export function AskQuestionBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.ask-question.title"
      vm={extractAskQuestion(props.input)}
      input={props.input}
    />
  )
}
