// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Core-tool bodies — bash / read / glob / grep / permission / lsp. Each is
 * a BodyShell over the schema-aligned extractor in core.model.ts: labeled
 * rows for every meaningful schema field (optionality shown via the
 * "(default)" row labels), the bash command / lsp document as a monospace
 * block, and the generic JSON preview when the payload carries no domain
 * field at all. edit/write keep their inline-diff body (edit-inline-diff).
 */

import type { ComponentType } from "react"
import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import {
  extractBash,
  extractGlob,
  extractGrep,
  extractLsp,
  extractPermission,
  extractRead,
} from "./core.model"

type Body = ComponentType<ToolCallProps>

function coreBody(tool: string, extract: (input: unknown) => ReturnType<typeof extractBash>): Body {
  function CoreToolBody(props: ToolCallProps) {
    return (
      <BodyShell
        titleKey={`toolRenderers.${tool}.title`}
        vm={extract(props.input)}
        input={props.input}
      />
    )
  }
  return CoreToolBody
}

export const BashBody = coreBody("bash", extractBash)
export const ReadBody = coreBody("read", extractRead)
export const GlobBody = coreBody("glob", extractGlob)
export const GrepBody = coreBody("grep", extractGrep)
export const PermissionBody = coreBody("permission", extractPermission)
export const LspBody = coreBody("lsp", extractLsp)
