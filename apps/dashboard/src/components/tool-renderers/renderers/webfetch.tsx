// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * webfetch renderer — URL fetch with a model-side prompt. The result
 * summary mounts as the ai-elements LinkPreviewCard (domain favicon,
 * host title, excerpt/prompt description, bare URL) above the schema
 * rows: URL, derived host (web.model.ts urlHost), HTTP method and
 * extraction selector (web.model.ts extractWebfetch); JSON fallback when
 * the payload is opaque.
 */

import { LinkPreviewCard } from "@/components/ai-elements"
import type { ToolCallProps } from "../registry"
import { BodyShell } from "./common"
import { extractWebfetch } from "./web.model"
import { FIELDS } from "./shared.model"

export const WEBFETCH_GLYPH = "⇣"

export function WebfetchBody(props: ToolCallProps) {
  const vm = extractWebfetch(props.input)
  if (vm.isEmpty) {
    return <BodyShell titleKey="toolRenderers.webfetch.title" vm={vm} input={props.input} />
  }
  const rowValue = (labelKey: string) => vm.rows.find((r) => r.labelKey === labelKey)?.value
  return (
    <BodyShell
      titleKey="toolRenderers.webfetch.title"
      vm={{ ...vm, code: undefined }}
      input={props.input}
      extra={
        <LinkPreviewCard
          link={{
            url: rowValue(FIELDS.url),
            title: rowValue(FIELDS.host) ?? rowValue(FIELDS.url),
            description: vm.code?.text ?? rowValue(FIELDS.prompt),
          }}
          className="mb-1"
        />
      }
    />
  )
}
