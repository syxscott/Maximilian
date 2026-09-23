// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/** send-message renderer — glyph + body over extractSendMessage. */

import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractSendMessage } from "./coordination.model"

export const SEND_MESSAGE_GLYPH = "→"

export function SendMessageBody(props: ToolCallProps) {
  return (
    <BodyShell
      titleKey="toolRenderers.send-message.title"
      vm={extractSendMessage(props.input)}
      input={props.input}
    />
  )
}
